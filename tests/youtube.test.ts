// YouTube publishing: video upload to disk, resumable upload, cross-post link, privacy note, MCP tool.
process.env.APP_URL = "https://ff.example.com";
process.env.ALLOW_PRIVATE_NETWORK = "1";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
process.env.MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "ffmedia-"));
import { db, schema } from "../lib/db";
import { registerUser } from "../lib/auth";
import { encryptJson } from "../lib/crypto";
import { saveVideoStream, directDownloadUrl, downloadVideo, mediaDir } from "../lib/social/media-store";
import { publishPost, youtubeTitle } from "../lib/social/publish";
import { createPost } from "../lib/social/create";
import { callTool } from "../lib/mcp-tools";

type Call = { method: string; url: string; headers: Record<string, string>; body: string };
let calls: Call[] = [];
let routes: { m: string; re: RegExp; f: (c: Call) => Response }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  let body = "";
  const b = init.body as unknown;
  if (typeof b === "string") body = b;
  else if (b instanceof ReadableStream) body = Buffer.from(await new Response(b).arrayBuffer()).toString();
  else if (b instanceof Uint8Array) body = Buffer.from(b).toString();
  const c = { method, url, headers, body };
  calls.push(c);
  const r = routes.find((x) => x.m === method && x.re.test(url));
  return r ? r.f(c) : new Response(JSON.stringify({ error: { message: `no route ${method} ${url}` } }), { status: 599 });
}) as typeof fetch;
const on = (m: string, re: RegExp, f: (c: Call) => Response) => routes.push({ m, re, f });
const J = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

let orgId = "";
let userId = "";
before(async () => {
  await migrate(db as never, { migrationsFolder: "./db/migrations" });
  const r = await registerUser("yt@example.com", "password123", "YT");
  orgId = r.org.id;
  userId = r.user.id;
  await db.update(schema.orgs).set({ plan: "PRO", creditsMonthly: 1000 }).where(eq(schema.orgs.id, orgId));
});
beforeEach(() => {
  calls = [];
  routes = [];
});

const oauth = (provider: string) => ({ oauth: true, provider, accessToken: "YT_AT", refreshToken: "RT", expiresAt: Date.now() + 3600_000, extra: {} });
async function conn(app: string, secret: unknown, name: string) {
  const [c] = await db.insert(schema.connections).values({ orgId, app, name, secret: encryptJson(secret) }).returning();
  return c.id;
}
const videoFile = (bytes = "FAKEVIDEOBYTES") => saveVideoStream(orgId, "My demo.mp4", "video/mp4", new Blob([bytes]).stream());
function ytRoutes(privacyBack = "public") {
  on("POST", /upload\/youtube\/v3\/videos\?/, () => new Response(null, { status: 200, headers: { location: "https://upload.youtube.test/session1" } }));
  on("PUT", /upload\.youtube\.test\/session1/, () => J({ id: "VID123", status: { privacyStatus: privacyBack, uploadStatus: "uploaded" } }));
}

test("videos stream to disk, never into the database", async () => {
  const m = await videoFile();
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, m.id));
  assert.equal(row.data, null);
  assert.ok(row.path && existsSync(path.join(mediaDir(), row.path)));
  assert.equal(row.size, 14);
});

test("share links become direct downloads", () => {
  assert.equal(directDownloadUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view?usp=sharing"), "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOpQrStUvWxYz12345&export=download&confirm=t");
  assert.match(directDownloadUrl("https://www.dropbox.com/scl/fi/abc/clip.mp4?rlkey=x&dl=0"), /dl=1/);
});

test("YouTube first, then LinkedIn gets the video link; metadata, tags and resumable upload are right", async () => {
  const yt = await conn("youtube", oauth("youtube"), "YouTube (PDFTool4U (@pdftool4u))");
  const li = await conn("linkedin", { ...oauth("linkedin"), extra: { personUrn: "urn:li:person:me" } }, "LinkedIn (me)");
  const m = await videoFile();
  ytRoutes();
  on("POST", /api\.linkedin\.com\/rest\/posts/, () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:9" } }));
  const post = await createPost(orgId, userId, { text: "Translate any PDF free 🚀\n\nTry it now #PDF #Translate", mediaIds: [m.id], targets: [li, yt], draft: true, options: { youtube: { privacy: "public", categoryId: "28" } } }, "https://ff.example.com");
  await db.update(schema.posts).set({ status: "posting" }).where(eq(schema.posts.id, post.id));
  const done = await publishPost(post.id);
  assert.equal(done.status, "posted", JSON.stringify(done.results));
  assert.equal(done.results![0].app, "youtube");
  assert.equal(done.results![0].url, "https://youtu.be/VID123");

  const init = calls.find((c) => /upload\/youtube\/v3\/videos\?/.test(c.url))!;
  assert.equal(init.headers["x-upload-content-type"], "video/mp4");
  assert.equal(init.headers["x-upload-content-length"], "14");
  const meta = JSON.parse(init.body);
  assert.equal(meta.snippet.title, "Translate any PDF free 🚀");
  assert.deepEqual(meta.snippet.tags, ["PDF", "Translate"]);
  assert.equal(meta.snippet.categoryId, "28");
  assert.equal(meta.status.privacyStatus, "public");
  assert.equal(meta.status.selfDeclaredMadeForKids, false);
  assert.equal(calls.find((c) => /upload\.youtube\.test/.test(c.url))!.body, "FAKEVIDEOBYTES");
  assert.match(JSON.parse(calls.find((c) => /rest\/posts/.test(c.url))!.body).commentary, /https:\/\/youtu\.be\/VID123/);
});

test("unverified Google project: YouTube keeps it private — explained in a note; quota errors are clear", async () => {
  const yt = await conn("youtube", oauth("youtube"), "YouTube (Test)");
  const m = await videoFile();
  ytRoutes("private");
  const p = await createPost(orgId, userId, { text: "Hello", mediaIds: [m.id], targets: [yt], draft: true, options: { youtube: { title: "Hi", privacy: "public" } } }, "https://ff.example.com");
  await db.update(schema.posts).set({ status: "posting" }).where(eq(schema.posts.id, p.id));
  const done = await publishPost(p.id);
  assert.match(done.results![0].note!, /private.*audit/);

  routes = [];
  on("POST", /upload\/youtube\/v3\/videos\?/, () => new Response(null, { status: 200, headers: { location: "https://upload.youtube.test/s2" } }));
  on("PUT", /upload\.youtube\.test\/s2/, () => J({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403));
  const p2 = await createPost(orgId, userId, { text: "Again", mediaIds: [(await videoFile()).id], targets: [yt], draft: true }, "https://ff.example.com");
  await db.update(schema.posts).set({ status: "posting" }).where(eq(schema.posts.id, p2.id));
  assert.match((await publishPost(p2.id)).results![0].error!, /daily upload limit/);
});

test("validation: YouTube needs a video; a video needs YouTube ticked", async () => {
  const yt = await conn("youtube", oauth("youtube"), "YouTube (V)");
  const li = await conn("linkedin", oauth("linkedin"), "LinkedIn (V)");
  await assert.rejects(createPost(orgId, userId, { text: "no video", targets: [yt] }, "x"), /needs a video/);
  const m = await videoFile();
  await assert.rejects(createPost(orgId, userId, { text: "video", mediaIds: [m.id], targets: [li] }, "x"), /Tick your YouTube channel/);
  assert.equal(youtubeTitle({ text: "#AI #ML\n<b>Real</b> title", mediaTitle: null, options: null }), "bReal/b title");
});

test("MCP publish_youtube_video: asks which channel when several; downloads the link; publishes", async () => {
  const who = { org: (await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)))[0], userId, admin: false, via: "oauth" as const };
  const req = new Request("https://ff.example.com/api/mcp");
  await assert.rejects(callTool(who, "publish_youtube_video", { title: "T", privacy: "public", video_url: "https://cdn.example.com/v.mp4" }, req), /Several YouTube channels.*ask the user/);

  on("GET", /cdn\.example\.com\/v\.mp4/, () => new Response("REMOTEVIDEO", { headers: { "content-type": "video/mp4", "content-length": "11" } }));
  ytRoutes();
  const out = (await callTool(who, "publish_youtube_video", { channel: "PDFTool4U", title: "Daily demo", description: "Watch #PDF", privacy: "unlisted", video_url: "https://cdn.example.com/v.mp4" }, req)) as { status: string; results: { url: string }[] };
  assert.equal(out.status, "posted");
  assert.equal(out.results[0].url, "https://youtu.be/VID123");
  const meta = JSON.parse(calls.find((c) => /upload\/youtube\/v3\/videos\?/.test(c.url))!.body);
  assert.equal(meta.snippet.title, "Daily demo");
  assert.equal(meta.status.privacyStatus, "unlisted");
  assert.equal(calls.find((c) => /upload\.youtube\.test/.test(c.url))!.body, "REMOTEVIDEO");
});

test("a web page instead of a video is refused with a clear message", async () => {
  on("GET", /share\.example\.com/, () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(downloadVideo(orgId, "https://share.example.com/x"), /web page, not a video/);
});
