import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { body, err, json, withAuth } from "@/lib/http";
import { siteUrl } from "@/lib/oauth/providers";
import { accountsFrom, claimPost, publishPost, CHANNELS, xLength } from "@/lib/social/publish";
import { audit } from "@/lib/audit";

export const maxDuration = 300;

export const GET = withAuth("VIEWER", async (ctx) => {
  const rows = await db
    .select({
      id: schema.posts.id,
      text: schema.posts.text,
      link: schema.posts.link,
      mediaId: schema.posts.mediaId,
      mediaIds: schema.posts.mediaIds,
      mediaTitle: schema.posts.mediaTitle,
      targets: schema.posts.targets,
      status: schema.posts.status,
      scheduledAt: schema.posts.scheduledAt,
      postedAt: schema.posts.postedAt,
      results: schema.posts.results,
      createdAt: schema.posts.createdAt,
    })
    .from(schema.posts)
    .where(eq(schema.posts.orgId, ctx.org.id))
    .orderBy(desc(schema.posts.createdAt))
    .limit(100);
  return json(rows);
});

const Body = z.object({
  text: z.string().max(10000).default(""),
  link: z.string().trim().url().max(2000).optional().or(z.literal("").transform(() => undefined)),
  mediaId: z.string().optional(),
  mediaIds: z.array(z.string()).max(20).optional(),
  mediaTitle: z.string().trim().max(200).optional(),
  targets: z.array(z.string()).default([]),
  /** save for later review instead of posting */
  draft: z.boolean().default(false),
  /** the draft this post was made from — removed once posted/scheduled */
  fromDraft: z.string().optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});

/** Create a post. Without scheduledAt it is published right away. */
export const POST = withAuth("BUILDER", async (ctx, req) => {
  const b = await body(req, Body);
  const mediaIds = [...new Set([...(b.mediaIds ?? []), ...(b.mediaId ? [b.mediaId] : [])])];
  if (!b.text.trim() && !mediaIds.length && !b.link) return err("Write something, attach a file or add a link", 422);

  const conns = await db
    .select({ id: schema.connections.id, app: schema.connections.app, name: schema.connections.name })
    .from(schema.connections)
    .where(eq(schema.connections.orgId, ctx.org.id));
  const accounts = new Map(accountsFrom(conns).map((a) => [a.target, a]));
  const targets = [...new Set(b.targets)];
  if (!b.draft && !targets.length) return err("Pick at least one account", 422);
  for (const t of targets) if (!accounts.has(t)) return err("One of the selected accounts isn't connected any more", 422);

  if (mediaIds.length) {
    const ms = await db.select({ id: schema.media.id }).from(schema.media).where(and(inArray(schema.media.id, mediaIds), eq(schema.media.orgId, ctx.org.id)));
    if (ms.length !== mediaIds.length) return err("Attached file not found", 422);
  }
  // catch the obvious problems before anything is posted
  for (const t of b.draft ? [] : targets) {
    const a = accounts.get(t)!;
    if (a.channel === "instagram" && !mediaIds.length) return err("Instagram needs a picture — attach one or untick Instagram", 422);
    if (a.channel === "x" && xLength([b.text, b.link].filter(Boolean).join("\n\n")) > 280) return err("Too long for X (280 characters, links count as 23). Shorten it or untick X.", 422);
    const lim = CHANNELS[a.channel].limit;
    if (a.channel !== "x" && lim && [...b.text].length > lim) return err(`Too long for ${CHANNELS[a.channel].name} (${lim} characters)`, 422);
  }

  const when = b.scheduledAt ? new Date(b.scheduledAt) : null;
  const later = when && when.getTime() > Date.now() + 30_000;
  const [post] = await db
    .insert(schema.posts)
    .values({
      orgId: ctx.org.id,
      createdById: ctx.user.id,
      text: b.text,
      link: b.link ?? null,
      mediaId: mediaIds[0] ?? null,
      mediaIds,
      mediaTitle: b.mediaTitle || null,
      targets,
      baseUrl: siteUrl(req),
      status: b.draft ? "draft" : "scheduled",
      scheduledAt: b.draft ? when : later ? when : new Date(),
    })
    .returning();
  await audit(ctx.org.id, ctx.user.id, b.draft ? "post.drafted" : later ? "post.scheduled" : "post.published", post.id, { targets: targets.length });
  if (b.fromDraft && !b.draft)
    await db.delete(schema.posts).where(and(eq(schema.posts.id, b.fromDraft), eq(schema.posts.orgId, ctx.org.id), eq(schema.posts.status, "draft")));
  if (b.draft || later) return json(post, 201);
  if (!(await claimPost(post.id))) return json(post, 201);
  return json(await publishPost(post.id), 201);
});
