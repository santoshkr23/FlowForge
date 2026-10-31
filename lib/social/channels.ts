/** Social channels shared by the server publisher and the composer UI (no server imports here). */

export type Channel = "linkedin" | "facebook" | "instagram" | "x" | "bluesky" | "mastodon" | "discord" | "slack";

export const CHANNELS: Record<Channel, { name: string; limit?: number; media: "image+pdf" | "image" | "image-required" | "link"; color: string }> = {
  linkedin: { name: "LinkedIn", limit: 3000, media: "image+pdf", color: "#0a66c2" },
  facebook: { name: "Facebook Page", limit: 63206, media: "image", color: "#1877f2" },
  instagram: { name: "Instagram", limit: 2200, media: "image-required", color: "#d62976" },
  x: { name: "X (Twitter)", limit: 280, media: "link", color: "#000000" },
  bluesky: { name: "Bluesky", limit: 300, media: "image", color: "#1185fe" },
  mastodon: { name: "Mastodon", limit: 500, media: "image", color: "#6364ff" },
  discord: { name: "Discord", limit: 2000, media: "image+pdf", color: "#5865f2" },
  slack: { name: "Slack", limit: 40000, media: "link", color: "#4a154b" },
};

const APP_CHANNELS: Record<string, Channel[]> = {
  linkedin: ["linkedin"],
  facebook: ["facebook", "instagram"],
  twitter: ["x"],
  bluesky: ["bluesky"],
  mastodon: ["mastodon"],
  discord: ["discord"],
  slack: ["slack"],
};

export type Account = { target: string; connectionId: string; channel: Channel; name: string; app: string };

/** Every account the composer can post to, built from the workspace's connections. */
export function accountsFrom(conns: { id: string; app: string; name: string }[]): Account[] {
  const out: Account[] = [];
  for (const c of conns)
    for (const ch of APP_CHANNELS[c.app] ?? [])
      out.push({ target: ch === "instagram" ? `${c.id}:instagram` : c.id, connectionId: c.id, channel: ch, name: ch === "instagram" ? `${c.name} → Instagram` : c.name, app: c.app });
  return out;
}

export const socialApps = Object.keys(APP_CHANNELS);

/** X counts every link as 23 characters. */
export function xLength(text: string) {
  return [...text.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;
}

