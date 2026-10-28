import { XMLParser } from "fast-xml-parser";
import { httpRequest } from "./net";
import { StepError } from "./types";

export type FeedItem = { id: string; title: string; link: string; summary: string; published: string; author?: string; videoId?: string };

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  const o = v as Record<string, unknown>;
  return text(o["#text"] ?? o["@_href"] ?? "");
};
const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Fetch and parse an RSS 2.0 or Atom feed (newest first, as published). */
export async function readFeed(url: string): Promise<FeedItem[]> {
  const r = await httpRequest(url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, timeoutMs: 20_000 });
  if (r.status >= 400) throw new StepError(`Feed returned ${r.status}`);
  const xml = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  // eslint-disable-next-line
  let doc: Record<string, any>;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
  } catch {
    throw new StepError("That URL isn't a valid RSS or Atom feed");
  }
  const arr = (x: unknown) => (Array.isArray(x) ? x : x ? [x] : []);
  if (doc.rss?.channel) {
    return arr(doc.rss.channel.item).map((it: Record<string, unknown>) => ({
      id: text(it.guid) || text(it.link) || text(it.title),
      title: text(it.title),
      link: text(it.link),
      summary: strip(text(it.description)).slice(0, 2000),
      published: text(it.pubDate),
      author: text(it.author ?? it["dc:creator"]) || undefined,
    }));
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((it: Record<string, unknown>) => {
      const links = arr(it.link) as Record<string, string>[];
      const href = (links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0])?.["@_href"] ?? "";
      const media = it["media:group"] as Record<string, unknown> | undefined;
      return {
        id: text(it.id) || href,
        title: text(it.title),
        link: href,
        summary: strip(text(it.summary ?? it.content ?? media?.["media:description"])).slice(0, 2000),
        published: text(it.published ?? it.updated),
        author: text((it.author as Record<string, unknown>)?.name) || undefined,
        videoId: text(it["yt:videoId"]) || undefined,
      };
    });
  }
  throw new StepError("That URL isn't a valid RSS or Atom feed");
}
