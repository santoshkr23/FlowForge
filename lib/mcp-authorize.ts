/** Validates an /oauth/authorize request. Shared by the consent page and its form handler. */
import { resolveClient, redirectAllowed, SCOPES, type Client } from "./mcp-oauth";

export type AuthzParams = { client_id: string; redirect_uri: string; response_type: string; code_challenge: string; code_challenge_method: string; state?: string; scope?: string; resource?: string };

export type Checked =
  | { ok: true; client: Client; p: AuthzParams; scope: string }
  /** an error we can't send back to the client (unknown client / bad redirect) — show it on the page */
  | { ok: false; show: string }
  /** an error to send back to the client's redirect URI */
  | { ok: false; redirect: string };

export function pick(src: URLSearchParams | FormData): AuthzParams {
  const g = (k: string) => {
    const v = src.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    client_id: g("client_id"),
    redirect_uri: g("redirect_uri"),
    response_type: g("response_type"),
    code_challenge: g("code_challenge"),
    code_challenge_method: g("code_challenge_method"),
    state: g("state") || undefined,
    scope: g("scope") || undefined,
    resource: g("resource") || undefined,
  };
}

export function errorRedirect(redirectUri: string, error: string, description: string, state?: string) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

export async function checkAuthorize(p: AuthzParams): Promise<Checked> {
  const client = await resolveClient(p.client_id);
  if (!client) return { ok: false, show: "This app isn't registered with FlowForge. Remove the connector in your AI app and add it again." };
  if (!p.redirect_uri || !redirectAllowed(client.redirectUris, p.redirect_uri)) return { ok: false, show: "This sign-in link has a return address the app didn't register, so it was stopped for your safety." };
  if (p.response_type !== "code") return { ok: false, redirect: errorRedirect(p.redirect_uri, "unsupported_response_type", "Only response_type=code is supported", p.state) };
  if (!p.code_challenge || p.code_challenge_method !== "S256") return { ok: false, redirect: errorRedirect(p.redirect_uri, "invalid_request", "PKCE with code_challenge_method=S256 is required", p.state) };
  // we have one scope; accept what's asked (offline_access etc.) and grant "mcp"
  return { ok: true, client, p, scope: SCOPES.join(" ") };
}
