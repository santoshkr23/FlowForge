/**
 * One-click "Connect with …" providers. Each needs a developer app registered by YOU (the platform owner):
 *   <ID>_CLIENT_ID / <ID>_CLIENT_SECRET in the environment, and the redirect URL
 *   {APP_URL}/api/oauth/callback  registered with the provider. See README → "One-click app sign-in".
 */
export type Provider = {
  id: string;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator?: string;
  /** send client id/secret as HTTP Basic auth on the token endpoint (otherwise in the body) */
  basicAuth?: boolean;
  pkce?: boolean;
  extraAuthParams?: Record<string, string>;
  /** label for the connected account + any data later API calls need */
  identify?: (accessToken: string) => Promise<{ account?: string; extra?: Record<string, unknown> }>;
};

const META = () => process.env.META_GRAPH_VERSION ?? "v23.0";
const ZOHO = () => (process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.in").replace(/\/$/, "");

async function getJson(url: string, token: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  return r.ok ? r.json() : {};
}

export const PROVIDERS: Record<string, Provider> = {
  google: {
    id: "google",
    name: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    pkce: true,
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    identify: async (t) => ({ account: (await getJson("https://openidconnect.googleapis.com/v1/userinfo", t)).email }),
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "User.Read", "Mail.Send", "ChannelMessage.Send", "Team.ReadBasic.All", "Channel.ReadBasic.All"],
    pkce: true,
    identify: async (t) => {
      const me = await getJson("https://graph.microsoft.com/v1.0/me", t);
      return { account: me.mail ?? me.userPrincipalName };
    },
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    authorizeUrl: `https://www.facebook.com/${META()}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${META()}/oauth/access_token`,
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"],
    scopeSeparator: ",",
    identify: async (t) => ({ account: (await getJson(`https://graph.facebook.com/${META()}/me?fields=name`, t)).name }),
  },
  twitter: {
    id: "twitter",
    name: "X",
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    basicAuth: true,
    pkce: true,
    identify: async (t) => {
      const me = await getJson("https://api.x.com/2/users/me", t);
      return { account: me.data?.username ? `@${me.data.username}` : undefined, extra: { username: me.data?.username } };
    },
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "email", "w_member_social"],
    identify: async (t) => {
      const u = await getJson("https://api.linkedin.com/v2/userinfo", t);
      return { account: u.name ?? u.email, extra: { personUrn: u.sub ? `urn:li:person:${u.sub}` : undefined } };
    },
  },
  pinterest: {
    id: "pinterest",
    name: "Pinterest",
    authorizeUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    scopes: ["boards:read", "pins:read", "pins:write", "user_accounts:read"],
    scopeSeparator: ",",
    basicAuth: true,
    identify: async (t) => ({ account: (await getJson("https://api.pinterest.com/v5/user_account", t)).username }),
  },
  zoho: {
    id: "zoho",
    name: "Zoho",
    authorizeUrl: `${ZOHO()}/oauth/v2/auth`,
    tokenUrl: `${ZOHO()}/oauth/v2/token`,
    scopes: ["ZohoCRM.modules.ALL", "ZohoCRM.settings.READ"],
    scopeSeparator: ",",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  dropbox: {
    id: "dropbox",
    name: "Dropbox",
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scopes: ["files.content.write", "account_info.read"],
    pkce: true,
    extraAuthParams: { token_access_type: "offline" },
    identify: async (t) => {
      const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { authorization: `Bearer ${t}` } });
      return { account: r.ok ? (await r.json()).email : undefined };
    },
  },
  tumblr: {
    id: "tumblr",
    name: "Tumblr",
    authorizeUrl: "https://www.tumblr.com/oauth2/authorize",
    tokenUrl: "https://api.tumblr.com/v2/oauth2/token",
    scopes: ["basic", "write", "offline_access"],
    identify: async (t) => ({ account: (await getJson("https://api.tumblr.com/v2/user/info", t)).response?.user?.name }),
  },
};

export const clientId = (p: Provider) => process.env[`${p.id.toUpperCase()}_CLIENT_ID`] ?? "";
export const clientSecret = (p: Provider) => process.env[`${p.id.toUpperCase()}_CLIENT_SECRET`] ?? "";
export const providerConfigured = (id: string) => !!PROVIDERS[id] && !!clientId(PROVIDERS[id]) && !!clientSecret(PROVIDERS[id]);
export const redirectUri = () => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/oauth/callback`;
export const metaGraph = META;
