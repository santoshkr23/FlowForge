/** Social media: Instagram, Facebook Pages, X, LinkedIn, Pinterest, Bluesky, Mastodon, Tumblr, Reddit, Twitch, VK, Discourse, Manychat. */
import { apiCall, apiRaw, httpRequest } from "../net";
import { metaGraph } from "../../oauth/providers";
import { StepError, type ModuleRunner, type RunCtx } from "../types";

const s = (v: unknown) => (v == null ? "" : String(v)).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const graph = (path: string) => `https://graph.facebook.com/${metaGraph()}${path}`;

// ── Meta (Facebook + Instagram) ─────────────────────────────────────────────
type FbPage = { id: string; name?: string; access_token?: string; instagram_business_account?: { id: string } };

async function fbGet<T>(path: string, token: string, fields?: string): Promise<T> {
  const q = new URLSearchParams({ access_token: token, ...(fields ? { fields } : {}) });
  return apiCall<T>(`${graph(path)}${path.includes("?") ? "&" : "?"}${q}`);
}
async function fbPost<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  return apiCall<T>(graph(path), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, access_token: token }).toString() });
}

/** Resolve a Page and its Page token from a user token (OAuth) or accept a pasted Page token. */
async function fbPage(token: string, pageId?: string): Promise<{ id: string; token: string; igId?: string }> {
  try {
    const { data } = await fbGet<{ data: FbPage[] }>("/me/accounts", token, "id,name,access_token,instagram_business_account");
    if (data?.length) {
      const p = pageId ? data.find((x) => x.id === pageId) : data[0];
      if (!p) throw new StepError(`You don't manage a Page with ID ${pageId}, or it wasn't selected when you connected`);
      return { id: p.id, token: p.access_token ?? token, igId: p.instagram_business_account?.id };
    }
  } catch (e) {
    if (e instanceof StepError && e.message.includes("don't manage")) throw e;
    // a pasted Page token can't list /me/accounts — fall through
  }
  const me = await fbGet<{ id: string; instagram_business_account?: { id: string } }>(pageId ? `/${pageId}` : "/me", token, "id,instagram_business_account");
  return { id: me.id, token, igId: me.instagram_business_account?.id };
}

async function igWaitReady(containerId: string, token: string) {
  for (let i = 0; i < 60; i++) {
    const st = await fbGet<{ status_code?: string; status?: string }>(`/${containerId}`, token, "status_code,status");
    if (st.status_code === "FINISHED" || st.status_code === undefined) return;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new StepError(`Instagram couldn't process the media: ${st.status ?? st.status_code}`);
    await sleep(5000);
  }
  throw new StepError("Instagram took too long to process the video");
}

// ── LinkedIn ────────────────────────────────────────────────────────────────
/** LinkedIn "little text": these characters must be escaped or the post gets cut off. */
const liEscape = (t: string) => t.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);

// ── Bluesky ─────────────────────────────────────────────────────────────────
function bskyLinkFacets(text: string) {
  const facets: unknown[] = [];
  const re = /https?:\/\/[^\s)]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const byteStart = Buffer.byteLength(text.slice(0, m.index), "utf8");
    const byteEnd = byteStart + Buffer.byteLength(m[0], "utf8");
    facets.push({ index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  return facets;
}

// ── Twitch (also used by the "goes live" trigger) ────────────────────────────
export async function twitchStream(c: { clientId: string; clientSecret: string }, channel: string) {
  const tok = await apiCall<{ access_token: string }>(
    `https://id.twitch.tv/oauth2/token?${new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials" })}`,
    { method: "POST" },
  );
  const r = await apiCall<{ data: { id: string; title: string; game_name: string; viewer_count: number; started_at: string; user_login: string }[] }>(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel.toLowerCase())}`,
    { headers: { "client-id": c.clientId, authorization: `Bearer ${tok.access_token}` } },
  );
  const st = r.data[0];
  return st
    ? { live: true, id: st.id, title: st.title, game: st.game_name, viewers: st.viewer_count, startedAt: st.started_at, url: `https://twitch.tv/${st.user_login}` }
    : { live: false, url: `https://twitch.tv/${channel}` };
}

const siteBase = (u: string) => {
  const url = s(u).replace(/\/+$/, "");
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
};

export const social: Record<string, ModuleRunner> = {
  "instagram.post": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    let igId = s(config.igUserId);
    let tok = accessToken;
    if (!igId) {
      const page = await fbPage(accessToken);
      if (!page.igId) throw new StepError("No Instagram Business account is linked to your Facebook Page. Link it in Instagram → Settings → Account type, or enter the Instagram account ID.");
      igId = page.igId;
      tok = accessToken;
    }
    const reel = config.kind === "reel";
    const container = await fbPost<{ id: string }>(`/${igId}/media`, tok, {
      ...(reel ? { media_type: "REELS", video_url: s(config.mediaUrl) } : { image_url: s(config.mediaUrl) }),
      caption: s(config.caption),
    });
    await igWaitReady(container.id, tok);
    const pub = await fbPost<{ id: string }>(`/${igId}/media_publish`, tok, { creation_id: container.id });
    const info = await fbGet<{ permalink?: string }>(`/${pub.id}`, tok, "permalink").catch(() => ({ permalink: undefined }));
    return { output: { id: pub.id, permalink: info.permalink } };
  },

  "facebook.post": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const page = await fbPage(accessToken, s(config.pageId) || undefined);
    if (s(config.photoUrl)) {
      const r = await fbPost<{ id: string; post_id: string }>(`/${page.id}/photos`, page.token, { url: s(config.photoUrl), caption: s(config.message) });
      return { output: r };
    }
    const r = await fbPost<{ id: string }>(`/${page.id}/feed`, page.token, { message: s(config.message), ...(s(config.link) ? { link: s(config.link) } : {}) });
    return { output: { id: r.id, post_id: r.id, url: `https://facebook.com/${r.id}` } };
  },

  "x.post": async ({ config, token }) => {
    const { accessToken, data } = await token(config.connectionId);
    const r = await apiCall<{ data: { id: string; text: string } }>("https://api.x.com/2/tweets", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      json: { text: s(config.text), ...(s(config.replyTo) ? { reply: { in_reply_to_tweet_id: s(config.replyTo) } } : {}) },
    });
    return { output: { ...r.data, url: `https://x.com/${data.username ?? "i"}/status/${r.data.id}` } };
  },

  "linkedin.post": async ({ config, token }) => {
    const { accessToken, data } = await token(config.connectionId);
    let author = s(config.author) || (data.personUrn as string | undefined);
    if (!author) {
      const u = await apiCall<{ sub: string }>("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
      author = `urn:li:person:${u.sub}`;
    }
    const version = process.env.LINKEDIN_VERSION ?? "202608";
    try {
      const r = await apiRaw("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "linkedin-version": version, "x-restli-protocol-version": "2.0.0" },
        json: {
          author,
          commentary: liEscape(s(config.text)),
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
          ...(s(config.link) ? { content: { article: { source: s(config.link), title: s(config.link) } } } : {}),
        },
      });
      const id = r.headers.get("x-restli-id") ?? r.headers.get("x-linkedin-id") ?? "";
      return { output: { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined } };
    } catch (e) {
      if (/NONEXISTENT_VERSION|VERSION/i.test((e as Error).message))
        throw new StepError(`LinkedIn rejected API version ${version}. Set LINKEDIN_VERSION to a current YYYYMM version (see LinkedIn's API versioning page).`);
      throw e;
    }
  },

  "pinterest.pin": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const r = await apiCall<{ id: string }>("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      json: {
        board_id: s(config.boardId),
        title: s(config.title) || undefined,
        description: s(config.description) || undefined,
        link: s(config.link) || undefined,
        media_source: { source_type: "image_url", url: s(config.imageUrl) },
      },
    });
    return { output: { id: r.id, url: `https://www.pinterest.com/pin/${r.id}/` } };
  },

  "bluesky.post": async ({ config, connection }) => {
    const c = await connection<{ handle: string; appPassword: string }>(config.connectionId);
    const handle = s(c.handle).replace(/^@/, "");
    const session = await apiCall<{ accessJwt: string; did: string }>("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      json: { identifier: handle, password: c.appPassword },
    });
    const text = s(config.text);
    if ([...text].length > 300) throw new StepError("Bluesky posts are limited to 300 characters");
    const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), facets: bskyLinkFacets(text) };
    if (s(config.link)) record.embed = { $type: "app.bsky.embed.external", external: { uri: s(config.link), title: s(config.link), description: "" } };
    const r = await apiCall<{ uri: string; cid: string }>("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: { authorization: `Bearer ${session.accessJwt}` },
      json: { repo: session.did, collection: "app.bsky.feed.post", record },
    });
    return { output: { uri: r.uri, url: `https://bsky.app/profile/${handle}/post/${r.uri.split("/").pop()}` } };
  },

  "mastodon.post": async ({ config, connection }) => {
    const c = await connection<{ server: string; accessToken: string }>(config.connectionId);
    const r = await httpRequest(`${siteBase(c.server)}/api/v1/statuses`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.accessToken}` },
      body: { status: s(config.text), visibility: s(config.visibility) || "public" },
    });
    if (r.status >= 400) throw new StepError(`Mastodon: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const b = r.body as { id: string; url: string };
    return { output: { id: b.id, url: b.url } };
  },

  "tumblr.post": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const content: unknown[] = [{ type: "text", text: s(config.text) }];
    if (s(config.imageUrl)) content.unshift({ type: "image", media: [{ url: s(config.imageUrl) }] });
    const blog = s(config.blog).replace(/\.tumblr\.com$/, "");
    const r = await apiCall<{ response: { id: string } }>(`https://api.tumblr.com/v2/blog/${encodeURIComponent(blog)}.tumblr.com/posts`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      json: { content, tags: s(config.tags) },
    });
    return { output: { id: r.response.id } };
  },

  "reddit.post": async ({ config, connection }) => {
    const c = await connection<{ clientId: string; clientSecret: string; username: string; password: string }>(config.connectionId);
    const ua = `web:flowforge:1.0 (by /u/${c.username})`;
    const tok = await apiCall<{ access_token: string }>("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded", "user-agent": ua },
      body: new URLSearchParams({ grant_type: "password", username: c.username, password: c.password }).toString(),
    });
    const kind = config.kind === "link" ? "link" : "self";
    const r = await apiCall<{ json: { errors: string[][]; data?: { id: string; url: string } } }>("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/x-www-form-urlencoded", "user-agent": ua },
      body: new URLSearchParams({
        api_type: "json",
        sr: s(config.subreddit).replace(/^r\//, ""),
        kind,
        title: s(config.title),
        ...(kind === "link" ? { url: s(config.url) } : { text: s(config.text) }),
      }).toString(),
    });
    if (r.json.errors?.length) throw new StepError(`Reddit: ${r.json.errors.map((e) => e.slice(1).join(" ")).join("; ")}`);
    return { output: r.json.data };
  },

  "twitch.stream": async ({ config, connection }) => {
    const c = await connection<{ clientId: string; clientSecret: string }>(config.connectionId);
    return { output: await twitchStream(c, s(config.channel)) };
  },

  "vk.post": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const params = new URLSearchParams({ message: s(config.message), access_token: accessToken, v: "5.199" });
    if (s(config.ownerId)) params.set("owner_id", s(config.ownerId));
    const r = await apiCall<{ response?: { post_id: number }; error?: { error_msg: string } }>("https://api.vk.com/method/wall.post", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (r.error) throw new StepError(`VK: ${r.error.error_msg}`);
    return { output: r.response };
  },

  "discourse.topic": async ({ config, connection }) => {
    const c = await connection<{ siteUrl: string; username: string; apiKey: string }>(config.connectionId);
    const base = siteBase(c.siteUrl);
    const r = await httpRequest(`${base}/posts.json`, {
      method: "POST",
      headers: { "api-key": c.apiKey, "api-username": c.username },
      body: { title: s(config.title), raw: s(config.body), ...(s(config.category) ? { category: Number(config.category) } : {}) },
    });
    if (r.status >= 400) throw new StepError(`Discourse: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const b = r.body as { topic_id: number; topic_slug: string };
    return { output: { topic_id: b.topic_id, url: `${base}/t/${b.topic_slug}/${b.topic_id}` } };
  },

  "manychat.flow": async ({ config, token }) => manychat(config, token, "/fb/sending/sendFlow", { subscriber_id: s(config.subscriberId), flow_ns: s(config.flowNs) }),
  "manychat.tag": async ({ config, token }) => manychat(config, token, "/fb/subscriber/addTagByName", { subscriber_id: s(config.subscriberId), tag_name: s(config.tag) }),
};

async function manychat(config: Record<string, unknown>, token: RunCtx["token"], path: string, body: Record<string, string>) {
  const { accessToken } = await token(config.connectionId);
  const r = await apiCall<{ status: string; message?: string }>(`https://api.manychat.com${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    json: body,
  });
  if (r.status !== "success") throw new StepError(`Manychat: ${r.message ?? r.status}`);
  return { output: { ok: true } };
}
