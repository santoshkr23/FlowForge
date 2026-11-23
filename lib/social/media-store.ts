/**
 * Where uploaded files live. Pictures and PDFs (≤20 MB) go in the database; videos (up to 1 GB)
 * are streamed to disk under MEDIA_DIR so they never sit whole in memory.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { db, schema } from "../db";
import { assertPublicUrl } from "../engine/net";
import { StepError } from "../engine/types";
import type { Media } from "@/db/schema";

export const MAX_FILE = 20 * 1024 * 1024;
export const MAX_VIDEO = Number(process.env.MAX_VIDEO_MB ?? 1024) * 1024 * 1024;

export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/mpeg": "mpg",
  "video/3gpp": "3gp",
};
export const FILE_TYPES = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;
export const isVideo = (mime: string) => mime in VIDEO_TYPES;

export const mediaDir = () => path.resolve(process.env.MEDIA_DIR ?? "./data/media");

const EXT_MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", mpg: "video/mpeg", mpeg: "video/mpeg", "3gp": "video/3gpp" };

/** Best guess of a file's type from what the browser/server said and its name. */
export function guessMime(declared: string | null | undefined, name: string) {
  const d = (declared ?? "").split(";")[0].trim().toLowerCase();
  if (d && d !== "application/octet-stream" && d !== "binary/octet-stream") return d === "video/x-m4v" ? "video/mp4" : d;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : /^(jpe?g)$/.test(ext) ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : d || "application/octet-stream");
}

export const cleanName = (name: string) => (name || "file").replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(-120) || "file";

/** Stream a video to disk and record it. Throws StepError when it's too big. */
export async function saveVideoStream(orgId: string, name: string, mime: string, body: ReadableStream<Uint8Array> | NodeJS.ReadableStream) {
  if (!isVideo(mime)) throw new StepError(`Only video files can be saved this way (got ${mime})`);
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });
  const file = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}.${VIDEO_TYPES[mime]}`;
  const full = path.join(dir, file);
  let size = 0;
  const src = "getReader" in body ? Readable.fromWeb(body as never) : (body as NodeJS.ReadableStream);
  const counter = new Transform({
    transform(chunk: Buffer, _e, cb) {
      size += chunk.length;
      if (size > MAX_VIDEO) cb(new StepError(`Videos can be up to ${Math.round(MAX_VIDEO / 1048576)} MB`));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(src, counter, createWriteStream(full));
  } catch (e) {
    await rm(full, { force: true });
    throw e;
  }
  if (!size) {
    await rm(full, { force: true });
    throw new StepError("The video file is empty");
  }
  const [m] = await db
    .insert(schema.media)
    .values({ orgId, token: randomBytes(18).toString("base64url"), name: cleanName(name), mime, size, path: file, data: null })
    .returning({ id: schema.media.id, token: schema.media.token, name: schema.media.name, mime: schema.media.mime, size: schema.media.size });
  return m;
}

/** Turn share links into direct-download links (Google Drive, Dropbox). */
export function directDownloadUrl(url: string) {
  const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{20,})/);
  if (drive) return `https://drive.usercontent.google.com/download?id=${drive[1]}&export=download&confirm=t`;
  if (/^https:\/\/(www\.)?dropbox\.com\//.test(url)) {
    const u = new URL(url);
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return url;
}

/** Download a video from a public link (Drive/Dropbox share links work) straight to disk. */
export async function downloadVideo(orgId: string, rawUrl: string) {
  const url = directDownloadUrl(rawUrl.trim());
  await assertPublicUrl(url);
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new StepError(`Couldn't download the video (${res.status}). The link must be public.`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_VIDEO) throw new StepError(`Videos can be up to ${Math.round(MAX_VIDEO / 1048576)} MB`);
  const disp = res.headers.get("content-disposition") ?? "";
  const name = decodeURIComponent(disp.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disp.match(/filename="?([^";]+)"?/i)?.[1] ?? new URL(res.url || url).pathname.split("/").pop() ?? "video.mp4");
  const mime = guessMime(res.headers.get("content-type"), name);
  if (mime.startsWith("text/html")) throw new StepError("That link opens a web page, not a video file. Use a direct download link (Google Drive: share as 'Anyone with the link').");
  if (!isVideo(mime)) throw new StepError(`That link isn't a video file (${mime})`);
  return saveVideoStream(orgId, name, mime, res.body);
}

/** Whole file in memory — only for pictures/PDFs (or small videos). */
export async function mediaBytes(m: Pick<Media, "data" | "path">): Promise<Buffer> {
  if (m.data) return m.data;
  if (m.path) return readFile(path.join(mediaDir(), path.basename(m.path)));
  throw new StepError("The file is missing");
}

/** Stream a stored file (used for video uploads and downloads). */
export async function mediaStream(m: Pick<Media, "data" | "path" | "size">): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
  if (m.data) return { stream: new Blob([new Uint8Array(m.data)]).stream(), size: m.data.length };
  if (!m.path) throw new StepError("The file is missing");
  const full = path.join(mediaDir(), path.basename(m.path));
  const st = await stat(full).catch(() => null);
  if (!st) throw new StepError("The video file is no longer on the server. Upload it again.");
  return { stream: Readable.toWeb(createReadStream(full)) as unknown as ReadableStream<Uint8Array>, size: st.size };
}
