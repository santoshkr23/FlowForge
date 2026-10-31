/**
 * Import a post from its public link: text, author, pictures and (for LinkedIn document posts) the PDF.
 * Works on public pages only — no logins. LinkedIn sometimes shows a sign-in wall to servers instead of
 * the post; then we say so and the user can paste the text instead.
 */
import { db, schema } from "../db";
import { assertPublicUrl, downloadFile } from "../engine/net";
import { StepError } from "../engine/types";
import { htmlToText } from "./rewrite";

export type ImportedPost = {
  url: string;
  site: "linkedin" | "web";
  author?: string;
  authorUrl?: string;
  text: string;
  images: string[];
  document?: { url: string; title?: string; pages?: number };
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

function meta(html: string, prop: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? decode(c) : undefined;
}

function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1].trim());
      for (const x of Array.isArray(v) ? v : v["@graph"] ? v["@graph"] : [v]) if (x && typeof x === "object") out.push(x);
    } catch {
      /* ignore broken blocks */
    }
  }
  return out;
}

const isLinkedIn = (u: string) => /(^|\.)linkedin\.com$/i.test(new URL(u).hostname);

/** lnkd.in short links show a "you're leaving LinkedIn" page — pull the real address out of it. */
function unwrapShortLink(html: string): string | undefined {
  const hrefs = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => decode(m[1]));
  return hrefs.find((h) => /linkedin\.com\/(posts|feed\/update|pulse)\//i.test(h)) ?? hrefs.find((h) => !/(lnkd\.in|linkedin\.com\/(legal|help|signup|login|uas|authwall)|licdn\.com)/i.test(h));
}

async function getPage(url: string) {
  await assertPublicUrl(url);
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(20_000),
  });
  const html = (await res.text()).slice(0, 4_000_000);
  return { status: res.status, finalUrl: res.url || url, html };
}

export function parseLinkedIn(html: string, url: string): ImportedPost {
  const post: ImportedPost = { url, site: "linkedin", text: "", images: [] };
  // 1. structured data
  for (const j of jsonLd(html)) {
    const type = String(j["@type"] ?? "");
    if (!/SocialMediaPosting|DiscussionForumPosting|Article|NewsArticle|BlogPosting/.test(type)) continue;
    const a = (Array.isArray(j.author) ? j.author[0] : j.author) as { name?: string; url?: string } | undefined;
    post.author ??= a?.name;
    post.authorUrl ??= a?.url;
    const body = (j.articleBody ?? j.text ?? j.description) as string | undefined;
    if (body && body.length > post.text.length) post.text = decode(body);
    const imgs = ([] as unknown[]).concat(j.image ?? []).map((i) => (typeof i === "string" ? i : (i as { url?: string })?.url)).filter(Boolean) as string[];
    post.images.push(...imgs);
  }
  // 2. the post body as rendered on the public page
  const seg = html.match(/<p[^>]*class=["'][^"']*attributed-text-segment-list__content[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (seg) {
    const t = htmlToText(seg.replace(/<br\s*\/?>/gi, "\n")).trim();
    if (t.length > post.text.length) post.text = decode(t);
  }
  // 3. meta tags as a last resort
  if (!post.text) post.text = meta(html, "og:description") ?? meta(html, "description") ?? "";
  if (!post.author) {
    const title = meta(html, "og:title") ?? "";
    post.author = title.match(/^(.+?)(?: on LinkedIn| posted on| \|)/)?.[1]?.trim() || undefined;
  }
  // document (PDF carousel)
  const docCfg = html.match(/data-native-document-config=["']([^"']+)["']/i)?.[1];
  if (docCfg) {
    try {
      const d = JSON.parse(decode(docCfg)).doc ?? {};
      const pdf = d.transcribedDocumentUrl ?? d.url;
      if (pdf) post.document = { url: pdf, title: d.title, pages: d.totalPageCount };
    } catch {
      /* ignore */
    }
  }
  if (!post.document) {
    const pdf = html.match(/https:\/\/media\.licdn\.com\/dms\/document\/[^"'\s<>]+/i)?.[0];
    if (pdf) post.document = { url: decode(pdf), title: meta(html, "og:title") };
  }
  // pictures inside the post (not avatars)
  for (const m of html.matchAll(/(?:data-delayed-url|src)=["'](https:\/\/media\.licdn\.com\/dms\/image\/[^"']+)["']/gi)) {
    const u = decode(m[1]);
    if (/feedshare|image-shrink|article-cover|feed-images/i.test(u)) post.images.push(u);
  }
  const og = meta(html, "og:image");
  if (!post.images.length && og && !/profile-displayphoto|company-logo|static\.licdn\.com/i.test(og)) post.images.push(og);
  post.images = [...new Set(post.images)];
  post.text = post.text.trim();
  return post;
}

export function parseWeb(html: string, url: string): ImportedPost {
  const ld = jsonLd(html).find((j) => /Posting|Article/.test(String(j["@type"] ?? "")));
  const a = (Array.isArray(ld?.author) ? (ld?.author as unknown[])[0] : ld?.author) as { name?: string; url?: string } | undefined;
  const text = [meta(html, "og:title"), meta(html, "og:description") ?? meta(html, "description")].filter(Boolean).join("\n\n");
  const img = meta(html, "og:image");
  return { url, site: "web", author: a?.name ?? meta(html, "author") ?? meta(html, "og:site_name"), authorUrl: a?.url, text, images: img ? [img] : [] };
}

/** Fetch a post page and read what's on it. */
export async function fetchPost(rawUrl: string): Promise<ImportedPost> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    new URL(url);
  } catch {
    throw new StepError("That doesn't look like a link");
  }
  let page = await getPage(url);
  if (/(^|\.)lnkd\.in$/i.test(new URL(page.finalUrl).hostname)) {
    const real = unwrapShortLink(page.html);
    if (!real) throw new StepError("Couldn't follow that lnkd.in short link. Open it and paste the full linkedin.com address.");
    page = await getPage(real);
  }
  const final = page.finalUrl;
  if (isLinkedIn(final) || isLinkedIn(url)) {
    if (/\/(authwall|login|signup|uas\/)/i.test(final) || page.status === 999 || /<title>[^<]*(Sign Up|Log In|Sign in)[^<]*<\/title>/i.test(page.html))
      throw new StepError(
        "LinkedIn showed a sign-in page instead of the post, so it can't be read automatically. Make sure the post is public, or paste its text and attach the file yourself.",
      );
    if (page.status >= 400) throw new StepError(`LinkedIn returned an error (${page.status}). The post may be deleted or private.`);
    const p = parseLinkedIn(page.html, final);
    if (!p.text && !p.document && !p.images.length) throw new StepError("Couldn't find a post on that page. It may be private.");
    return p;
  }
  if (page.status >= 400) throw new StepError(`That page returned an error (${page.status})`);
  return parseWeb(page.html, final);
}

/** Download the post's PDF (preferred) or first picture into the media library. */
export async function saveImportedFile(orgId: string, p: ImportedPost): Promise<{ id: string; name: string; mime: string; size: number; token: string } | null> {
  const src = p.document?.url ?? p.images[0];
  if (!src) return null;
  const f = await downloadFile(src, 20 * 1024 * 1024);
  let mime = f.contentType.split(";")[0].trim().toLowerCase();
  if (p.document && (mime === "application/octet-stream" || f.data.subarray(0, 5).toString() === "%PDF-")) mime = "application/pdf";
  if (!/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(mime)) return null;
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1].replace("jpeg", "jpg");
  const base = (p.document?.title || p.author || "post").replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "post";
  const [m] = await db
    .insert(schema.media)
    .values({ orgId, token: crypto.randomUUID().replace(/-/g, ""), name: `${base}.${ext}`, mime, size: f.data.length, data: f.data })
    .returning({ id: schema.media.id, name: schema.media.name, mime: schema.media.mime, size: schema.media.size, token: schema.media.token });
  return m;
}
