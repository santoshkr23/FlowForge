import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { body, json, withAuth } from "@/lib/http";
import { siteUrl } from "@/lib/oauth/providers";
import { createPost } from "@/lib/social/create";

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
  options: z
    .object({
      youtube: z
        .object({
          title: z.string().max(100).optional(),
          privacy: z.enum(["public", "unlisted", "private"]).optional(),
          madeForKids: z.boolean().optional(),
          tags: z.array(z.string().max(100)).max(50).optional(),
          categoryId: z.string().max(4).optional(),
          thumbnailMediaId: z.string().optional(),
          notifySubscribers: z.boolean().optional(),
          shorts: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

/** Create a post. Without scheduledAt it is published right away. */
export const POST = withAuth("BUILDER", async (ctx, req) => {
  const b = await body(req, Body);
  const mediaIds = [...new Set([...(b.mediaIds ?? []), ...(b.mediaId ? [b.mediaId] : [])])];
  const post = await createPost(ctx.org.id, ctx.user.id, { ...b, mediaIds }, siteUrl(req));
  return json(post, 201);
});
