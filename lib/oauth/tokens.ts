import { metaGraph, PROVIDERS, clientId, clientSecret, redirectUri, type Provider } from "./providers";

export type OAuthSecret = {
  oauth: true;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // ms epoch
  scope?: string;
  account?: string;
  extra?: Record<string, unknown>;
};

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; api_domain?: string; error?: string; error_description?: string };

async function tokenRequest(p: Provider, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ ...params, client_id: clientId(p) });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (p.basicAuth) headers.authorization = "Basic " + Buffer.from(`${clientId(p)}:${clientSecret(p)}`).toString("base64");
  else body.set("client_secret", clientSecret(p));
  const r = await fetch(p.tokenUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(20_000) });
  const data = (await r.json().catch(() => ({}))) as TokenResponse;
  if (!r.ok || !data.access_token) throw new Error(`${p.name} sign-in failed: ${data.error_description ?? data.error ?? r.status}`);
  return data;
}

function toSecret(p: Provider, t: TokenResponse, prev?: OAuthSecret): OAuthSecret {
  return {
    oauth: true,
    provider: p.id,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? prev?.refreshToken,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : prev?.expiresAt,
    scope: t.scope ?? prev?.scope,
    account: prev?.account,
    extra: { ...(prev?.extra ?? {}), ...(t.api_domain ? { apiDomain: t.api_domain } : {}) },
  };
}

export async function exchangeCode(providerId: string, code: string, verifier?: string): Promise<OAuthSecret> {
  const p = PROVIDERS[providerId];
  const t = await tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(), ...(verifier ? { code_verifier: verifier } : {}) });
  // Facebook gives short-lived (1–2 h) user tokens; swap for a 60-day one.
  if (p.id === "facebook") {
    const q = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: clientId(p), client_secret: clientSecret(p), fb_exchange_token: t.access_token });
    const r = await fetch(`https://graph.facebook.com/${metaGraph()}/oauth/access_token?${q}`);
    const long = (await r.json()) as TokenResponse;
    if (long.access_token) Object.assign(t, long);
  }
  const secret = toSecret(p, t);
  if (p.identify) {
    try {
      const who = await p.identify(secret.accessToken);
      secret.account = who.account;
      secret.extra = { ...secret.extra, ...(who.extra ?? {}) };
    } catch {
      /* label is optional */
    }
  }
  return secret;
}

/** Refresh when within 2 minutes of expiry. Returns null if nothing changed. */
export async function refreshIfNeeded(s: OAuthSecret): Promise<OAuthSecret | null> {
  if (!s.expiresAt || s.expiresAt - Date.now() > 120_000) return null;
  const p = PROVIDERS[s.provider];
  if (!s.refreshToken || !p) throw new Error(`Your ${p?.name ?? s.provider} connection has expired. Reconnect it on the Connections page.`);
  const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: s.refreshToken });
  return toSecret(p, t, s);
}
