import { z } from "zod";
import { body, json, withAuth } from "@/lib/http";
import { fetchPost, saveImportedFile } from "@/lib/social/importer";
import { rewritePost } from "@/lib/social/rewrite";
import { mediaUrl } from "@/lib/social/publish";
import { siteUrl } from "@/lib/oauth/providers";
import { StepError } from "@/lib/engine/types";
import { err } from "@/lib/http";

export const maxDuration = 120;

/** Read a public post from its link, download its PDF/picture, and return a cleaned version. */
export const POST = withAuth("BUILDER", async (ctx, req) => {
  const b = await body(
    req,
    z.object({
      url: z.string().trim().min(4, "Paste the post link"),
      style: z.enum(["clean", "rewrite", "short", "hook"]).default("clean"),
      credit: z.boolean().default(true),
    }),
  );
  try {
    const p = await fetchPost(b.url);
    const notes: string[] = [];
    let media = null;
    try {
      media = await saveImportedFile(ctx.org.id, p);
    } catch (e) {
      notes.push(`The file couldn't be downloaded (${(e as Error).message}). Download it from the post and attach it yourself.`);
    }
    if (!p.document && p.images.length > 1) notes.push(`The post has ${p.images.length} pictures; the first one was attached.`);
    const r = await rewritePost(p.text, { style: b.style, author: p.author, url: p.url, credit: b.credit });
    return json({
      post: p,
      text: r.text,
      hashtags: r.hashtags,
      source: r.source,
      media: media ? { ...media, url: mediaUrl(siteUrl(req), media) } : null,
      title: p.document?.title ?? "",
      notes,
    });
  } catch (e) {
    if (e instanceof StepError) return err(e.message, 422);
    throw e;
  }
});
