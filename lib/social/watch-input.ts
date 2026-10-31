import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { accountsFrom } from "./channels";
import { normTag } from "./rewrite";

export const WatchBody = z.object({
  name: z.string().trim().min(1, "Give it a name").max(80),
  profileUrl: z.string().trim().max(500).optional().or(z.literal("")),
  feedUrl: z.string().trim().max(1000).optional().or(z.literal("")),
  targets: z.array(z.string()).default([]),
  mode: z.enum(["post", "draft"]).default("post"),
  style: z.enum(["clean", "rewrite", "short", "hook"]).default("clean"),
  credit: z.boolean().default(true),
  signature: z.string().max(500).optional(),
  hashtags: z.array(z.string()).max(30).default([]),
  tagMode: z.enum(["mix", "mine", "suggested", "original"]).default("mix"),
  maxTags: z.number().int().min(0).max(30).default(5),
  intervalMin: z.number().int().min(30).max(1440).default(60),
  active: z.boolean().default(true),
});

export async function validTargets(orgId: string, targets: string[]) {
  const conns = await db.select({ id: schema.connections.id, app: schema.connections.app, name: schema.connections.name }).from(schema.connections).where(eq(schema.connections.orgId, orgId));
  const ok = new Set(accountsFrom(conns).map((a) => a.target));
  return targets.every((t) => ok.has(t));
}

export function clean(b: z.infer<typeof WatchBody>) {
  const profile = (b.profileUrl ?? "").trim();
  return {
    ...b,
    profileUrl: profile ? (/^https?:\/\//.test(profile) ? profile : `https://${profile}`) : null,
    feedUrl: (b.feedUrl ?? "").trim() || null,
    signature: (b.signature ?? "").trim() || null,
    hashtags: [...new Set(b.hashtags.map(normTag).filter(Boolean))],
  };
}

