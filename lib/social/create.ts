/** Create (and maybe publish) a social post — shared by the Social page API and the MCP server. */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../http";
import { audit } from "../audit";
import { accountsFrom, CHANNELS, xLength } from "./channels";
import { claimPost, publishPost } from "./publish";

export type NewPost = {
  text: string;
  link?: string;
  mediaIds?: string[];
  mediaTitle?: string;
  targets: string[];
  draft?: boolean;
  fromDraft?: string;
  scheduledAt?: string;
};

export async function socialAccounts(orgId: string) {
  const conns = await db
    .select({ id: schema.connections.id, app: schema.connections.app, name: schema.connections.name })
    .from(schema.connections)
    .where(eq(schema.connections.orgId, orgId));
  return accountsFrom(conns);
}

export async function createPost(orgId: string, userId: string | null, b: NewPost, baseUrl: string) {
  const mediaIds = [...new Set(b.mediaIds ?? [])];
  if (!b.text.trim() && !mediaIds.length && !b.link) throw new HttpError(422, "Write something, attach a file or add a link");

  const accounts = new Map((await socialAccounts(orgId)).map((a) => [a.target, a]));
  const targets = [...new Set(b.targets)];
  if (!b.draft && !targets.length) throw new HttpError(422, "Pick at least one account");
  for (const t of targets) if (!accounts.has(t)) throw new HttpError(422, "One of the selected accounts isn't connected any more");

  if (mediaIds.length) {
    const ms = await db.select({ id: schema.media.id }).from(schema.media).where(and(inArray(schema.media.id, mediaIds), eq(schema.media.orgId, orgId)));
    if (ms.length !== mediaIds.length) throw new HttpError(422, "Attached file not found");
  }
  // catch the obvious problems before anything is posted
  for (const t of b.draft ? [] : targets) {
    const a = accounts.get(t)!;
    if (a.channel === "instagram" && !mediaIds.length) throw new HttpError(422, "Instagram needs a picture — attach one or untick Instagram");
    if (a.channel === "x" && xLength([b.text, b.link].filter(Boolean).join("\n\n")) > 280) throw new HttpError(422, "Too long for X (280 characters, links count as 23). Shorten it or untick X.");
    const lim = CHANNELS[a.channel].limit;
    if (a.channel !== "x" && lim && [...b.text].length > lim) throw new HttpError(422, `Too long for ${CHANNELS[a.channel].name} (${lim} characters)`);
  }

  const when = b.scheduledAt ? new Date(b.scheduledAt) : null;
  if (when && isNaN(when.getTime())) throw new HttpError(422, "scheduledAt isn't a valid date/time");
  const later = !!when && when.getTime() > Date.now() + 30_000;
  const [post] = await db
    .insert(schema.posts)
    .values({
      orgId,
      createdById: userId,
      text: b.text,
      link: b.link ?? null,
      mediaId: mediaIds[0] ?? null,
      mediaIds,
      mediaTitle: b.mediaTitle || null,
      targets,
      baseUrl,
      status: b.draft ? "draft" : "scheduled",
      scheduledAt: b.draft ? when : later ? when : new Date(),
    })
    .returning();
  await audit(orgId, userId, b.draft ? "post.drafted" : later ? "post.scheduled" : "post.published", post.id, { targets: targets.length });
  if (b.fromDraft && !b.draft)
    await db.delete(schema.posts).where(and(eq(schema.posts.id, b.fromDraft), eq(schema.posts.orgId, orgId), eq(schema.posts.status, "draft")));
  if (b.draft || later) return post;
  if (!(await claimPost(post.id))) return post;
  return publishPost(post.id);
}
