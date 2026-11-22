// MCP connector for Claude: OAuth discovery, DCR, PKCE code exchange, refresh rotation, MCP calls with the token.
process.env.APP_URL = "https://ff.example.com";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, schema } from "../lib/db";
import { registerUser } from "../lib/auth";
import { createCode, redirectAllowed, resolveClient } from "../lib/mcp-oauth";
import { checkAuthorize } from "../lib/mcp-authorize";
import * as register from "../app/api/mcp-oauth/register/route";
import * as token from "../app/api/mcp-oauth/token/route";
import * as resourceMeta from "../app/api/mcp-oauth/metadata/resource/route";
import * as serverMeta from "../app/api/mcp-oauth/metadata/server/route";
import * as revoke from "../app/api/mcp-oauth/revoke/route";
import * as mcp from "../app/api/mcp/route";

let orgId = "";
let userId = "";
before(async () => {
  await migrate(db as never, { migrationsFolder: "./db/migrations" });
  const r = await registerUser("mcp@example.com", "password123", "MCP");
  orgId = r.org.id;
  userId = r.user.id;
  await db.update(schema.orgs).set({ plan: "PRO", creditsMonthly: 1000 }).where(eq(schema.orgs.id, orgId));
});

const CB = "https://claude.ai/api/mcp/auth_callback";
const form = (o: Record<string, string>) => new Request("https://ff.example.com/api/mcp-oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
const rpc = (tok: string | null, body: unknown) =>
  new Request("https://ff.example.com/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });

test("discovery: 401 points at protected-resource metadata, which points at the auth server (DCR + CIMD + S256)", async () => {
  const r = await mcp.POST(rpc(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate")!, /resource_metadata="https:\/\/ff\.example\.com\/\.well-known\/oauth-protected-resource"/);
  const pr = await (await resourceMeta.GET(new Request("https://ff.example.com/.well-known/oauth-protected-resource"))).json();
  assert.equal(pr.resource, "https://ff.example.com/api/mcp");
  assert.deepEqual(pr.authorization_servers, ["https://ff.example.com"]);
  const as = await (await serverMeta.GET(new Request("https://ff.example.com/.well-known/oauth-authorization-server"))).json();
  assert.equal(as.issuer, "https://ff.example.com");
  assert.equal(as.registration_endpoint, "https://ff.example.com/api/mcp-oauth/register");
  assert.equal(as.authorization_endpoint, "https://ff.example.com/oauth/authorize");
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.ok(as.token_endpoint_auth_methods_supported.includes("none"));
});

test("full flow: register → authorize (PKCE) → token → MCP tools → refresh rotates → revoke", async () => {
  const reg = await register.POST(new Request("https://ff.example.com/api/mcp-oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [CB] }) }));
  assert.equal(reg.status, 201);
  const client = await reg.json();
  assert.match(client.client_id, /^ffc_/);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const checked = await checkAuthorize({ client_id: client.client_id, redirect_uri: CB, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  assert.ok(checked.ok);
  if (!checked.ok) return;
  const code = await createCode({ client: checked.client, userId, orgId, redirectUri: CB, codeChallenge: challenge, scope: checked.scope });

  // wrong verifier fails and burns the code
  const bad = await token.POST(form({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: CB, code_verifier: "nope" }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_grant");

  const code2 = await createCode({ client: checked.client, userId, orgId, redirectUri: CB, codeChallenge: challenge, scope: checked.scope });
  const tr = await token.POST(form({ grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: CB, code_verifier: verifier }));
  assert.equal(tr.status, 200);
  const t = await tr.json();
  assert.match(t.access_token, /^ffo_/);
  assert.match(t.refresh_token, /^ffr_/);
  assert.equal(t.token_type, "Bearer");
  // codes are single-use
  assert.equal((await token.POST(form({ grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: CB, code_verifier: verifier }))).status, 400);

  // MCP with the token
  const init = await (await mcp.POST(rpc(t.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }))).json();
  assert.equal(init.result.serverInfo.name, "flowforge");
  const list = await (await mcp.POST(rpc(t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
  const names = list.result.tools.map((x: { name: string }) => x.name);
  for (const n of ["list_workflows", "create_social_post", "import_post_from_link", "list_social_accounts"]) assert.ok(names.includes(n), n);
  const accts = await (await mcp.POST(rpc(t.access_token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_social_accounts", arguments: {} } }))).json();
  assert.match(accts.result.content[0].text, /No social accounts/);
  const draft = await (await mcp.POST(rpc(t.access_token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_social_post", arguments: { text: "Hello from Claude #FlowForge", draft: true } } }))).json();
  assert.equal(draft.result.isError, false, draft.result.content[0].text);
  assert.equal(JSON.parse(draft.result.content[0].text).status, "draft");
  const [row] = await db.select().from(schema.posts).where(eq(schema.posts.orgId, orgId));
  assert.equal(row.createdById, userId);

  // refresh rotates: new pair works, old refresh token is dead
  const rr = await token.POST(form({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id }));
  assert.equal(rr.status, 200);
  const t2 = await rr.json();
  assert.notEqual(t2.refresh_token, t.refresh_token);
  assert.equal((await token.POST(form({ grant_type: "refresh_token", refresh_token: t.refresh_token }))).status, 400);
  assert.equal((await mcp.POST(rpc(t.access_token, { jsonrpc: "2.0", id: 5, method: "ping" }))).status, 401); // old access token rotated out
  assert.equal((await mcp.POST(rpc(t2.access_token, { jsonrpc: "2.0", id: 5, method: "ping" }))).status, 200);

  await revoke.POST(new Request("https://ff.example.com/api/mcp-oauth/revoke", { method: "POST", body: new URLSearchParams({ token: t2.refresh_token }).toString() }));
  assert.equal((await mcp.POST(rpc(t2.access_token, { jsonrpc: "2.0", id: 6, method: "ping" }))).status, 401);
});

test("authorize checks: unknown client and unregistered redirect are shown, not redirected; plain PKCE refused", async () => {
  const c1 = await checkAuthorize({ client_id: "ffc_nope", redirect_uri: CB, response_type: "code", code_challenge: "x", code_challenge_method: "S256" });
  assert.ok(!c1.ok && "show" in c1);
  const reg = await (await register.POST(new Request("https://x/r", { method: "POST", body: JSON.stringify({ redirect_uris: [CB] }) }))).json();
  const c2 = await checkAuthorize({ client_id: reg.client_id, redirect_uri: "https://evil.example/cb", response_type: "code", code_challenge: "x", code_challenge_method: "S256" });
  assert.ok(!c2.ok && "show" in c2);
  const c3 = await checkAuthorize({ client_id: reg.client_id, redirect_uri: CB, response_type: "code", code_challenge: "x", code_challenge_method: "plain", state: "s" });
  assert.ok(!c3.ok && "redirect" in c3 && /error=invalid_request/.test(c3.redirect) && /state=s/.test(c3.redirect));
  // DCR rejects http (non-loopback) redirects
  const bad = await register.POST(new Request("https://x/r", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) }));
  assert.equal(bad.status, 400);
});

test("Claude Code loopback redirects match on any port; CIMD clients are read from their metadata document", async () => {
  assert.ok(redirectAllowed(["http://localhost/callback"], "http://localhost:53122/callback"));
  assert.ok(redirectAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:8080/callback"));
  assert.ok(!redirectAllowed(["http://localhost/callback"], "http://localhost:53122/other"));
  assert.ok(!redirectAllowed([CB], "https://claude.ai/api/mcp/auth_callback/x"));

  const doc = "https://claude.ai/oauth/claude-code-client-metadata";
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: RequestInfo | URL) =>
    String(u) === doc ? new Response(JSON.stringify({ client_id: doc, client_name: "Claude Code", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"] })) : new Response("", { status: 404 })) as typeof fetch;
  try {
    const c = await resolveClient(doc);
    assert.equal(c?.name, "Claude Code");
    const ok = await checkAuthorize({ client_id: doc, redirect_uri: "http://localhost:3118/callback", response_type: "code", code_challenge: "x", code_challenge_method: "S256" });
    assert.ok(ok.ok);
  } finally {
    globalThis.fetch = real;
  }
});

test("free plan: tools are refused with an upgrade message (unless the user is a site admin)", async () => {
  const r = await registerUser("free@example.com", "password123", "Free");
  const reg = await (await register.POST(new Request("https://x/r", { method: "POST", body: JSON.stringify({ redirect_uris: [CB] }) }))).json();
  const v = randomBytes(32).toString("base64url");
  const client = (await resolveClient(reg.client_id))!;
  const code = await createCode({ client, userId: r.user.id, orgId: r.org.id, redirectUri: CB, codeChallenge: createHash("sha256").update(v).digest("base64url"), scope: "mcp" });
  const t = await (await token.POST(form({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: CB, code_verifier: v }))).json();
  const out = await (await mcp.POST(rpc(t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_workflows", arguments: {} } }))).json();
  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /Pro plan/);
  process.env.ADMIN_EMAILS = "free@example.com";
  const out2 = await (await mcp.POST(rpc(t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_workflows", arguments: {} } }))).json();
  delete process.env.ADMIN_EMAILS;
  assert.equal(out2.result.isError, false);
});
