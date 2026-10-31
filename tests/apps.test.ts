// Run with `npm test` (sets DATABASE_URL=pglite://memory). External services are simulated by a fake fetch.
process.env.ALLOW_PRIVATE_NETWORK = "1";
process.env.APP_URL = "https://ff.test";
process.env.GOOGLE_CLIENT_ID = "gid";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";
process.env.TWITTER_CLIENT_ID = "xid";
process.env.TWITTER_CLIENT_SECRET = "xsecret";
process.env.FACEBOOK_CLIENT_ID = "fbid";
process.env.FACEBOOK_CLIENT_SECRET = "fbsecret";

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, schema } from "../lib/db";
import { registerUser } from "../lib/auth";
import { encryptJson, decryptJson } from "../lib/crypto";
import { startRun } from "../lib/engine/queue";
import { CATALOG, APPS, connectionApps } from "../lib/engine/catalog";
import { RUNNERS } from "../lib/engine/runner";
import { POLLERS } from "../lib/engine/pollers";
import { PROVIDERS } from "../lib/oauth/providers";
import { exchangeCode } from "../lib/oauth/tokens";
import { checkWatch } from "../lib/engine/scheduler";
import type { Graph } from "../db/schema";

// ── fake internet ───────────────────────────────────────────────────────────
type Call = { method: string; url: string; headers: Record<string, string>; body: string };
type Route = { match: RegExp; method?: string; reply: (c: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } };
let calls: Call[] = [];
let routes: Route[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const b = init.body;
  const body = b == null ? "" : typeof b === "string" ? b : b instanceof URLSearchParams ? b.toString() : Buffer.from(b as Uint8Array).toString("utf8");
  const call = { method, url, headers, body };
  calls.push(call);
  const r = routes.find((x) => x.match.test(url) && (!x.method || x.method === method));
  if (!r) return new Response(JSON.stringify({ error: `no route for ${method} ${url}` }), { status: 599 });
  const out = r.reply(call);
  const resBody = out.text ?? (out.json === undefined ? "" : JSON.stringify(out.json));
  return new Response(resBody === "" && [204, 304].includes(out.status ?? 200) ? null : resBody, { status: out.status ?? 200, headers: { "content-type": out.text !== undefined ? "application/xml" : "application/json", ...(out.headers ?? {}) } });
}) as typeof fetch;
const on = (method: string, match: RegExp, reply: Route["reply"]) => routes.push({ method, match, reply });
const last = (re: RegExp) => [...calls].reverse().find((c) => re.test(c.url))!;

let orgId = "";
before(async () => {
  await migrate(db as never, { migrationsFolder: "./db/migrations" });
  orgId = (await registerUser("apps@example.com", "password123", "Apps")).org.id;
  await db.update(schema.orgs).set({ plan: "PRO", creditsMonthly: 100000 }).where(eq(schema.orgs.id, orgId));
});
beforeEach(() => {
  calls = [];
  routes = [];
});

async function conn(app: string, secret: unknown) {
  const [c] = await db.insert(schema.connections).values({ orgId, app, name: app, secret: encryptJson(secret) }).returning();
  return c.id;
}
async function run1(type: string, config: Record<string, unknown>, input: unknown = {}) {
  const g: Graph = {
    nodes: [
      { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, data: { config: {} } },
      { id: "s", type, position: { x: 1, y: 0 }, data: { config } },
    ],
    edges: [{ id: "e", source: "t", target: "s" }],
  };
  const [wf] = await db.insert(schema.workflows).values({ orgId, name: type, graph: g }).returning();
  const { outcome } = await startRun(wf, "manual", input, { wait: true });
  return outcome!;
}
const oauth = (provider: string, extra: Record<string, unknown> = {}) => ({ oauth: true, provider, accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 3600_000, extra });

// ── catalog integrity ───────────────────────────────────────────────────────
test("every step has an implementation, every watch trigger a poller, every connection an app", () => {
  for (const m of CATALOG) {
    assert.ok(RUNNERS[m.type], `no runner for ${m.type}`);
    if (m.poll) assert.ok(POLLERS[m.type], `no poller for ${m.type}`);
    for (const f of m.fields.filter((x) => x.type === "connection")) for (const a of connectionApps(f)) assert.ok(APPS[a], `${m.type}: unknown app ${a}`);
  }
  for (const [k, a] of Object.entries(APPS)) if (a.oauth) assert.ok(PROVIDERS[a.oauth], `${k}: unknown provider ${a.oauth}`);
  const apps = new Set(CATALOG.map((m) => m.app));
  assert.ok(apps.size >= 60, `only ${apps.size} apps`);
});

// ── social ──────────────────────────────────────────────────────────────────
test("X: posts with bearer token, reply and returns a link", async () => {
  const id = await conn("twitter", oauth("twitter", { username: "flowforge" }));
  on("POST", /api\.x\.com\/2\/tweets/, () => ({ status: 201, json: { data: { id: "99", text: "hi" } } }));
  const r = await run1("x.post", { connectionId: id, text: "hello {{trigger.who}}", replyTo: "5" }, { who: "world" });
  assert.equal(r.status, "SUCCESS", r.error);
  const c = last(/tweets/);
  assert.equal(c.headers.authorization, "Bearer AT");
  assert.deepEqual(JSON.parse(c.body), { text: "hello world", reply: { in_reply_to_tweet_id: "5" } });
  assert.equal((r.output as { url: string }).url, "https://x.com/flowforge/status/99");
});

test("Instagram: container → wait → publish → permalink, using the Page's linked IG account", async () => {
  const id = await conn("facebook", oauth("facebook"));
  on("GET", /\/me\/accounts/, () => ({ json: { data: [{ id: "PAGE", access_token: "PT", instagram_business_account: { id: "IG1" } }] } }));
  on("POST", /\/IG1\/media$/, () => ({ json: { id: "C1" } }));
  let polls = 0;
  on("GET", /\/C1\?/, () => ({ json: { status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" } }));
  on("POST", /\/IG1\/media_publish/, () => ({ json: { id: "M1" } }));
  on("GET", /\/M1\?/, () => ({ json: { permalink: "https://instagram.com/p/abc" } }));
  const r = await run1("instagram.post", { connectionId: id, kind: "photo", mediaUrl: "https://cdn.test/a.jpg", caption: "New drop" });
  assert.equal(r.status, "SUCCESS", r.error);
  const create = new URLSearchParams(last(/IG1\/media$/).body);
  assert.equal(create.get("image_url"), "https://cdn.test/a.jpg");
  assert.equal(create.get("caption"), "New drop");
  assert.equal(new URLSearchParams(last(/media_publish/).body).get("creation_id"), "C1");
  assert.deepEqual(r.output, { id: "M1", permalink: "https://instagram.com/p/abc" });
});

test("Facebook: posts to the Page with the Page token", async () => {
  const id = await conn("facebook", oauth("facebook"));
  on("GET", /\/me\/accounts/, () => ({ json: { data: [{ id: "PAGE", access_token: "PT" }] } }));
  on("POST", /\/PAGE\/feed/, () => ({ json: { id: "PAGE_1" } }));
  const r = await run1("facebook.post", { connectionId: id, message: "Hello", link: "https://x.test" });
  assert.equal(r.status, "SUCCESS", r.error);
  const b = new URLSearchParams(last(/feed/).body);
  assert.equal(b.get("access_token"), "PT");
  assert.equal(b.get("link"), "https://x.test");
});

test("LinkedIn: escapes little-text, sends version header, reads id from header", async () => {
  const id = await conn("linkedin", oauth("linkedin", { personUrn: "urn:li:person:abc" }));
  on("POST", /rest\/posts/, () => ({ status: 201, headers: { "x-restli-id": "urn:li:share:7" } }));
  const r = await run1("linkedin.post", { connectionId: id, text: "Launch (beta) #automation" });
  assert.equal(r.status, "SUCCESS", r.error);
  const c = last(/rest\/posts/);
  assert.ok(c.headers["linkedin-version"]);
  const b = JSON.parse(c.body);
  assert.equal(b.author, "urn:li:person:abc");
  assert.equal(b.commentary, "Launch \\(beta\\) \\#automation");
  assert.equal((r.output as { id: string }).id, "urn:li:share:7");
});

test("Bluesky: session then record with clickable link facets", async () => {
  const id = await conn("bluesky", { handle: "@me.bsky.social", appPassword: "pw" });
  on("POST", /createSession/, () => ({ json: { accessJwt: "J", did: "did:plc:1" } }));
  on("POST", /createRecord/, () => ({ json: { uri: "at://did:plc:1/app.bsky.feed.post/3k", cid: "c" } }));
  const r = await run1("bluesky.post", { connectionId: id, text: "Read https://ff.test/x now" });
  assert.equal(r.status, "SUCCESS", r.error);
  const rec = JSON.parse(last(/createRecord/).body).record;
  assert.deepEqual(rec.facets[0].index, { byteStart: 5, byteEnd: 22 });
  assert.equal((r.output as { url: string }).url, "https://bsky.app/profile/me.bsky.social/post/3k");
});

test("Reddit: reports API validation errors clearly", async () => {
  const id = await conn("reddit", { clientId: "a", clientSecret: "b", username: "u", password: "p" });
  on("POST", /access_token/, () => ({ json: { access_token: "R" } }));
  on("POST", /api\/submit/, () => ({ json: { json: { errors: [["SUBREDDIT_NOEXIST", "that subreddit doesn't exist", "sr"]] } } }));
  const r = await run1("reddit.post", { connectionId: id, subreddit: "r/nope", title: "t", kind: "self", text: "x" });
  assert.equal(r.status, "ERROR");
  assert.match(r.error!, /subreddit doesn't exist/);
});

// ── google / microsoft ──────────────────────────────────────────────────────
test("Gmail: sends a base64url MIME message with UTF-8 subject", async () => {
  const id = await conn("google_oauth", oauth("google"));
  on("POST", /messages\/send/, () => ({ json: { id: "m1", threadId: "t1" } }));
  const r = await run1("gmail.send", { connectionId: id, to: "a@b.co", subject: "Namaste 🙏", body: "<b>Hi</b>" });
  assert.equal(r.status, "SUCCESS", r.error);
  const mime = Buffer.from(JSON.parse(last(/send/).body).raw, "base64url").toString();
  assert.match(mime, /^To: a@b.co/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
});

test("expired Google token is refreshed, saved, and used", async () => {
  const id = await conn("google_oauth", { ...oauth("google"), expiresAt: Date.now() - 1000 });
  on("POST", /oauth2\.googleapis\.com\/token/, () => ({ json: { access_token: "NEW", expires_in: 3600 } }));
  on("POST", /messages\/send/, () => ({ json: { id: "m2", threadId: "t" } }));
  const r = await run1("gmail.send", { connectionId: id, to: "a@b.co", subject: "x", body: "y" });
  assert.equal(r.status, "SUCCESS", r.error);
  assert.equal(new URLSearchParams(last(/oauth2\.googleapis\.com\/token/).body).get("grant_type"), "refresh_token");
  assert.equal(last(/send/).headers.authorization, "Bearer NEW");
  const [row] = await db.select().from(schema.connections).where(eq(schema.connections.id, id));
  const saved = decryptJson<{ accessToken: string; refreshToken: string }>(row.secret);
  assert.equal(saved.accessToken, "NEW");
  assert.equal(saved.refreshToken, "RT", "keeps the old refresh token when none is returned");
});

test("expired token without refresh token asks the user to reconnect", async () => {
  const id = await conn("facebook", { ...oauth("facebook"), refreshToken: undefined, expiresAt: Date.now() - 1000 });
  const r = await run1("facebook.post", { connectionId: id, message: "x" });
  assert.equal(r.status, "ERROR");
  assert.match(r.error!, /Reconnect it on the Connections page/);
});

test("YouTube upload: resumable session then PUT of the downloaded file", async () => {
  const id = await conn("google_oauth", oauth("google"));
  on("GET", /cdn\.test\/clip\.mp4/, () => ({ text: "VIDEOBYTES", headers: { "content-type": "video/mp4" } }));
  on("POST", /upload\/youtube/, () => ({ status: 200, headers: { location: "https://upload.test/session1" } }));
  on("PUT", /upload\.test\/session1/, () => ({ json: { id: "vid1", status: { privacyStatus: "unlisted" } } }));
  const r = await run1("youtube.upload", { connectionId: id, videoUrl: "https://cdn.test/clip.mp4", title: "Demo", privacy: "unlisted", tags: "a, b" });
  assert.equal(r.status, "SUCCESS", r.error);
  assert.deepEqual(JSON.parse(last(/upload\/youtube/).body).snippet.tags, ["a", "b"]);
  assert.equal(last(/session1/).body, "VIDEOBYTES");
  assert.equal((r.output as { url: string }).url, "https://youtu.be/vid1");
});

test("Google Sheets accepts a sign-in connection too", async () => {
  const id = await conn("google_oauth", oauth("google"));
  on("POST", /values\/.*:append/, () => ({ json: { updates: { updatedRange: "Sheet1!A2:B2" } } }));
  const r = await run1("sheets.append", { connectionId: id, spreadsheetId: "S", range: "Sheet1!A1", values: '["{{trigger.a}}", 2]' }, { a: "x" });
  assert.equal(r.status, "SUCCESS", r.error);
  assert.deepEqual(JSON.parse(last(/append/).body), { values: [["x", 2]] });
});

// ── business ────────────────────────────────────────────────────────────────
test("WhatsApp: template with parameters", async () => {
  const id = await conn("whatsapp", { accessToken: "W", phoneNumberId: "123" });
  on("POST", /\/123\/messages/, () => ({ json: { messages: [{ id: "wamid.1" }] } }));
  const r = await run1("whatsapp.send", { connectionId: id, to: "+91 98765-43210", mode: "template", template: "order_ready", language: "en", params: "Asha, #42" });
  assert.equal(r.status, "SUCCESS", r.error);
  const b = JSON.parse(last(/messages/).body);
  assert.equal(b.to, "919876543210");
  assert.deepEqual(b.template.components[0].parameters, [{ type: "text", text: "Asha" }, { type: "text", text: "#42" }]);
});

test("HubSpot: falls back to update when the contact already exists", async () => {
  const id = await conn("hubspot", { accessToken: "H" });
  on("POST", /objects\/contacts$/, () => ({ status: 409, json: { message: "Contact already exists" } }));
  on("PATCH", /contacts\/a%40b\.co\?idProperty=email/, () => ({ json: { id: "7", properties: {} } }));
  const r = await run1("hubspot.contact", { connectionId: id, email: "a@b.co", firstname: "A", extra: "{}" });
  assert.equal(r.status, "SUCCESS", r.error);
  assert.equal((r.output as { id: string }).id, "7");
});

test("Shopify rejects a non-Shopify store domain", async () => {
  const id = await conn("shopify", { shop: "evil.example.com", accessToken: "S" });
  const r = await run1("shopify.order", { connectionId: id, orderId: "1" });
  assert.equal(r.status, "ERROR");
  assert.match(r.error!, /Store domain looks wrong/);
});

test("Linear: surfaces GraphQL errors", async () => {
  const id = await conn("linear", { apiKey: "L" });
  on("POST", /api\.linear\.app/, () => ({ json: { errors: [{ message: "Team not found" }] } }));
  const r = await run1("linear.issue", { connectionId: id, teamId: "x", title: "t" });
  assert.equal(r.status, "ERROR");
  assert.match(r.error!, /Team not found/);
});

test("Mailchimp: upserts by email hash in the key's data center and adds tags", async () => {
  const id = await conn("mailchimp", { apiKey: "abc-us21" });
  on("PUT", /us21\.api\.mailchimp\.com\/3\.0\/lists\/L1\/members\/[0-9a-f]{32}$/, () => ({ json: { id: "h", status: "subscribed" } }));
  on("POST", /members\/[0-9a-f]{32}\/tags/, () => ({ status: 204 }));
  const r = await run1("mailchimp.subscribe", { connectionId: id, listId: "L1", email: "Asha@Example.com", tags: "vip" });
  assert.equal(r.status, "SUCCESS", r.error);
  assert.match(last(/members\/[0-9a-f]{32}$/).url, /\/4a1510e2de119558027b5907568d35a2$/); // md5("asha@example.com")
});

// ── watch triggers ──────────────────────────────────────────────────────────
const feed = (items: string[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map((i) => `<item><title>${i}</title><link>https://blog.test/${i}</link><guid>${i}</guid><description>&lt;p&gt;About ${i}&lt;/p&gt;</description></item>`).join("")}</channel></rss>`;

test("RSS watch: first check sets a baseline, later checks run once per new item, oldest first", async () => {
  let items = ["b", "a"];
  on("GET", /blog\.test\/feed/, () => ({ text: feed(items) }));
  const g: Graph = {
    nodes: [
      { id: "t", type: "rss.watch", position: { x: 0, y: 0 }, data: { config: { url: "https://blog.test/feed", intervalMin: 15 } } },
      { id: "c", type: "data.compose", position: { x: 1, y: 0 }, data: { config: { template: "New: {{trigger.title}} — {{trigger.summary}}" } } },
    ],
    edges: [{ id: "e", source: "t", target: "c" }],
  };
  const [wf0] = await db.insert(schema.workflows).values({ orgId, name: "rss", graph: g, active: true, triggerType: "schedule", intervalMin: 15 }).returning();
  assert.equal(await checkWatch(wf0), 0, "baseline: no runs");
  items = ["d", "c", "b", "a"];
  const [wf1] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, wf0.id));
  assert.equal(await checkWatch(wf1), 2);
  await new Promise((r) => setTimeout(r, 300)); // runs execute in the background
  const runs = await db.select().from(schema.executions).where(eq(schema.executions.workflowId, wf0.id));
  const texts = runs.map((x) => (x.output as { text: string })?.text).sort();
  assert.deepEqual(texts, ["New: c — About c", "New: d — About d"]);
  const [wf2] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, wf0.id));
  assert.equal(await checkWatch(wf2), 0, "nothing new → nothing runs");
});

test("Shopify watch: baseline from latest order, then since_id", async () => {
  const id = await conn("shopify", { shop: "demo.myshopify.com", accessToken: "S" });
  on("GET", /orders\.json\?status=any&limit=1/, () => ({ json: { orders: [{ id: 100 }] } }));
  on("GET", /since_id=100/, () => ({ json: { orders: [{ id: 102, name: "#1002" }, { id: 101, name: "#1001" }] } }));
  const poller = POLLERS["shopify.watch_orders"];
  const { connectionHelpers } = await import("../lib/engine/connections");
  const h = connectionHelpers(orgId);
  const first = await poller({ config: { connectionId: id }, state: null, h });
  assert.deepEqual(first, { items: [], state: { sinceId: 100 } });
  const next = await poller({ config: { connectionId: id }, state: first.state, h });
  assert.deepEqual((next.items as { id: number }[]).map((o) => o.id), [101, 102]);
  assert.deepEqual(next.state, { sinceId: 102 });
});

test("a failing watch check shows up in Run history", async () => {
  on("GET", /broken\.test/, () => ({ status: 500, text: "oops" }));
  const g: Graph = { nodes: [{ id: "t", type: "rss.watch", position: { x: 0, y: 0 }, data: { config: { url: "https://broken.test/feed" } } }], edges: [] };
  const [wf] = await db.insert(schema.workflows).values({ orgId, name: "broken", graph: g }).returning();
  await checkWatch(wf);
  const [ex] = await db.select().from(schema.executions).where(eq(schema.executions.workflowId, wf.id));
  assert.equal(ex.status, "ERROR");
  assert.match(ex.error!, /Checking for new items failed/);
});

// ── one-click sign-in ───────────────────────────────────────────────────────
test("OAuth: X code exchange uses Basic auth + PKCE verifier and labels the account", async () => {
  on("POST", /api\.x\.com\/2\/oauth2\/token/, () => ({ json: { access_token: "A", refresh_token: "R", expires_in: 7200, scope: "tweet.write" } }));
  on("GET", /users\/me/, () => ({ json: { data: { username: "asha" } } }));
  const s = await exchangeCode("twitter", "CODE", "VERIFIER");
  const c = last(/oauth2\/token/);
  assert.equal(c.headers.authorization, "Basic " + Buffer.from("xid:xsecret").toString("base64"));
  const b = new URLSearchParams(c.body);
  assert.equal(b.get("code_verifier"), "VERIFIER");
  assert.equal(b.get("redirect_uri"), "https://ff.test/api/oauth/callback");
  assert.equal(s.account, "@asha");
  assert.equal(s.refreshToken, "R");
  assert.ok(s.expiresAt! > Date.now());
});

test("OAuth: Facebook short-lived token is swapped for a long-lived one", async () => {
  let n = 0;
  on("POST", /oauth\/access_token/, () => ({ json: { access_token: "SHORT", expires_in: 3600 } }));
  on("GET", /oauth\/access_token\?grant_type=fb_exchange_token/, () => (n++, { json: { access_token: "LONG", expires_in: 5184000 } }));
  on("GET", /\/me\?fields=name/, () => ({ json: { name: "Asha's Bakery" } }));
  const s = await exchangeCode("facebook", "CODE");
  assert.equal(n, 1);
  assert.equal(s.accessToken, "LONG");
  assert.equal(s.account, "Asha's Bakery");
});

test.after?.(() => {
  globalThis.fetch = realFetch;
});

test("all templates are valid workflows", async () => {
  const { TEMPLATES } = await import("../lib/templates");
  const { validateGraph } = await import("../lib/engine/graph");
  for (const t of TEMPLATES) assert.deepEqual(validateGraph(t.graph), [], t.id);
});

test("database URLs: Neon snippet and channel_binding are handled", async () => {
  const { normalizePgUrl } = await import("../lib/pg-url");
  const plain = "postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
  const clean = "postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  assert.equal(normalizePgUrl(plain), clean);
  assert.equal(normalizePgUrl(`psql '${plain}'`), clean);
  assert.equal(normalizePgUrl(` DATABASE_URL="${plain}" `), clean);
  assert.throws(() => normalizePgUrl("psql -h host -U user"), /should start with postgresql/);
});
