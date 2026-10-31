/**
 * Social publisher: one post (text + optional picture/PDF + link) sent to many connected accounts,
 * now or at a scheduled time. Each target is a connection id, or "connId:instagram" for the
 * Instagram account linked to a Facebook connection.
 */
import { and, eq, inArray, lte } from "drizzle-orm";
import { db, schema } from "../db";
import type { Media, Post, PostResult } from "@/db/schema";
import { chargeCredits } from "../credits";
import { connectionHelpers, type Helpers } from "../engine/connections";
import { apiCall, apiRaw } from "../engine/net";
import { StepError } from "../engine/types";
import { accountsFrom, xLength, type Channel } from "./channels";
export { accountsFrom, CHANNELS, xLength, type Account, type Channel } from "./channels";
import { bskyLinkFacets, fbPage, fbPost, fbGet, igWaitReady, liText } from "../engine/modules/social";

export function mediaUrl(baseUrl: string | null | undefined, m: Pick<Media, "id" | "token" | "name">) {
  return `${(baseUrl ?? "").replace(/\/+$/, "")}/api/media/${m.id}/${m.token}/${encodeURIComponent(m.name)}`;
}

const join = (...parts: (string | null | undefined)[]) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n\n");
const isImage = (m?: Media | null) => !!m && m.mime.startsWith("image/");
const isPdf = (m?: Media | null) => !!m && m.mime === "application/pdf";

let pollMs = 3000;
/** tests only */
export function setPollDelay(ms: number) {
  pollMs = ms;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Out = { url?: string; note?: string };
type Job = {
  post: Post;
  /** first file (kept for the single-file paths) */
  media: Media | null;
  /** all files: several pictures, or one PDF */
  medias: Media[];
  fileUrl: string | null;
  fileUrls: string[];
  h: Helpers;
  connectionId: string;
};
const images = (j: Job) => j.medias.filter((m) => isImage(m));
const pdfOf = (j: Job) => j.medias.find((m) => isPdf(m)) ?? null;

// ── LinkedIn ────────────────────────────────────────────────────────────────
async function liUpload(kind: "images" | "documents", m: Media, author: string, accessToken: string, headers: Record<string, string>) {
  const init = await apiCall<{ value: { uploadUrl: string; document?: string; image?: string } }>(`https://api.linkedin.com/rest/${kind}?action=initializeUpload`, {
    method: "POST",
    headers,
    json: { initializeUploadRequest: { owner: author } },
  });
  const urn = init.value.document ?? init.value.image!;
  const put = await fetch(init.value.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/octet-stream" }, body: new Uint8Array(m.data), signal: AbortSignal.timeout(120_000) });
  if (!put.ok) throw new StepError(`LinkedIn didn't accept the file upload (${put.status})`);
  // documents need processing before they can be attached; images are usually ready at once
  for (let i = 0; ; i++) {
    const st = await apiCall<{ status?: string }>(`https://api.linkedin.com/rest/${kind}/${encodeURIComponent(urn)}`, { headers });
    if (!st.status || st.status === "AVAILABLE") break;
    if (st.status === "PROCESSING_FAILED") throw new StepError("LinkedIn couldn't process the file. PDFs must be under 100 MB and 300 pages.");
    if (i >= 40) throw new StepError("LinkedIn is still processing the file. Try again in a few minutes.");
    await sleep(pollMs);
  }
  return urn;
}

async function linkedin(j: Job): Promise<Out> {
  const { post, h, connectionId } = j;
  const { accessToken, data } = await h.token(connectionId);
  let author = data.personUrn as string | undefined;
  if (!author) {
    const u = await apiCall<{ sub: string }>("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
    author = `urn:li:person:${u.sub}`;
  }
  const headers = { authorization: `Bearer ${accessToken}`, "linkedin-version": process.env.LINKEDIN_VERSION ?? "202608", "x-restli-protocol-version": "2.0.0" };
  let content: Record<string, unknown> | undefined;
  let text = post.text;
  let note: string | undefined;
  const pdf = pdfOf(j);
  const pics = images(j);

  if (pdf) {
    const urn = await liUpload("documents", pdf, author, accessToken, headers);
    content = { media: { id: urn, title: (post.mediaTitle || pdf.name.replace(/\.pdf$/i, "")).slice(0, 200) } };
    if (pics.length) note = "LinkedIn allows one PDF or pictures in a post — the PDF was used.";
  } else if (pics.length > 1) {
    const list = pics.slice(0, 20);
    const ids: string[] = [];
    for (const m of list) ids.push(await liUpload("images", m, author, accessToken, headers));
    content = { multiImage: { images: ids.map((id) => ({ id, altText: "" })) } };
    if (pics.length > 20) note = `LinkedIn takes up to 20 pictures — the first 20 were posted.`;
  } else if (pics.length === 1) {
    const urn = await liUpload("images", pics[0], author, accessToken, headers);
    content = { media: { id: urn, ...(post.mediaTitle ? { altText: post.mediaTitle } : {}) } };
  }
  if (content) text = join(post.text, post.link);
  else if (post.link) content = { article: { source: post.link, title: post.mediaTitle || post.link } };
  if ([...text].length > 3000) throw new StepError(`The post is ${[...text].length} characters — LinkedIn allows 3,000. Shorten it (in a workflow, the post text should be just {{steps.clean.text}}).`);

  const r = await apiRaw("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers,
    json: {
      author,
      commentary: liText(text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      ...(content ? { content } : {}),
    },
  });
  const id = r.headers.get("x-restli-id") ?? "";
  return { url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined, note };
}

// ── Facebook Page / Instagram ───────────────────────────────────────────────
function needPublic(fileUrl: string | null) {
  if (!fileUrl || /\/\/(localhost|127\.0\.0\.1)/.test(fileUrl)) throw new StepError("Facebook and Instagram fetch the picture from your site, so it must run at a public address (set APP_URL).");
  return fileUrl;
}
const urlOf = (j: Job, m: Media) => j.fileUrls[j.medias.indexOf(m)];

async function facebook(j: Job): Promise<Out> {
  const { post, h, connectionId } = j;
  const { accessToken } = await h.token(connectionId);
  const page = await fbPage(accessToken);
  const pics = images(j);
  const pdf = pdfOf(j);
  if (pics.length > 1) {
    const ids: string[] = [];
    for (const m of pics.slice(0, 30)) ids.push((await fbPost<{ id: string }>(`/${page.id}/photos`, page.token, { url: needPublic(urlOf(j, m)), published: "false" })).id);
    const params: Record<string, string> = { message: join(post.text, post.link) };
    ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    const r = await fbPost<{ id: string }>(`/${page.id}/feed`, page.token, params);
    return { url: `https://facebook.com/${r.id}` };
  }
  if (pics.length === 1) {
    const r = await fbPost<{ id: string; post_id?: string }>(`/${page.id}/photos`, page.token, { url: needPublic(urlOf(j, pics[0])), caption: join(post.text, post.link) });
    return { url: `https://facebook.com/${r.post_id ?? r.id}` };
  }
  const message = pdf ? join(post.text, urlOf(j, pdf)) : post.text;
  const r = await fbPost<{ id: string }>(`/${page.id}/feed`, page.token, { message, ...(post.link ? { link: post.link } : {}) });
  return { url: `https://facebook.com/${r.id}`, note: pdf ? "Facebook Pages can't attach PDFs — a download link was added." : undefined };
}

async function instagram(j: Job): Promise<Out> {
  const { post, h, connectionId } = j;
  const pics = images(j);
  if (!pics.length) throw new StepError("Instagram needs a picture (JPEG). PDFs and text-only posts aren't supported.");
  const { accessToken } = await h.token(connectionId);
  const page = await fbPage(accessToken);
  if (!page.igId) throw new StepError("No Instagram Business account is linked to your Facebook Page.");
  const caption = join(post.text, post.link);
  let creation: string;
  if (pics.length > 1) {
    const children: string[] = [];
    for (const m of pics.slice(0, 10)) {
      const c = await fbPost<{ id: string }>(`/${page.igId}/media`, accessToken, { image_url: needPublic(urlOf(j, m)), is_carousel_item: "true" });
      await igWaitReady(c.id, accessToken);
      children.push(c.id);
    }
    creation = (await fbPost<{ id: string }>(`/${page.igId}/media`, accessToken, { media_type: "CAROUSEL", children: children.join(","), caption })).id;
  } else {
    creation = (await fbPost<{ id: string }>(`/${page.igId}/media`, accessToken, { image_url: needPublic(urlOf(j, pics[0])), caption })).id;
  }
  await igWaitReady(creation, accessToken);
  const pub = await fbPost<{ id: string }>(`/${page.igId}/media_publish`, accessToken, { creation_id: creation });
  const info = await fbGet<{ permalink?: string }>(`/${pub.id}`, accessToken, "permalink").catch(() => ({ permalink: undefined }));
  const notes = [post.link ? "Links aren't clickable in Instagram captions." : "", pics.length > 10 ? "Instagram carousels take up to 10 pictures." : ""].filter(Boolean).join(" ");
  return { url: info.permalink, note: notes || undefined };
}

// ── X ───────────────────────────────────────────────────────────────────────
async function x({ post, media, fileUrl, h, connectionId }: Job): Promise<Out> {
  const text = join(post.text, post.link, media ? fileUrl : null);
  if (xLength(text) > 280) throw new StepError(`Too long for X: ${xLength(text)}/280 characters (links count as 23).`);
  const { accessToken, data } = await h.token(connectionId);
  const r = await apiCall<{ data: { id: string } }>("https://api.x.com/2/tweets", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, json: { text } });
  return { url: `https://x.com/${data.username ?? "i"}/status/${r.data.id}`, note: media ? "The file was shared as a link on X." : undefined };
}

// ── Bluesky ─────────────────────────────────────────────────────────────────
async function bluesky(j: Job): Promise<Out> {
  const { post, media, fileUrl, h, connectionId } = j;
  const pics = images(j).filter((m) => m.size <= 976_000).slice(0, 4);
  const text = join(post.text, post.link, media && !pics.length ? fileUrl : null);
  if ([...text].length > 300) throw new StepError(`Too long for Bluesky: ${[...text].length}/300 characters.`);
  const c = await h.connection<{ handle: string; appPassword: string }>(connectionId);
  const handle = String(c.handle ?? "").trim().replace(/^@/, "");
  const session = await apiCall<{ accessJwt: string; did: string }>("https://bsky.social/xrpc/com.atproto.server.createSession", { method: "POST", json: { identifier: handle, password: c.appPassword } });
  const auth = { authorization: `Bearer ${session.accessJwt}` };
  const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), facets: bskyLinkFacets(text) };
  if (pics.length) {
    const imgs = [];
    for (const m of pics) {
      const up = await apiCall<{ blob: unknown }>("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", { method: "POST", headers: { ...auth, "content-type": m.mime }, body: new Uint8Array(m.data) });
      imgs.push({ alt: post.mediaTitle ?? "", image: up.blob });
    }
    record.embed = { $type: "app.bsky.embed.images", images: imgs };
  } else if (post.link) {
    record.embed = { $type: "app.bsky.embed.external", external: { uri: post.link, title: post.mediaTitle || post.link, description: "" } };
  }
  const r = await apiCall<{ uri: string }>("https://bsky.social/xrpc/com.atproto.repo.createRecord", { method: "POST", headers: auth, json: { repo: session.did, collection: "app.bsky.feed.post", record } });
  const skipped = images(j).length - pics.length;
  return {
    url: `https://bsky.app/profile/${handle}/post/${r.uri.split("/").pop()}`,
    note: media && !pics.length ? "Bluesky only takes pictures under 1 MB — the file was shared as a link." : skipped > 0 ? "Bluesky takes up to 4 pictures under 1 MB each; the rest were skipped." : undefined,
  };
}

// ── Mastodon ────────────────────────────────────────────────────────────────
async function mastodon(j: Job): Promise<Out> {
  const { post, h, connectionId } = j;
  const c = await h.connection<{ server: string; accessToken: string }>(connectionId);
  const base = (/^https?:\/\//.test(c.server) ? c.server : `https://${c.server}`).replace(/\/+$/, "");
  const auth = { authorization: `Bearer ${c.accessToken}` };
  const pdf = pdfOf(j);
  const params = new URLSearchParams({ status: join(post.text, post.link, pdf ? urlOf(j, pdf) : null), visibility: "public" });
  for (const m of images(j).slice(0, 4)) {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(m.data)], { type: m.mime }), m.name);
    if (post.mediaTitle) fd.append("description", post.mediaTitle);
    const up = await apiCall<{ id: string }>(`${base}/api/v2/media`, { method: "POST", headers: auth, body: fd });
    params.append("media_ids[]", up.id);
  }
  const r = await apiCall<{ url: string }>(`${base}/api/v1/statuses`, { method: "POST", headers: { ...auth, "content-type": "application/x-www-form-urlencoded" }, body: params.toString() });
  return { url: r.url };
}

// ── Discord / Slack (webhooks) ──────────────────────────────────────────────
async function discord({ post, medias, h, connectionId }: Job): Promise<Out> {
  const { webhookUrl } = await h.connection<{ webhookUrl: string }>(connectionId);
  const content = join(post.text, post.link).slice(0, 2000);
  const url = `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}wait=true`;
  if (medias.length) {
    const fd = new FormData();
    fd.append("payload_json", JSON.stringify({ content }));
    medias.slice(0, 10).forEach((m, i) => fd.append(`files[${i}]`, new Blob([new Uint8Array(m.data)], { type: m.mime }), m.name));
    await apiCall(url, { method: "POST", body: fd });
  } else await apiCall(url, { method: "POST", json: { content } });
  return {};
}

async function slack({ post, fileUrls, h, connectionId }: Job): Promise<Out> {
  const { webhookUrl } = await h.connection<{ webhookUrl: string }>(connectionId);
  const res = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: join(post.text, post.link, ...fileUrls) }) });
  if (!res.ok) throw new StepError(`Slack: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return {};
}

const PUBLISHERS: Record<Channel, (j: Job) => Promise<Out>> = { linkedin, facebook, instagram, x, bluesky, mastodon, discord, slack };

/** Publish one claimed post to all its targets and store per-account results. */
export async function publishPost(postId: string): Promise<Post> {
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
  if (!post) throw new Error("Post not found");
  const at = () => new Date().toISOString();
  const ids = post.mediaIds?.length ? post.mediaIds : post.mediaId ? [post.mediaId] : [];
  const found = ids.length ? await db.select().from(schema.media).where(inArray(schema.media.id, ids)) : [];
  const medias = ids.map((id) => found.find((m) => m.id === id)).filter((m): m is Media => !!m);
  const media = medias[0] ?? null;
  const conns = post.targets.length
    ? await db
        .select({ id: schema.connections.id, app: schema.connections.app, name: schema.connections.name })
        .from(schema.connections)
        .where(and(eq(schema.connections.orgId, post.orgId), inArray(schema.connections.id, post.targets.map((t) => t.split(":")[0]))))
    : [];
  const accounts = new Map(accountsFrom(conns).map((a) => [a.target, a]));

  let results: PostResult[];
  if (!(await chargeCredits(post.orgId, post.targets.length))) {
    results = post.targets.map((t) => ({ target: t, app: accounts.get(t)?.channel ?? "unknown", account: accounts.get(t)?.name, ok: false, error: "Not enough credits — upgrade your plan or buy more.", at: at() }));
  } else {
    const h = connectionHelpers(post.orgId);
    const fileUrls = medias.map((m) => mediaUrl(post.baseUrl, m));
    const fileUrl = fileUrls[0] ?? null;
    results = [];
    for (const t of post.targets) {
      const a = accounts.get(t);
      if (!a) {
        results.push({ target: t, app: "unknown", ok: false, error: "This account was disconnected.", at: at() });
        continue;
      }
      try {
        const out = await PUBLISHERS[a.channel]({ post, media, medias, fileUrl, fileUrls, h, connectionId: a.connectionId });
        results.push({ target: t, app: a.channel, account: a.name, ok: true, url: out.url, note: out.note, at: at() });
      } catch (e) {
        results.push({ target: t, app: a.channel, account: a.name, ok: false, error: (e as Error).message.slice(0, 500), at: at() });
      }
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  const status = okCount === results.length && okCount > 0 ? "posted" : okCount ? "partial" : "failed";
  const [saved] = await db.update(schema.posts).set({ status, results, postedAt: new Date() }).where(eq(schema.posts.id, post.id)).returning();
  return saved;
}

/** Claim a post (scheduled → posting) so two schedulers never publish it twice. */
export async function claimPost(id: string) {
  const r = await db
    .update(schema.posts)
    .set({ status: "posting" })
    .where(and(eq(schema.posts.id, id), eq(schema.posts.status, "scheduled")))
    .returning({ id: schema.posts.id });
  return r.length > 0;
}

/** Publish every scheduled post that is due. Called by the scheduler every 30s. */
export async function tickPosts(now = new Date()) {
  const due = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.status, "scheduled"), lte(schema.posts.scheduledAt, now)))
    .limit(50);
  let n = 0;
  for (const p of due) {
    if (!(await claimPost(p.id))) continue;
    await publishPost(p.id).catch((e) => console.error("post publish", p.id, e));
    n++;
  }
  return n;
}
