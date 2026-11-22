/** Tools the FlowForge MCP server offers to Claude and other assistants. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { HttpError } from "./http";
import { siteUrl } from "./oauth/providers";
import { apiGetExecution, apiListWorkflows, apiRunWorkflow } from "./public-api";
import { createPost, socialAccounts } from "./social/create";
import { fetchPost, saveImportedFiles } from "./social/importer";
import { rewritePost, type RewriteStyle, type TagMode } from "./social/rewrite";
import { suggestHashtags } from "./social/hashtags";
import { downloadFile } from "./engine/net";
import { randomToken } from "./crypto";
import type { Org } from "@/db/schema";

export type McpPrincipal = { org: Org; userId: string | null; admin: boolean; via: "oauth" | "apikey" };

const str = (v: unknown) => (v == null ? "" : String(v)).trim();
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? str(v).split(",").map((x) => x.trim()).filter(Boolean) : []);

export const TOOLS = [
  {
    name: "list_workflows",
    title: "List workflows",
    description: "List the automation workflows in this FlowForge workspace, with ids, names, trigger types and whether they are switched on.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "run_workflow",
    title: "Run a workflow",
    description: "Run a FlowForge workflow by id and return its output. `input` becomes the workflow's trigger data (for webhook workflows it is the request body). Uses credits and may send messages or posts.",
    inputSchema: {
      type: "object",
      properties: { workflow_id: { type: "string" }, input: { type: "object", description: "JSON input for the trigger" } },
      required: ["workflow_id"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: "get_execution",
    title: "Get a workflow run",
    description: "Get the status, step log and output of a past workflow run.",
    inputSchema: { type: "object", properties: { execution_id: { type: "string" } }, required: ["execution_id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_social_accounts",
    title: "List social accounts",
    description: "List the social accounts connected in FlowForge (LinkedIn, Facebook Page, Instagram, X, Bluesky, Mastodon, Discord, Slack). Use the `target` values with create_social_post.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_social_post",
    title: "Create a social post",
    description:
      "Publish a post now, schedule it, or save it as a draft, on one or more connected accounts. Attach pictures/PDF with image_urls (public links, up to 20) or media_ids (from import_post_from_link). " +
      "Without targets it posts to every connected LinkedIn account. Publishing is public and immediate unless schedule_at or draft is set — confirm with the user first.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The post text, including any hashtags" },
        targets: { type: "array", items: { type: "string" }, description: "Account targets from list_social_accounts. Default: all LinkedIn accounts." },
        link: { type: "string", description: "Optional link (shown as a preview when there's no file)" },
        image_urls: { type: "array", items: { type: "string" }, description: "Public URLs of JPG/PNG/GIF/WebP pictures or one PDF to attach" },
        media_ids: { type: "array", items: { type: "string" }, description: "File ids returned by import_post_from_link" },
        file_title: { type: "string", description: "PDF title shown on LinkedIn, or picture alt text" },
        schedule_at: { type: "string", description: "ISO 8601 date-time with time zone, e.g. 2026-11-23T09:00:00+05:30. Omit to post now." },
        draft: { type: "boolean", description: "Save to Social → Drafts instead of posting" },
      },
      required: ["text"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: "list_social_posts",
    title: "List social posts",
    description: "Recent posts made through FlowForge, with status (draft, scheduled, posted, partial, failed), scheduled time and the link to each published post.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["draft", "scheduled", "posted", "partial", "failed"] }, limit: { type: "number", description: "Default 20, max 100" } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "cancel_social_post",
    title: "Cancel a scheduled post or delete a draft",
    description: "Cancel a scheduled post or delete a draft by id. Doesn't remove posts already published.",
    inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"] },
    annotations: { destructiveHint: true },
  },
  {
    name: "import_post_from_link",
    title: "Import a post from its link",
    description:
      "Read a public post (LinkedIn post link, lnkd.in link, or any article) and return cleaned text with a credit line and hashtags, plus media_ids for its pictures or PDF. Pass the result to create_social_post.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        style: { type: "string", enum: ["clean", "rewrite", "short", "hook"], description: "clean keeps the wording; the others need an AI key on the server" },
        credit: { type: "boolean", description: "Add a credit line for the original author (default true)" },
        hashtags: { type: "array", items: { type: "string" }, description: "Your own hashtags to add first" },
        signature: { type: "string", description: "Your sign-off line to add" },
        download_files: { type: "boolean", description: "Download the post's pictures/PDF (default true)" },
      },
      required: ["url"],
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "suggest_hashtags",
    title: "Suggest hashtags",
    description: "Suggest 10–12 hashtags for a post's text.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    annotations: { readOnlyHint: true },
  },
] as const;

async function saveUrl(orgId: string, url: string) {
  const f = await downloadFile(url, 20 * 1024 * 1024);
  let mime = f.contentType.split(";")[0].trim().toLowerCase();
  if (mime === "application/octet-stream" && f.data.subarray(0, 5).toString() === "%PDF-") mime = "application/pdf";
  if (!/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(mime)) throw new HttpError(422, `${url} isn't a picture or PDF (${mime})`);
  const name = (f.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file").replace(/^\.+/, "") || "file";
  const [m] = await db.insert(schema.media).values({ orgId, token: randomToken(18), name, mime, size: f.data.length, data: f.data }).returning({ id: schema.media.id });
  return m.id;
}

export async function callTool(who: McpPrincipal, name: string, a: Record<string, unknown>, req: Request): Promise<unknown> {
  const orgId = who.org.id;
  switch (name) {
    case "list_workflows":
      return apiListWorkflows(who.org);
    case "run_workflow":
      return apiRunWorkflow(who.org, str(a.workflow_id), a.input ?? {}, "mcp", { skipPlanCheck: who.admin });
    case "get_execution":
      return apiGetExecution(who.org, str(a.execution_id));

    case "list_social_accounts": {
      const accounts = await socialAccounts(orgId);
      if (!accounts.length) return "No social accounts are connected yet. Connect LinkedIn and others in FlowForge → Connections.";
      return accounts.map((x) => ({ target: x.target, channel: x.channel, name: x.name }));
    }

    case "create_social_post": {
      const accounts = await socialAccounts(orgId);
      let targets = strs(a.targets);
      if (!targets.length) targets = accounts.filter((x) => x.channel === "linkedin").map((x) => x.target);
      if (!targets.length && !a.draft) throw new HttpError(422, "No target accounts. Call list_social_accounts, or connect LinkedIn in FlowForge → Connections.");
      const mediaIds = strs(a.media_ids);
      for (const u of strs(a.image_urls).slice(0, 20 - mediaIds.length)) mediaIds.push(await saveUrl(orgId, u));
      const post = await createPost(
        orgId,
        who.userId,
        { text: str(a.text), link: str(a.link) || undefined, mediaIds, mediaTitle: str(a.file_title) || undefined, targets, draft: a.draft === true, scheduledAt: str(a.schedule_at) || undefined },
        siteUrl(req),
      );
      return { id: post.id, status: post.status, scheduledAt: post.scheduledAt, results: post.results ?? undefined };
    }

    case "list_social_posts": {
      const limit = Math.min(100, Math.max(1, Number(a.limit) || 20));
      const status = str(a.status);
      const rows = await db
        .select({ id: schema.posts.id, text: schema.posts.text, status: schema.posts.status, scheduledAt: schema.posts.scheduledAt, postedAt: schema.posts.postedAt, results: schema.posts.results, createdAt: schema.posts.createdAt })
        .from(schema.posts)
        .where(status ? and(eq(schema.posts.orgId, orgId), eq(schema.posts.status, status)) : eq(schema.posts.orgId, orgId))
        .orderBy(desc(schema.posts.createdAt))
        .limit(limit);
      return rows.map((r) => ({ ...r, text: r.text.length > 300 ? `${r.text.slice(0, 300)}…` : r.text }));
    }

    case "cancel_social_post": {
      const r = await db
        .delete(schema.posts)
        .where(and(eq(schema.posts.id, str(a.post_id)), eq(schema.posts.orgId, orgId), inArray(schema.posts.status, ["scheduled", "draft"])))
        .returning({ id: schema.posts.id });
      if (!r.length) throw new HttpError(404, "No scheduled post or draft with that id");
      return { cancelled: r[0].id };
    }

    case "import_post_from_link": {
      const p = await fetchPost(str(a.url));
      let media: { id: string; mime: string }[] = [];
      let note: string | undefined;
      if (a.download_files !== false) {
        try {
          media = (await saveImportedFiles(orgId, p)).files.map((f) => ({ id: f.id, mime: f.mime }));
        } catch (e) {
          note = `Files not downloaded: ${(e as Error).message}`;
        }
      }
      const tags = strs(a.hashtags);
      const r = await rewritePost(p.text, {
        style: (str(a.style) || "clean") as RewriteStyle,
        author: p.author,
        url: p.url,
        credit: a.credit !== false,
        signature: str(a.signature) || undefined,
        myTags: tags.length ? tags : undefined,
        tagMode: (tags.length ? "mix" : undefined) as TagMode | undefined,
      });
      return { text: r.text, author: p.author, source_url: p.url, media_ids: media.map((m) => m.id), files: media, file_title: p.document?.title, note };
    }

    case "suggest_hashtags":
      return suggestHashtags(str(a.text));
  }
  throw new HttpError(400, `Unknown tool: ${name}`);
}
