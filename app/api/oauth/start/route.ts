import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { getCtx, hasRole } from "@/lib/auth";
import { APPS } from "@/lib/engine/catalog";
import { PROVIDERS, clientId, providerConfigured, redirectUri } from "@/lib/oauth/providers";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me-dev-secret-change-me");
const b64url = (b: Buffer) => b.toString("base64url");

/** GET /api/oauth/start?app=google_oauth&name=My%20Google → redirects to the provider's consent screen. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (msg: string) => NextResponse.redirect(new URL(`/app/connections?error=${encodeURIComponent(msg)}`, req.url));
  const ctx = await getCtx();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  if (!hasRole(ctx.role, "BUILDER")) return back("You don't have permission to add connections");

  const app = url.searchParams.get("app") ?? "";
  const def = APPS[app];
  const providerId = def?.oauth;
  if (!providerId || !PROVIDERS[providerId]) return back("That app doesn't support one-click sign-in");
  if (!providerConfigured(providerId)) return back(`${PROVIDERS[providerId].name} sign-in isn't set up on this server yet`);
  const p = PROVIDERS[providerId];

  const state = b64url(randomBytes(18));
  const redirect = redirectUri(req);
  const verifier = p.pkce ? b64url(randomBytes(48)) : undefined;
  const name = (url.searchParams.get("name") ?? def.name).slice(0, 80);
  const cookie = await new SignJWT({ state, verifier, redirect, app, provider: p.id, orgId: ctx.org.id, userId: ctx.user.id, name })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(secret());

  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId(p),
    redirect_uri: redirect,
    scope: p.scopes.join(p.scopeSeparator ?? " "),
    state,
    ...(p.extraAuthParams ?? {}),
  });
  if (verifier) {
    q.set("code_challenge", b64url(createHash("sha256").update(verifier).digest()));
    q.set("code_challenge_method", "S256");
  }
  const res = NextResponse.redirect(`${p.authorizeUrl}?${q}`);
  res.cookies.set("ff_oauth", cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/oauth", maxAge: 900 });
  return res;
}
