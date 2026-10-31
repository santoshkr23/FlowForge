/** Workflow steps for the Social publisher: clean/rewrite a post, then save it as a draft or post it. */
import { db, schema } from "../../db";
import { siteUrl } from "../../oauth/providers";
import { rewritePost, type RewriteStyle } from "../../social/rewrite";
import { publishPost } from "../../social/publish";
import { downloadFile } from "../net";
import { StepError, type ModuleRunner } from "../types";

const s = (v: unknown) => (v == null ? "" : String(v)).trim();

export const publisher: Record<string, ModuleRunner> = {
  "social.rewrite": async ({ config }) => {
    const text = s(config.text);
    if (!text) throw new StepError("There's no post text to clean");
    const r = await rewritePost(text, {
      style: (s(config.style) || "clean") as RewriteStyle,
      author: s(config.author),
      url: s(config.url),
      credit: config.credit !== false && config.credit !== "false",
      maxTags: Number(config.maxTags ?? 5),
    });
    return { output: r };
  },

  "social.draft": async ({ config, orgId, log }) => {
    const text = s(config.text);
    const link = s(config.link) || null;
    if (!text && !link) throw new StepError("The post is empty");
    let mediaId: string | null = null;
    if (s(config.fileUrl)) {
      const f = await downloadFile(s(config.fileUrl), 20 * 1024 * 1024);
      const mime = f.contentType.split(";")[0].trim();
      if (!/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(mime)) throw new StepError(`Only pictures and PDFs can be attached (got ${mime})`);
      const [m] = await db
        .insert(schema.media)
        .values({ orgId, token: crypto.randomUUID().replace(/-/g, ""), name: f.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file", mime, size: f.data.length, data: f.data })
        .returning({ id: schema.media.id });
      mediaId = m.id;
    }
    const targets = s(config.connectionId) ? [s(config.connectionId)] : [];
    const postNow = config.mode === "post";
    if (postNow && !targets.length) throw new StepError("Pick the account to post to, or choose 'Save as draft'");
    const [p] = await db
      .insert(schema.posts)
      .values({ orgId, text, link, mediaId, mediaTitle: s(config.mediaTitle) || null, targets, baseUrl: siteUrl(), status: postNow ? "posting" : "draft", scheduledAt: postNow ? new Date() : null })
      .returning();
    if (!postNow) {
      log("Saved to Social → Drafts for review");
      return { output: { postId: p.id, status: "draft" } };
    }
    const done = await publishPost(p.id);
    const failed = (done.results ?? []).filter((r) => !r.ok);
    if (failed.length === (done.results ?? []).length) throw new StepError(failed.map((r) => r.error).join("; ") || "Posting failed");
    return { output: { postId: p.id, status: done.status, url: done.results?.find((r) => r.url)?.url, results: done.results } };
  },
};
