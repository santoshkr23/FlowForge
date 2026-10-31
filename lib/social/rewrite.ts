/**
 * "Copy & clean" for posts you want to reshare: strips LinkedIn/X page clutter from pasted text,
 * optionally rewrites it in your own words with AI, and adds a credit line for the original author.
 */
import { aiProvider, chat } from "../ai";
import { keywordHashtags } from "./hashtags";

export type RewriteStyle = "clean" | "rewrite" | "short" | "hook";

const JUNK_LINES: RegExp[] = [
  /^…?\s*(see more|see less|more|show more|read more)\s*$/i,
  /^(like|comment|repost|send|share|follow|following|connect|message|reply|report)\s*$/i,
  /^\d[\d,.]*\s*(k|m)?\s*(reactions?|likes?|comments?|reposts?|shares?|impressions?|views?|followers?)\b.*$/i,
  /^[\d,.]+\s*$/,
  /^(activate to view larger image,?|no alternative text description for this image|view image|play video|image|video|document|feed post|promoted|edited|visible to anyone on or off linkedin)\.?\s*$/i,
  /^\d+\s*(s|m|h|d|w|mo|yr|y)\s*[•·]?\s*(edited)?\s*[•·]?\s*$/i,
  /^[•·]\s*(1st|2nd|3rd\+?|you)\s*$/i,
  /^(1st|2nd|3rd\+?)\s*$/i,
  /^.*\bpage(s)?\s*\d+\s*(of|\/)\s*\d+\s*$/i,
];
const JUNK_INLINE: RegExp[] = [
  /…\s*see more/gi,
  /\.\.\.\s*see more/gi,
  /\bhashtag\s*(?=#)/gi,
];
const CTA_LINES: RegExp[] = [
  /^\s*(♻️|🔁|🔄|➕|👉|✅|🔔|💬|📌)?\s*(repost|reshare|share)\b.*(network|connections|others|help|if)\b.*$/i,
  /^\s*(♻️|🔁|🔄|➕|👉|✅|🔔|💬|📌)?\s*follow\s+(me|@?[\p{L} .'-]{2,40})\s+(for|to)\b.*$/iu,
  /^\s*(♻️|🔁|🔄|➕|👉|✅|🔔|💬|📌)?\s*(p\.?s\.?\s*)?(hit|smash|click|tap)\s+(the\s+)?(bell|like|follow)\b.*$/i,
  /^\s*(♻️|🔁|🔄|➕|👉|✅|🔔|💬|📌)?\s*(like|comment)\s*(,|&|and)\s*(share|repost|comment|follow)\b.*$/i,
  /^\s*(♻️|🔁|🔄|➕|👉|✅|🔔|💬|📌)?\s*(dm|comment)\s+(me\s+)?["“']?\w+["”']?\s+(to|and i'?ll|for)\b.*$/i,
  /^\s*(♻️|🔁|🔄|➕|👉|✅|🔔|💬|📌)?\s*(join|subscribe to)\s+(my|our)\s+(newsletter|community|channel)\b.*$/i,
];

/** Remove page clutter, sign-off calls-to-action, @mentions' "@" and the trailing hashtag block. */
export function htmlToText(h: string) {
  if (!/<[a-z][^>]*>/i.test(h)) return h;
  return h
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function cleanPost(raw: string): { text: string; hashtags: string[] } {
  let t = htmlToText(raw).replace(/\r\n?/g, "\n").replace(/[​‌‍﻿]/g, "");
  for (const re of JUNK_INLINE) t = t.replace(re, "");
  const hashtags = [...t.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]);
  let lines = t.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
  // copied from the feed: "Name / • 2nd / headline / 1w • Edited •" sits above the post — drop that header
  const stamp = lines.slice(0, 8).findIndex((l) => /^\s*\d+\s*(s|m|h|d|w|mo|yr|y)\s*[•·]/i.test(l) || /^\s*\d+\s*(s|m|h|d|w|mo|yr|y)\s*$/i.test(l));
  if (stamp >= 0) lines = lines.slice(stamp + 1);
  const kept = lines.filter((l) => {
    const s = l.trim();
    if (!s) return true;
    if (JUNK_LINES.some((re) => re.test(s))) return false;
    if (CTA_LINES.some((re) => re.test(s))) return false;
    if (/^(#[\p{L}\p{N}_]+[\s,]*)+$/u.test(s)) return false; // a line that is only hashtags
    return true;
  });
  t = kept
    .join("\n")
    .replace(/(^|\s)@([\p{L}][\p{L}\p{N} ._-]{1,40}?)(?=[\s,.!?:;)]|$)/gu, "$1$2") // "@Jane Doe" → "Jane Doe"
    .replace(/(\s#[\p{L}\p{N}_]+)+\s*$/u, "") // hashtags dangling at the end of the last line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: t, hashtags: [...new Set(hashtags)] };
}

export function creditLine(author?: string, url?: string) {
  const a = (author ?? "").trim();
  const u = (url ?? "").trim();
  if (!a && !u) return "";
  return `📌 Credit: ${a || "original post"}${u ? ` — ${u}` : ""}`;
}

const STYLE_PROMPT: Record<Exclude<RewriteStyle, "clean">, string> = {
  rewrite: "Rewrite it fully in fresh words, keeping the ideas, facts and structure. Don't copy sentences.",
  short: "Rewrite it as a much shorter post (under 600 characters) that keeps the key takeaway.",
  hook: "Rewrite it with a strong first-line hook, short punchy lines and a question at the end to invite comments.",
};

/**
 * Clean (and optionally rewrite) a post. Without an AI key, every style falls back to cleaning.
 * Hashtags: the original's tags first, then fresh suggestions; up to `maxTags` appended on the last line.
 */
export async function rewritePost(
  raw: string,
  opts: { style?: RewriteStyle; author?: string; url?: string; credit?: boolean; maxTags?: number } = {},
): Promise<{ text: string; body: string; hashtags: string[]; source: "ai" | "clean" }> {
  const style = opts.style ?? "clean";
  const cleaned = cleanPost(raw);
  let body = cleaned.text;
  let source: "ai" | "clean" = "clean";
  if (style !== "clean" && aiProvider() && body) {
    try {
      const r = await chat({
        system:
          "You help a professional reshare a LinkedIn post they found valuable. " +
          STYLE_PROMPT[style] +
          " Plain text only, no markdown, no hashtags, no @mentions, no calls to follow or repost. Keep emojis sparing. Never claim personal experiences that the original author had — write as someone sharing and commenting on their insight. Return only the post.",
        messages: [{ role: "user", content: body.slice(0, 6000) }],
        maxTokens: 900,
      });
      const out = r.text.trim().replace(/^["“]|["”]$/g, "");
      if (out) {
        body = cleanPost(out).text;
        source = "ai";
      }
    } catch {
      /* keep the cleaned text */
    }
  }
  const max = opts.maxTags ?? 5;
  const tags = [...new Set([...cleaned.hashtags, ...keywordHashtags(body, 12)])].slice(0, max);
  const credit = opts.credit === false ? "" : creditLine(opts.author, opts.url);
  const text = [body, credit, tags.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n\n");
  return { text, body, hashtags: tags, source };
}
