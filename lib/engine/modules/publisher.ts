/** Workflow steps for the Social publisher: clean/rewrite a post, then save it as a draft or post it. */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db";
import { siteUrl } from "../../oauth/providers";
import { rewritePost, type RewriteStyle, type TagMode } from "../../social/rewrite";
import { publishPost } from "../../social/publish";
import { downloadFile } from "../net";
import { fetchPost, saveImportedFiles } from "../../social/importer";
import { linkedinComment } from "../../social/linkedin";
import { connectionHelpers } from "../connections";
import { StepError, type ModuleRunner } from "../types";

const s = (v: unknown) => (v == null ? "" : String(v)).trim();

export const publisher: Record<string, ModuleRunner> = {
  "linkedin.comment": async ({ config, orgId }) => {
    return { output: await linkedinComment(connectionHelpers(orgId), s(config.connectionId), s(config.postUrl), s(config.text)) };
  },

  "social.import": async ({ config, orgId, log }) => {
    const url = s(config.url);
    if (!url) throw new StepError("No post link was given");
    const p = await fetchPost(url);
    let mediaIds: string[] = [];
    if (config.withFile !== false && config.withFile !== "false") {
      try {
        mediaIds = (await saveImportedFiles(orgId, p)).files.map((f) => f.id);
      } catch (e) {
        log(`Files not downloaded: ${(e as Error).message}`);
      }
    }
    return { output: { text: p.text, author: p.author ?? "", authorUrl: p.authorUrl ?? "", url: p.url, mediaId: mediaIds[0] ?? null, mediaIds, fileTitle: p.document?.title ?? "", hasDocument: !!p.document, images: p.images } };
  },

  "social.rewrite": async ({ config }) => {
    // drop file ids / picture addresses that got mapped into the text by mistake
    const text = s(config.text)
      .replace(/\[?"?https:\/\/media\.licdn\.com\/[^\s",\]]+"?,?\]?/g, "")
      .replace(/(?=[a-z0-9]{0,19}\d)[a-z0-9]{20}(?=[,\s\]"]|$),?/g, "")
      .replace(/\[\s*\]/g, "")
      .trim();
    if (!text) throw new StepError("There's no post text to clean");
    const r = await rewritePost(text, {
      style: (s(config.style) || "clean") as RewriteStyle,
      author: s(config.author),
      url: s(config.url),
      credit: config.credit !== false && config.credit !== "false",
      maxTags: Number(config.maxTags ?? 5),
      signature: s(config.signature) || undefined,
      myTags: s(config.myTags) ? s(config.myTags).split(/[\s,]+/).filter(Boolean) : undefined,
      tagMode: (s(config.tagMode) || undefined) as TagMode | undefined,
    });
    return { output: r };
  },

  "social.draft": async ({ config, orgId, log }) => {
    const text = s(config.text);
    const link = s(config.link) || null;
    if (!text && !link) throw new StepError("The post is empty");
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : s(v) ? s(v).split(",") : []).map((x) => x.trim()).filter(Boolean);
    // accept file ids wherever they were mapped (mediaIds, mediaId or even the URL field)
    const isId = (x: string) => /^[a-z0-9]{16,32}$/.test(x);
    const fileField = list(config.fileUrl);
    let many = [...list(config.mediaIds), ...list(config.mediaId), ...fileField.filter(isId)].filter(isId);
    many = [...new Set(many)];
    if (many.length) {
      const own = await db.select({ id: schema.media.id }).from(schema.media).where(and(inArray(schema.media.id, many), eq(schema.media.orgId, orgId)));
      many = many.filter((id) => own.some((o) => o.id === id));
    }
    const fileUrl = fileField.find((x) => /^https?:\/\//i.test(x)) ?? "";
    let mediaId: string | null = many[0] ?? null;
    if (!mediaId && fileUrl) {
      const f = await downloadFile(fileUrl, 20 * 1024 * 1024);
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
      .values({ orgId, text, link, mediaId, mediaIds: many.length ? many : mediaId ? [mediaId] : [], mediaTitle: s(config.mediaTitle) || null, targets, baseUrl: siteUrl(), status: postNow ? "posting" : "draft", scheduledAt: postNow ? new Date() : null })
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
