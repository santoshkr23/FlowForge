/**
 * OAuth 2.1 authorization server for FlowForge's MCP endpoint, so Claude (claude.ai, Desktop, mobile,
 * Claude Code), ChatGPT and other MCP clients can connect with "Sign in to FlowForge" instead of an API key.
 *
 * - Discovery: RFC 9728 protected-resource metadata + RFC 8414 authorization-server metadata
 * - Client registration: Dynamic Client Registration (RFC 7591) and Client ID Metadata Documents (CIMD)
 * - Authorization code + PKCE (S256 only), refresh tokens rotated on every use
 */
import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "./db";
import { randomToken, sha256 } from "./crypto";
import { siteUrl } from "./oauth/providers";
import { createHash } from "node:crypto";
import type { Org, User } from "@/db/schema";

type ReqLike = { headers: { get(name: string): string | null }; url: string };

export const ACCESS_TTL_S = 60 * 60; // 1 hour
export const REFRESH_TTL_S = 60 * 24 * 3600; // 60 days
const CODE_TTL_S = 10 * 60;
export const SCOPES = ["mcp"];

export const issuer = (req?: ReqLike) => siteUrl(req);
export const mcpResource = (req?: ReqLike) => `${issuer(req)}/api/mcp`;

export function protectedResourceMetadata(req: ReqLike) {
  return {
    resource: mcpResource(req),
    authorization_servers: [issuer(req)],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "FlowForge",
    resource_documentation: `${issuer(req)}/app/settings`,
  };
}

export function authServerMetadata(req: ReqLike) {
  const base = issuer(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/mcp-oauth/token`,
    registration_endpoint: `${base}/api/mcp-oauth/register`,
    revocation_endpoint: `${base}/api/mcp-oauth/revoke`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    service_documentation: `${base}/app/settings`,
  };
}

/** The 401 that tells MCP clients where to sign in. */
export function unauthorized(req: ReqLike, message = "Sign in to FlowForge to use this connector") {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${issuer(req)}/.well-known/oauth-protected-resource", scope="${SCOPES.join(" ")}"`,
    },
  });
}

// ── clients ────────────────────────────────────────────────────────────────

export type Client = { clientId: string; name: string; redirectUris: string[] };

const isLoopback = (u: URL) => u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");

/** Is this redirect URI one of the client's? Loopback redirects match on any port (RFC 8252 §7.3). */
export function redirectAllowed(registered: string[], given: string) {
  let g: URL;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  return registered.some((r) => {
    if (r === given) return true;
    try {
      const u = new URL(r);
      return isLoopback(u) && isLoopback(g) && u.hostname === g.hostname && u.pathname === g.pathname;
    } catch {
      return false;
    }
  });
}

export function validRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:" || isLoopback(u)) return true;
    // native apps may use a private-use scheme (com.example.app:/callback)
    return !["http:", "javascript:", "data:", "file:", "vbscript:", "blob:", "about:"].includes(u.protocol);
  } catch {
    return false;
  }
}

const cimdCache = new Map<string, { at: number; client: Client }>();

/** Look up a client: a DCR registration, or an https client_id pointing at its own metadata document (CIMD). */
export async function resolveClient(clientId: string): Promise<Client | null> {
  if (!clientId) return null;
  if (/^https:\/\//.test(clientId)) {
    const hit = cimdCache.get(clientId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.client;
    try {
      const u = new URL(clientId);
      if (!u.pathname || u.pathname === "/") return null;
      const res = await fetch(clientId, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!res.ok) return null;
      const doc = (await res.json()) as { client_id?: string; client_name?: string; redirect_uris?: string[] };
      if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.length) return null;
      const client = { clientId, name: String(doc.client_name ?? u.hostname).slice(0, 100), redirectUris: doc.redirect_uris.map(String) };
      cimdCache.set(clientId, { at: Date.now(), client });
      return client;
    } catch {
      return null;
    }
  }
  const [row] = await db.select().from(schema.mcpClients).where(eq(schema.mcpClients.id, clientId)).limit(1);
  return row ? { clientId: row.id, name: row.name, redirectUris: row.redirectUris } : null;
}

export async function registerClient(input: { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown; grant_types?: unknown }) {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
  if (!uris.length) return { error: "invalid_redirect_uri", error_description: "redirect_uris is required" } as const;
  if (uris.length > 10 || uris.some((u) => !validRedirect(u) || u.length > 500)) return { error: "invalid_redirect_uri", error_description: "Each redirect URI must be https, a loopback http URL or an app scheme, without a fragment" } as const;
  const name = String(input.client_name ?? "MCP client").slice(0, 100) || "MCP client";
  const id = `ffc_${randomToken(18)}`;
  await db.insert(schema.mcpClients).values({ id, name, redirectUris: uris });
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPES.join(" "),
  } as const;
}

// ── codes & tokens ─────────────────────────────────────────────────────────

export async function createCode(p: { client: Client; userId: string; orgId: string; redirectUri: string; codeChallenge: string; scope: string; resource?: string | null }) {
  const code = `ffa_${randomToken(24)}`;
  await db.insert(schema.mcpCodes).values({
    hash: sha256(code),
    clientId: p.client.clientId,
    clientName: p.client.name,
    userId: p.userId,
    orgId: p.orgId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    scope: p.scope,
    resource: p.resource ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
  });
  // housekeeping
  db.delete(schema.mcpCodes).where(lt(schema.mcpCodes.expiresAt, new Date())).catch(() => {});
  return code;
}

type TokenOk = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };
type TokenErr = { error: string; error_description?: string; status?: number };

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function newTokens() {
  return { access: `ffo_${randomToken(30)}`, refresh: `ffr_${randomToken(30)}` };
}

export async function exchangeCode(p: { code: string; clientId: string; redirectUri: string; verifier: string }): Promise<TokenOk | TokenErr> {
  if (!p.code || !p.verifier) return { error: "invalid_request", error_description: "code and code_verifier are required" };
  // single use: delete as we read it
  const [row] = await db.delete(schema.mcpCodes).where(eq(schema.mcpCodes.hash, sha256(p.code))).returning();
  if (!row || row.expiresAt < new Date()) return { error: "invalid_grant", error_description: "The code is invalid or expired" };
  if (row.clientId !== p.clientId) return { error: "invalid_grant", error_description: "The code was issued to another client" };
  if (row.redirectUri !== p.redirectUri) return { error: "invalid_grant", error_description: "redirect_uri doesn't match the authorization request" };
  if (s256(p.verifier) !== row.codeChallenge) return { error: "invalid_grant", error_description: "PKCE verification failed" };
  const t = newTokens();
  await db.insert(schema.mcpTokens).values({
    accessHash: sha256(t.access),
    refreshHash: sha256(t.refresh),
    clientId: row.clientId,
    clientName: row.clientName,
    userId: row.userId,
    orgId: row.orgId,
    scope: row.scope,
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
  });
  return { access_token: t.access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: t.refresh, scope: row.scope };
}

export async function refreshTokens(p: { refreshToken: string; clientId?: string }): Promise<TokenOk | TokenErr> {
  if (!p.refreshToken) return { error: "invalid_request", error_description: "refresh_token is required" };
  const [row] = await db
    .select()
    .from(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.refreshHash, sha256(p.refreshToken)), gt(schema.mcpTokens.refreshExpiresAt, new Date())))
    .limit(1);
  if (!row) return { error: "invalid_grant", error_description: "The refresh token is invalid, expired or was revoked" };
  if (p.clientId && p.clientId !== row.clientId) return { error: "invalid_grant", error_description: "The refresh token belongs to another client" };
  const t = newTokens();
  const updated = await db
    .update(schema.mcpTokens)
    .set({
      accessHash: sha256(t.access),
      refreshHash: sha256(t.refresh),
      accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
    })
    .where(and(eq(schema.mcpTokens.id, row.id), eq(schema.mcpTokens.refreshHash, sha256(p.refreshToken))))
    .returning({ id: schema.mcpTokens.id });
  if (!updated.length) return { error: "invalid_grant", error_description: "The refresh token was already used" };
  return { access_token: t.access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: t.refresh, scope: row.scope };
}

export async function revokeToken(token: string) {
  const h = sha256(token);
  await db.delete(schema.mcpTokens).where(eq(schema.mcpTokens.accessHash, h));
  await db.delete(schema.mcpTokens).where(eq(schema.mcpTokens.refreshHash, h));
}

/** The workspace and person behind an MCP access token, or null. */
export async function principalFromAccessToken(token: string): Promise<{ org: Org; user: User; tokenId: string } | null> {
  if (!token.startsWith("ffo_")) return null;
  const [row] = await db
    .select({ t: schema.mcpTokens, o: schema.orgs, u: schema.users })
    .from(schema.mcpTokens)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.mcpTokens.orgId))
    .innerJoin(schema.users, eq(schema.users.id, schema.mcpTokens.userId))
    .where(and(eq(schema.mcpTokens.accessHash, sha256(token)), gt(schema.mcpTokens.accessExpiresAt, new Date())))
    .limit(1);
  if (!row || row.u.disabled) return null;
  // the person must still be a member of that workspace
  const [m] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, row.o.id), eq(schema.memberships.userId, row.u.id)))
    .limit(1);
  if (!m) return null;
  db.update(schema.mcpTokens).set({ lastUsedAt: new Date() }).where(eq(schema.mcpTokens.id, row.t.id)).catch(() => {});
  return { org: row.o, user: row.u, tokenId: row.t.id };
}
