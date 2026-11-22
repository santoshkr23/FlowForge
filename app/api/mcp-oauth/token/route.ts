import { exchangeCode, refreshTokens } from "@/lib/mcp-oauth";
import { jsonCors, preflight } from "@/lib/cors";

/** Token endpoint: authorization_code (with PKCE) and refresh_token. Accepts form-urlencoded (RFC 6749) or JSON. */
export async function POST(req: Request) {
  let p: Record<string, string> = {};
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) p = Object.fromEntries(Object.entries(await req.json()).map(([k, v]) => [k, String(v)]));
    else p = Object.fromEntries(new URLSearchParams(await req.text()));
  } catch {
    return jsonCors({ error: "invalid_request", error_description: "Couldn't read the request body" }, 400);
  }
  // a client may also send its id with HTTP Basic auth (no secret)
  const basic = req.headers.get("authorization");
  if (!p.client_id && basic?.startsWith("Basic ")) p.client_id = decodeURIComponent(Buffer.from(basic.slice(6), "base64").toString().split(":")[0] ?? "");

  let r;
  if (p.grant_type === "authorization_code") r = await exchangeCode({ code: p.code, clientId: p.client_id, redirectUri: p.redirect_uri, verifier: p.code_verifier });
  else if (p.grant_type === "refresh_token") r = await refreshTokens({ refreshToken: p.refresh_token, clientId: p.client_id || undefined });
  else return jsonCors({ error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token" }, 400);
  return "error" in r ? jsonCors(r, 400) : jsonCors(r, 200, { pragma: "no-cache" });
}
export const OPTIONS = preflight;
