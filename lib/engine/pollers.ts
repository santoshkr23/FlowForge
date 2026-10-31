/**
 * Watch triggers. Each poller compares what's there now with the saved state and returns only new items.
 * On the very first check it just records where things stand (no flood of old items).
 */
import { apiCall } from "./net";
import { readFeed, type FeedItem } from "./rss";
import { googleAccess } from "./modules/google";
import { shopify, woo, type ShopifyConn, type WooConn } from "./modules/business";
import { twitchStream } from "./modules/social";
import type { Helpers } from "./connections";

type State = Record<string, unknown> | null;
export type PollResult = { items: unknown[]; state: Record<string, unknown> };
type Poller = (p: { config: Record<string, unknown>; state: State; h: Helpers }) => Promise<PollResult>;

const s = (v: unknown) => (v == null ? "" : String(v)).trim();
const MAX_SEEN = 300;

/** Generic "list of items with ids" diff. `items` newest-first; returns new ones oldest-first. */
function diffById<T>(items: T[], id: (t: T) => string, state: State): PollResult {
  const ids = items.map(id);
  if (!state) return { items: [], state: { seen: ids.slice(0, MAX_SEEN) } };
  const seen = new Set((state.seen as string[]) ?? []);
  const fresh = items.filter((it) => !seen.has(id(it))).reverse();
  return { items: fresh, state: { seen: [...ids, ...(state.seen as string[])].filter((v, i, a) => a.indexOf(v) === i).slice(0, MAX_SEEN) } };
}

export const POLLERS: Record<string, Poller> = {
  "linkedin.profile_watch": async ({ config, state }) => {
    const { listItems } = await import("../social/watch");
    const items = await listItems({ profileUrl: s(config.profileUrl) || null, feedUrl: s(config.feedUrl) || null });
    return diffById(items.map((i) => ({ ...i, url: i.link })), (i) => i.id, state);
  },

  "rss.watch": async ({ config, state }) => diffById(await readFeed(s(config.url)), (i: FeedItem) => i.id, state),

  "youtube.watch": async ({ config, state }) => {
    const items = await readFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(s(config.channelId))}`);
    const videos = items.map((i) => ({ videoId: i.videoId ?? i.id.replace(/^yt:video:/, ""), title: i.title, link: i.link, published: i.published, author: i.author, description: i.summary }));
    return diffById(videos, (v) => v.videoId, state);
  },

  "gmail.watch": async ({ config, state, h }) => {
    const { accessToken } = await h.token(config.connectionId);
    const auth = { authorization: `Bearer ${accessToken}` };
    const q = encodeURIComponent(s(config.query) || "in:inbox");
    const list = await apiCall<{ messages?: { id: string }[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${q}`, { headers: auth });
    const r = diffById(list.messages ?? [], (m) => m.id, state);
    const detailed = [];
    for (const m of (r.items as { id: string }[]).slice(-10)) {
      const msg = await apiCall<{ id: string; threadId: string; snippet: string; labelIds: string[]; payload: { headers: { name: string; value: string }[] } }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: auth },
      );
      const hdr = (n: string) => msg.payload.headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
      detailed.push({ id: msg.id, threadId: msg.threadId, from: hdr("From"), to: hdr("To"), subject: hdr("Subject"), date: hdr("Date"), snippet: msg.snippet, labels: msg.labelIds });
    }
    return { items: detailed, state: r.state };
  },

  "sheets.watch": async ({ config, state, h }) => {
    const token = await googleAccess(h, config.connectionId, "https://www.googleapis.com/auth/spreadsheets.readonly");
    const range = encodeURIComponent(`${s(config.sheet) || "Sheet1"}!A:ZZ`);
    const r = await apiCall<{ values?: string[][] }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(s(config.spreadsheetId))}/values/${range}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = r.values ?? [];
    if (!state) return { items: [], state: { count: rows.length } };
    const prev = Number(state.count) || 0;
    const header = rows[0] ?? [];
    const items = rows.slice(Math.max(prev, 1)).map((values, i) => ({
      rowNumber: Math.max(prev, 1) + i + 1,
      values,
      row: Object.fromEntries(header.map((k, j) => [k || `col${j + 1}`, values[j] ?? ""])),
    }));
    return { items, state: { count: Math.max(rows.length, prev) } };
  },

  "shopify.watch_orders": async ({ config, state, h }) => {
    const c = await h.connection<ShopifyConn>(config.connectionId);
    if (!state) {
      const r = await shopify<{ orders: { id: number }[] }>(c, "/orders.json?status=any&limit=1&order=created_at%20desc&fields=id");
      return { items: [], state: { sinceId: r.orders[0]?.id ?? 0 } };
    }
    const r = await shopify<{ orders: { id: number }[] }>(c, `/orders.json?status=any&limit=50&since_id=${Number(state.sinceId) || 0}`);
    const orders = r.orders.sort((a, b) => a.id - b.id);
    return { items: orders, state: { sinceId: orders.length ? orders[orders.length - 1].id : state.sinceId } };
  },

  "woocommerce.watch_orders": async ({ config, state, h }) => {
    const c = await h.connection<WooConn>(config.connectionId);
    const now = new Date().toISOString().slice(0, 19);
    if (!state) return { items: [], state: { after: now, seen: [] } };
    const orders = await woo<{ id: number; date_created_gmt: string }[]>(c, `/orders?after=${encodeURIComponent(String(state.after))}&dates_are_gmt=true&orderby=date&order=asc&per_page=50`);
    const seen = new Set((state.seen as number[]) ?? []);
    const fresh = orders.filter((o) => !seen.has(o.id));
    const latest = orders.reduce((m, o) => (o.date_created_gmt > m ? o.date_created_gmt : m), String(state.after));
    return { items: fresh, state: { after: latest, seen: [...orders.map((o) => o.id), ...seen].slice(0, MAX_SEEN) } };
  },

  "squarespace.watch_orders": async ({ config, state, h }) => {
    const { accessToken } = await h.token(config.connectionId);
    const now = new Date().toISOString();
    if (!state) return { items: [], state: { since: now, seen: [] } };
    const q = new URLSearchParams({ modifiedAfter: String(state.since), modifiedBefore: now });
    const r = await apiCall<{ result: { id: string; createdOn: string }[] }>(`https://api.squarespace.com/1.0/commerce/orders?${q}`, {
      headers: { authorization: `Bearer ${accessToken}`, "user-agent": "FlowForge/1.0" },
    });
    const seen = new Set((state.seen as string[]) ?? []);
    const fresh = r.result.filter((o) => o.createdOn >= String(state.since) && !seen.has(o.id)).sort((a, b) => a.createdOn.localeCompare(b.createdOn));
    return { items: fresh, state: { since: now, seen: [...fresh.map((o) => o.id), ...seen].slice(0, MAX_SEEN) } };
  },

  "twitch.watch_live": async ({ config, state, h }) => {
    const c = await h.connection<{ clientId: string; clientSecret: string }>(config.connectionId);
    const st = await twitchStream(c, s(config.channel));
    const streamId = "id" in st ? st.id : null;
    const wentLive = !!state && st.live && streamId !== state.streamId;
    return { items: wentLive ? [st] : [], state: { streamId } };
  },
};
