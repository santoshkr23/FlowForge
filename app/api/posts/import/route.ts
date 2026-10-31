import { z } from "zod";
import { body, json, withAuth } from "@/lib/http";
import { fetchPost, saveImportedFiles } from "@/lib/social/importer";
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
      signature: z.string().max(500).optional(),
      hashtags: z.array(z.string()).max(30).optional(),
      tagMode: z.enum(["mix", "mine", "suggested", "original"]).optional(),
    }),
  );
  try {
    const p = await fetchPost(b.url);
    const notes: string[] = [];
    let files: Awaited<ReturnType<typeof saveImportedFiles>>["files"] = [];
    try {
      const s = await saveImportedFiles(ctx.org.id, p);
      files = s.files;
      if (s.failed) notes.push(`${s.failed} file${s.failed > 1 ? "s" : ""} couldn't be downloaded.`);
    } catch (e) {
      notes.push(`The file couldn't be downloaded (${(e as Error).message}). Download it from the post and attach it yourself.`);
    }
    if (p.images.length > 20) notes.push(`The post has ${p.images.length} pictures; LinkedIn takes 20, so the first 20 were attached.`);
    const r = await rewritePost(p.text, { style: b.style, author: p.author, url: p.url, credit: b.credit, signature: b.signature, myTags: b.hashtags, tagMode: b.tagMode });
    return json({
      post: p,
      text: r.text,
      hashtags: r.hashtags,
      source: r.source,
      media: files.map((m) => ({ ...m, url: mediaUrl(siteUrl(req), m) })),
      title: p.document?.title ?? "",
      notes,
    });
  } catch (e) {
    if (e instanceof StepError) return err(e.message, 422);
    throw e;
  }
});
