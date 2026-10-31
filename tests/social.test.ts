// Social publisher: LinkedIn PDF/picture upload flow, Facebook/Instagram via public media links,
// character limits, scheduling, credits and hashtag suggestions. External APIs are faked.
process.env.APP_URL = "https://ff.test";
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, schema } from "../lib/db";
import { registerUser } from "../lib/auth";
import { encryptJson } from "../lib/crypto";
import { accountsFrom, claimPost, mediaUrl, publishPost, setPollDelay, tickPosts, xLength } from "../lib/social/publish";
import { keywordHashtags, suggestHashtags } from "../lib/social/hashtags";
import { liText } from "../lib/engine/modules/social";

type Call = { method: string; url: string; headers: Record<string, string>; body: string; raw: unknown };
type Route = { match: RegExp; method?: string; reply: (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> } };
let calls: Call[] = [];
let routes: Route[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const b = init.body;
  const body = b == null ? "" : typeof b === "string" ? b : b instanceof URLSearchParams ? b.toString() : b instanceof FormData ? "[form]" : Buffer.from(b as Uint8Array).toString("utf8");
  const call = { method, url, headers, body, raw: b };
  calls.push(call);
  const r = routes.find((x) => x.match.test(url) && (!x.method || x.method === method));
  if (!r) return new Response(JSON.stringify({ error: `no route for ${method} ${url}` }), { status: 599 });
  const out = r.reply(call);
  return new Response(out.json === undefined ? null : JSON.stringify(out.json), { status: out.status ?? 200, headers: { "content-type": "application/json", ...(out.headers ?? {}) } });
}) as typeof fetch;
const on = (method: string, match: RegExp, reply: Route["reply"]) => routes.push({ method, match, reply });
const find = (re: RegExp, method?: string) => calls.find((c) => re.test(c.url) && (!method || c.method === method));

let orgId = "";
before(async () => {
  await migrate(db as never, { migrationsFolder: "./db/migrations" });
  orgId = (await registerUser("social@example.com", "password123", "Social")).org.id;
  await db.update(schema.orgs).set({ creditsMonthly: 1000 }).where(eq(schema.orgs.id, orgId));
  setPollDelay(1);
});
beforeEach(() => {
  calls = [];
  routes = [];
});

const oauth = (provider: string, extra: Record<string, unknown> = {}) => ({ oauth: true, provider, accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 3600_000, extra });
async function conn(app: string, secret: unknown, name = app) {
  const [c] = await db.insert(schema.connections).values({ orgId, app, name, secret: encryptJson(secret) }).returning();
  return c.id;
}
async function file(name: string, mime: string, bytes = "PDFDATA") {
  const [m] = await db.insert(schema.media).values({ orgId, token: "tok123", name, mime, size: bytes.length, data: Buffer.from(bytes) }).returning();
  return m;
}
async function post(v: Partial<typeof schema.posts.$inferInsert> & { targets: string[] }) {
  const [p] = await db.insert(schema.posts).values({ orgId, baseUrl: "https://ff.test", status: "posting", ...v }).returning();
  return p;
}

test("accounts: Facebook connection gives a Page and an Instagram target; unknown apps are skipped", () => {
  const a = accountsFrom([
    { id: "c1", app: "linkedin", name: "Me" },
    { id: "c2", app: "facebook", name: "Shop" },
    { id: "c3", app: "notion", name: "Docs" },
  ]);
  assert.deepEqual(
    a.map((x) => [x.target, x.channel]),
    [
      ["c1", "linkedin"],
      ["c2", "facebook"],
      ["c2:instagram", "instagram"],
    ],
  );
});

test("LinkedIn little text keeps #hashtags clickable and escapes the rest", () => {
  assert.equal(liText("Hi (all) #AI #Startup_India, C# rocks"), "Hi \\(all\\) {hashtag|\\#|AI} {hashtag|\\#|Startup_India}, C\\# rocks");
});

test("LinkedIn PDF: initialize upload → PUT bytes → wait until AVAILABLE → post as document carousel", async () => {
  const li = await conn("linkedin", oauth("linkedin", { personUrn: "urn:li:person:abc" }), "LinkedIn (Santosh)");
  const m = await file("AI Roadmap.pdf", "application/pdf");
  let polls = 0;
  on("POST", /rest\/documents\?action=initializeUpload/, () => ({ json: { value: { uploadUrl: "https://upload.linkedin.test/u1", document: "urn:li:document:D1" } } }));
  on("PUT", /upload\.linkedin\.test/, () => ({ status: 201 }));
  on("GET", /rest\/documents\/urn%3Ali%3Adocument%3AD1/, () => ({ json: { status: ++polls < 3 ? "PROCESSING" : "AVAILABLE" } }));
  on("POST", /rest\/posts/, () => ({ status: 201, headers: { "x-restli-id": "urn:li:share:99" } }));
  const p = await post({ text: "My roadmap #AI", mediaId: m.id, mediaTitle: "AI Roadmap 2026", link: "https://example.com", targets: [li] });

  const saved = await publishPost(p.id);
  assert.equal(saved.status, "posted");
  assert.equal(saved.results![0].url, "https://www.linkedin.com/feed/update/urn:li:share:99");
  assert.equal(polls, 3);
  const init = JSON.parse(find(/initializeUpload/)!.body);
  assert.equal(init.initializeUploadRequest.owner, "urn:li:person:abc");
  const put = find(/upload\.linkedin\.test/)!;
  assert.equal(put.headers.authorization, "Bearer AT");
  assert.equal(put.body, "PDFDATA");
  const body = JSON.parse(find(/rest\/posts/)!.body);
  assert.deepEqual(body.content, { media: { id: "urn:li:document:D1", title: "AI Roadmap 2026" } });
  assert.equal(body.author, "urn:li:person:abc");
  assert.match(body.commentary, /\{hashtag\|\\#\|AI\}/);
  assert.match(body.commentary, /https:\/\/example\.com/); // link goes in the text when a file is attached
  assert.equal(find(/rest\/posts/)!.headers["x-restli-protocol-version"], "2.0.0");
});

test("LinkedIn picture uses the Images API; link-only post becomes an article", async () => {
  const li = await conn("linkedin", oauth("linkedin", { personUrn: "urn:li:person:abc" }));
  const img = await file("pic.png", "image/png", "PNG");
  on("POST", /rest\/images\?action=initializeUpload/, () => ({ json: { value: { uploadUrl: "https://upload.linkedin.test/i", image: "urn:li:image:I1" } } }));
  on("PUT", /upload\.linkedin\.test/, () => ({ status: 201 }));
  on("GET", /rest\/images\//, () => ({ json: { status: "AVAILABLE" } }));
  on("POST", /rest\/posts/, () => ({ status: 201, headers: { "x-restli-id": "urn:li:share:1" } }));
  await publishPost((await post({ text: "pic", mediaId: img.id, mediaTitle: "A chart", targets: [li] })).id);
  assert.deepEqual(JSON.parse(find(/rest\/posts/)!.body).content, { media: { id: "urn:li:image:I1", altText: "A chart" } });

  calls = [];
  await publishPost((await post({ text: "read this", link: "https://blog.test/a", targets: [li] })).id);
  assert.deepEqual(JSON.parse(find(/rest\/posts/)!.body).content, { article: { source: "https://blog.test/a", title: "https://blog.test/a" } });
});

test("Facebook Page photo and Instagram use the public media link; PDF on Facebook becomes a link; one failure = partial", async () => {
  const fb = await conn("facebook", oauth("facebook"), "Shop");
  const img = await file("p.jpg", "image/jpeg", "JPG");
  on("GET", /\/me\/accounts/, () => ({ json: { data: [{ id: "PAGE", access_token: "PAGE_TOKEN", instagram_business_account: { id: "IG1" } }] } }));
  on("POST", /\/PAGE\/photos/, () => ({ json: { id: "PH", post_id: "PAGE_PH" } }));
  on("POST", /\/IG1\/media$/, () => ({ json: { id: "CONT" } }));
  on("GET", /\/CONT\?/, () => ({ json: { status_code: "FINISHED" } }));
  on("POST", /\/IG1\/media_publish/, () => ({ json: { id: "IGPOST" } }));
  on("GET", /\/IGPOST\?/, () => ({ json: { permalink: "https://instagram.com/p/x" } }));
  const saved = await publishPost((await post({ text: "New drop", mediaId: img.id, targets: [fb, `${fb}:instagram`] })).id);
  assert.equal(saved.status, "posted", JSON.stringify(saved.results));
  const url = mediaUrl("https://ff.test", img);
  assert.equal(new URLSearchParams(find(/\/PAGE\/photos/)!.body).get("url"), url);
  assert.equal(new URLSearchParams(find(/\/PAGE\/photos/)!.body).get("access_token"), "PAGE_TOKEN");
  assert.equal(new URLSearchParams(find(/\/IG1\/media$/)!.body).get("image_url"), url);
  assert.equal(saved.results![1].url, "https://instagram.com/p/x");

  calls = [];
  const pdf = await file("deck.pdf", "application/pdf");
  on("POST", /\/PAGE\/feed/, () => ({ json: { id: "PAGE_F" } }));
  const s2 = await publishPost((await post({ text: "Deck", mediaId: pdf.id, targets: [fb, `${fb}:instagram`] })).id);
  assert.equal(s2.status, "partial");
  assert.match(new URLSearchParams(find(/\/PAGE\/feed/)!.body).get("message")!, /\/api\/media\/.+\/deck\.pdf/);
  assert.match(s2.results![0].note!, /PDF/);
  assert.match(s2.results![1].error!, /Instagram needs a picture/);
});

test("X: links count as 23 characters and over-long posts fail without calling X", async () => {
  assert.equal(xLength("hi https://example.com/a/very/long/path/that/is/long"), 3 + 23);
  const x = await conn("twitter", oauth("twitter", { username: "me" }));
  const s = await publishPost((await post({ text: "a".repeat(281), targets: [x] })).id);
  assert.equal(s.status, "failed");
  assert.match(s.results![0].error!, /281\/280/);
  assert.equal(calls.length, 0);
  on("POST", /api\.x\.com\/2\/tweets/, () => ({ json: { data: { id: "7" } } }));
  const ok = await publishPost((await post({ text: "short", link: "https://e.com", targets: [x] })).id);
  assert.equal(ok.results![0].url, "https://x.com/me/status/7");
  assert.equal(JSON.parse(find(/tweets/)!.body).text, "short\n\nhttps://e.com");
});

test("Bluesky uploads a small picture as a blob", async () => {
  const b = await conn("bluesky", { handle: "me.bsky.social", appPassword: "pw" });
  const img = await file("b.png", "image/png", "IMG");
  on("POST", /createSession/, () => ({ json: { accessJwt: "JWT", did: "did:plc:1" } }));
  on("POST", /uploadBlob/, () => ({ json: { blob: { ref: "blobref" } } }));
  on("POST", /createRecord/, () => ({ json: { uri: "at://did/app.bsky.feed.post/3k" } }));
  const s = await publishPost((await post({ text: "hello", mediaId: img.id, targets: [b] })).id);
  assert.equal(s.status, "posted", JSON.stringify(s.results));
  assert.equal(find(/uploadBlob/)!.headers["content-type"], "image/png");
  assert.deepEqual(JSON.parse(find(/createRecord/)!.body).record.embed.images[0].image, { ref: "blobref" });
});

test("scheduler publishes due posts once, charges 1 credit per account, and leaves future posts alone", async () => {
  const x = await conn("twitter", oauth("twitter", { username: "me" }));
  on("POST", /api\.x\.com\/2\/tweets/, () => ({ json: { data: { id: "8" } } }));
  const [org0] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  const due = await post({ text: "due", targets: [x], status: "scheduled", scheduledAt: new Date(Date.now() - 1000) });
  const future = await post({ text: "later", targets: [x], status: "scheduled", scheduledAt: new Date(Date.now() + 3600_000) });
  const [a, b] = await Promise.all([tickPosts(), tickPosts()]);
  assert.equal(a + b, 1);
  assert.equal(calls.filter((c) => /tweets/.test(c.url)).length, 1);
  const [d] = await db.select().from(schema.posts).where(eq(schema.posts.id, due.id));
  const [f] = await db.select().from(schema.posts).where(eq(schema.posts.id, future.id));
  assert.equal(d.status, "posted");
  assert.equal(f.status, "scheduled");
  const [org1] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  assert.equal(org1.creditsUsed - org0.creditsUsed, 1);
  assert.equal(await claimPost(due.id), false);
});

test("no credits left: nothing is posted", async () => {
  const x = await conn("twitter", oauth("twitter"));
  await db.update(schema.orgs).set({ creditsMonthly: 0, creditsUsed: 0, extraCredits: 0 }).where(eq(schema.orgs.id, orgId));
  const s = await publishPost((await post({ text: "hi", targets: [x] })).id);
  await db.update(schema.orgs).set({ creditsMonthly: 1000 }).where(eq(schema.orgs.id, orgId));
  assert.equal(s.status, "failed");
  assert.match(s.results![0].error!, /credits/);
  assert.equal(calls.length, 0);
});

test("hashtags: topic + keyword suggestions, skipping tags already in the post", async () => {
  const tags = keywordHashtags("Free PDF: my AI automation roadmap for startup founders #AI");
  assert.ok(tags.includes("Automation"));
  assert.ok(tags.includes("Startup"));
  assert.ok(!tags.map((t) => t.toLowerCase()).includes("ai"));
  assert.ok(tags.length <= 12);
  const r = await suggestHashtags("Hiring data analysts who know SQL and Power BI");
  assert.equal(r.source, "keywords");
  assert.ok(r.tags.includes("Hiring") && r.tags.includes("SQL"));
});

// ── copy & clean ────────────────────────────────────────────────────────────
import { cleanPost, rewritePost } from "../lib/social/rewrite";
import { publisher } from "../lib/engine/modules/publisher";
import { TEMPLATES } from "../lib/templates";
import { CATALOG_BY_TYPE } from "../lib/engine/catalog";
import { RUNNERS } from "../lib/engine/runner";

const PASTED = `Priya Sharma
• 2nd
Data Analyst | Power BI
1w • Edited •
Most people learn SQL the wrong way.

Here's the order that worked for me:
1. SELECT & WHERE
2. JOINs
3. Window functions …see more

Thanks @Rahul Verma for the tips!
♻️ Repost to help your network
Follow Priya Sharma for more data tips

#SQL #DataAnalytics #Learning
No alternative text description for this image
1,234 reactions
87 comments
Like
Comment
Repost
Send`;

test("cleanPost strips LinkedIn clutter, follow/repost asks and the hashtag block, keeping the content", () => {
  const { text, hashtags } = cleanPost(PASTED);
  assert.ok(text.startsWith("Most people learn SQL the wrong way."), text.slice(0, 80));
  assert.match(text, /3\. Window functions$/m);
  assert.match(text, /Thanks Rahul Verma for the tips!/);
  for (const junk of [/see more/i, /Repost to help/, /Follow Priya/, /reactions/, /^Like$/m, /^Send$/m, /#SQL/, /1w/, /No alternative text/])
    assert.doesNotMatch(text, junk);
  assert.deepEqual(hashtags, ["SQL", "DataAnalytics", "Learning"]);
});

test("rewritePost without AI: cleans, adds credit and hashtags (original tags first)", async () => {
  const r = await rewritePost(PASTED, { style: "rewrite", author: "Priya Sharma", url: "https://lnkd.in/x" });
  assert.equal(r.source, "clean");
  assert.match(r.text, /📌 Credit: Priya Sharma — https:\/\/lnkd\.in\/x/);
  assert.deepEqual(r.hashtags.slice(0, 3), ["SQL", "DataAnalytics", "Learning"]);
  assert.ok(r.text.trim().endsWith(r.hashtags.map((t) => `#${t}`).join(" ")));
  const noCredit = await rewritePost("<p>Hello <b>world</b></p><p>Line&nbsp;two</p>", { credit: false, maxTags: 0 });
  assert.equal(noCredit.text, "Hello world\n\nLine two");
});

test("workflow steps: rewrite then save to drafts; 'post now' publishes to the chosen account", async () => {
  assert.ok(CATALOG_BY_TYPE["social.rewrite"] && RUNNERS["social.rewrite"] && RUNNERS["social.draft"]);
  const ctx = (config: Record<string, unknown>) => ({ config, orgId, log: () => {} }) as never;
  const r = (await publisher["social.rewrite"](ctx({ text: PASTED, style: "clean", author: "Priya", url: "" }))).output as { text: string };
  const d = (await publisher["social.draft"](ctx({ text: r.text, mode: "draft" }))).output as { postId: string; status: string };
  const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, d.postId));
  assert.equal(row.status, "draft");
  assert.match(row.text, /Credit: Priya/);
  // drafts are never picked up by the scheduler
  assert.equal((await db.select().from(schema.posts).where(eq(schema.posts.status, "posting"))).length, 0);

  const x = await conn("twitter", oauth("twitter", { username: "me" }));
  on("POST", /api\.x\.com\/2\/tweets/, () => ({ json: { data: { id: "55" } } }));
  const out = (await publisher["social.draft"](ctx({ text: "Short take", mode: "post", connectionId: x }))).output as { status: string; url: string };
  assert.equal(out.status, "posted");
  assert.equal(out.url, "https://x.com/me/status/55");
  await assert.rejects(publisher["social.draft"](ctx({ text: "x", mode: "post" })), /Pick the account/);
});

test("reshare templates only use real steps", () => {
  for (const id of ["creator-reshare-review", "paste-post-to-linkedin"]) {
    const t = TEMPLATES.find((x) => x.id === id)!;
    assert.ok(t, id);
    for (const n of t.graph.nodes) assert.ok(CATALOG_BY_TYPE[n.type], `${id}: ${n.type}`);
  }
});
