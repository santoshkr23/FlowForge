import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { err, json, withAuth } from "@/lib/http";
import { randomToken } from "@/lib/crypto";
import { mediaUrl } from "@/lib/social/publish";
import { siteUrl } from "@/lib/oauth/providers";
import { FILE_TYPES, MAX_FILE, cleanName, guessMime, isVideo, saveVideoStream } from "@/lib/social/media-store";
import { StepError } from "@/lib/engine/types";

export const maxDuration = 900;

/**
 * Upload a file for a social post.
 * - Pictures/PDFs: multipart form, field "file" (≤20 MB).
 * - Videos: send the file itself as the body with ?name=clip.mp4 (streams to disk, up to MAX_VIDEO_MB).
 */
export const POST = withAuth("BUILDER", async (ctx, req) => {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) {
    const name = new URL(req.url).searchParams.get("name") ?? "video.mp4";
    const mime = guessMime(type, name);
    if (!isVideo(mime)) return err("Send videos as the request body; pictures and PDFs as a form", 415);
    if (!req.body) return err("Choose a file to upload");
    try {
      const m = await saveVideoStream(ctx.org.id, name, mime, req.body);
      return json({ ...m, url: mediaUrl(siteUrl(req), m) }, 201);
    } catch (e) {
      if (e instanceof StepError) return err(e.message, 413);
      throw e;
    }
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return err("Choose a file to upload");
  const mime = guessMime(file.type, file.name);
  if (isVideo(mime)) return err("Upload videos with the video uploader (send the file as the body)", 415);
  if (!FILE_TYPES.test(mime)) return err("Only pictures (JPG, PNG, GIF, WebP), PDFs and videos (MP4, MOV, WebM) can be attached", 415);
  if (file.size > MAX_FILE) return err("Pictures and PDFs can be up to 20 MB", 413);
  const data = Buffer.from(await file.arrayBuffer());
  const [m] = await db
    .insert(schema.media)
    .values({ orgId: ctx.org.id, token: randomToken(18), name: cleanName(file.name), mime, size: data.length, data })
    .returning({ id: schema.media.id, token: schema.media.token, name: schema.media.name, mime: schema.media.mime, size: schema.media.size });
  return json({ ...m, url: mediaUrl(siteUrl(req), m) }, 201);
});

/** Recent uploads (newest first) — lets you reuse a video you already uploaded. */
export const GET = withAuth("VIEWER", async (ctx) => {
  const rows = await db
    .select({ id: schema.media.id, name: schema.media.name, mime: schema.media.mime, size: schema.media.size, createdAt: schema.media.createdAt })
    .from(schema.media)
    .where(eq(schema.media.orgId, ctx.org.id))
    .orderBy(desc(schema.media.createdAt))
    .limit(50);
  return json(rows);
});
