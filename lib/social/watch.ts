/**
 * Profile watches: check a person's public LinkedIn profile (or a feed) on a timer; for each new post,
 * fetch its text, pictures and PDF, clean it, add your hashtags/sign-off, and post it to your accounts
 * (or save it as a draft).
 */
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "../db";
import type { Watch } from "@/db/schema";
import { readFeed } from "../engine/rss";
import { assertPublicUrl } from "../engine/net";
import { StepError } from "../engine/types";
import { siteUrl } from "../oauth/providers";
import { fetchPost, saveImportedFiles, type ImportedPost } from "./importer";
import { rewritePost, type RewriteStyle, type TagMode } from "./rewrite";
import { publishPost } from "./publish";

type Item = { id: string; link: string; title?: string; summary?: string; author?: string };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_PER_CHECK = 3;

/** Post links on a public LinkedIn profile / activity page, newest first as they appear. */
export function postsOnProfile(html: string): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  const re = /https?:(?:\\?\/){2}(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com(?:\\?\/)(?:posts(?:\\?\/)[^"'\s<>?\\]+?activity-(\d{10,})[^"'\s<>?\\]*|feed(?:\\?\/)update(?:\\?\/)urn(?::|%3A)li(?::|%3A)(?:activity|share|ugcPost)(?::|%3A)(\d{10,}))/gi;
  for (const m of html.matchAll(re)) {
    const id = m[1] ?? m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, link: m[0].replace(/\\\//g, "/") });
  }
  return out;
}

async function profileItems(url: string): Promise<Item[]> {
  await assertPublicUrl(url);
  const activity = /\/recent-activity\//.test(url) ? url : url.replace(/\/+$/, "") + "/recent-activity/all/";
  for (const u of [url, activity]) {
    const res = await fetch(u, { redirect: "follow", headers: { "user-agent": UA, accept: "text/html", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(20_000) });
    const html = (await res.text()).slice(0, 4_000_000);
    if (res.status === 999 || /\/(authwall|login|signup)/.test(res.url) || /<title>[^<]*(Sign Up|Log In|Sign in)[^<]*<\/title>/i.test(html)) continue;
    const items = postsOnProfile(html);
    if (items.length) return items;
  }
  throw new StepError(
    "LinkedIn didn't show this profile's posts to FlowForge (it asks servers to sign in). Add a feed link for this person instead — e.g. their newsletter/blog RSS, or an RSS feed of their LinkedIn posts from a feed service.",
  );
}

async function feedItems(url: string): Promise<Item[]> {
  const items = await readFeed(url);
  // feeds built from a single LinkedIn post list its hashtag / sign-up links as "items" — those aren't posts
  const junk = /linkedin\.com\/(signup|login|authwall|feed\/hashtag|uas\/|legal|help)/i;
  const posts = items.filter((i) => i.link && !junk.test(decodeURIComponent(i.link)));
  if (items.length && !posts.length)
    throw new StepError(
      "This feed doesn't contain posts — it looks like it was made from a single post (its items are hashtag/sign-up links). A feed must be made from the person's profile, page or newsletter.",
    );
  return posts.map((i) => ({ id: i.id || i.link, link: i.link, title: i.title, summary: i.summary, author: i.author }));
}

export async function listItems(w: Pick<Watch, "feedUrl" | "profileUrl">): Promise<Item[]> {
  if (w.feedUrl) return feedItems(w.feedUrl);
  if (w.profileUrl) return profileItems(w.profileUrl);
  throw new StepError("Add a LinkedIn profile link or a feed link");
}

/** Turn one new item into a post on your accounts (or a draft). */
async function handleItem(w: Watch, item: Item) {
  let p: ImportedPost;
  try {
    p = await fetchPost(item.link);
  } catch (e) {
    // the feed itself may carry enough to post
    if (!item.title && !item.summary) throw e;
    p = { url: item.link, site: "web", author: item.author || w.name, text: [item.title, item.summary].filter(Boolean).join("\n\n"), images: [] };
  }
  const { files } = await saveImportedFiles(w.orgId, p).catch(() => ({ files: [] as { id: string }[] }));
  const r = await rewritePost(p.text, {
    style: w.style as RewriteStyle,
    author: p.author || w.name,
    url: p.url,
    credit: w.credit,
    signature: w.signature ?? undefined,
    myTags: w.hashtags,
    tagMode: w.tagMode as TagMode,
    maxTags: w.maxTags,
  });
  const auto = w.mode === "post" && w.targets.length > 0;
  const [post] = await db
    .insert(schema.posts)
    .values({
      orgId: w.orgId,
      text: r.text,
      mediaId: files[0]?.id ?? null,
      mediaIds: files.map((f) => f.id),
      mediaTitle: p.document?.title ?? null,
      targets: w.targets,
      baseUrl: siteUrl(),
      watchId: w.id,
      status: auto ? "posting" : "draft",
      scheduledAt: auto ? new Date() : null,
    })
    .returning();
  if (auto) await publishPost(post.id);
  return post.id;
}

/**
 * Check one watch. The first check only remembers what's already there (so you don't repost someone's
 * whole history); after that, up to 3 new posts per check are handled, oldest first.
 */
export async function checkWatch(w: Watch): Promise<{ newPosts: number; error?: string }> {
  const now = new Date();
  const next = new Date(now.getTime() + Math.max(30, w.intervalMin) * 60_000);
  let items: Item[];
  try {
    items = await listItems(w);
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    await db.update(schema.watches).set({ lastCheckedAt: now, nextCheckAt: next, lastError: error }).where(eq(schema.watches.id, w.id));
    return { newPosts: 0, error };
  }
  const seen = new Set(w.seen);
  if (!w.seeded) {
    await db
      .update(schema.watches)
      .set({ seen: items.map((i) => i.id).slice(0, 300), seeded: true, lastCheckedAt: now, nextCheckAt: next, lastError: null })
      .where(eq(schema.watches.id, w.id));
    return { newPosts: 0 };
  }
  const fresh = items.filter((i) => !seen.has(i.id)).slice(0, MAX_PER_CHECK).reverse();
  let made = 0;
  let error: string | undefined;
  for (const it of fresh) {
    try {
      await handleItem(w, it);
      made++;
    } catch (e) {
      error = `${it.link}: ${(e as Error).message}`.slice(0, 500);
    }
    seen.add(it.id); // never retry the same post forever
  }
  await db
    .update(schema.watches)
    .set({ seen: [...items.map((i) => i.id), ...w.seen].filter((v, i, a) => a.indexOf(v) === i).slice(0, 300), lastCheckedAt: now, nextCheckAt: next, lastError: error ?? null, postsMade: w.postsMade + made })
    .where(eq(schema.watches.id, w.id));
  return { newPosts: made, error };
}

/** Run every watch that is due. Called by the scheduler. */
export async function tickWatches(now = new Date()) {
  const due = await db
    .select()
    .from(schema.watches)
    .where(and(eq(schema.watches.active, true), or(isNull(schema.watches.nextCheckAt), lte(schema.watches.nextCheckAt, now))))
    .limit(20);
  let n = 0;
  for (const w of due) {
    // claim: push nextCheckAt forward first so two schedulers never run the same watch
    const claim = new Date(now.getTime() + 10 * 60_000);
    const ok = await db
      .update(schema.watches)
      .set({ nextCheckAt: claim })
      .where(and(eq(schema.watches.id, w.id), w.nextCheckAt ? eq(schema.watches.nextCheckAt, w.nextCheckAt) : isNull(schema.watches.nextCheckAt)))
      .returning({ id: schema.watches.id });
    if (!ok.length) continue;
    n += (await checkWatch(w).catch((e) => (console.error("watch", w.id, e), { newPosts: 0 }))).newPosts;
  }
  return n;
}
