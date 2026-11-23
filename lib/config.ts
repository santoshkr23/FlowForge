/**
 * Settings that can be edited in /admin → API keys, falling back to environment variables.
 * Values are kept encrypted in the database and cached in memory (refreshed every 30 s and after each save),
 * so code can read them synchronously with cfg("GOOGLE_CLIENT_ID").
 */
import { db, schema } from "./db";
import { decryptJson, encryptJson } from "./crypto";
import { eq } from "drizzle-orm";

const g = globalThis as unknown as { __ffCfg?: Map<string, string>; __ffCfgAt?: number; __ffCfgLoading?: Promise<void> };

export function cfg(key: string): string | undefined {
  const v = g.__ffCfg?.get(key);
  if (v !== undefined && v !== "") return v;
  return process.env[key];
}

/** Where a value comes from, for the admin page. */
export function cfgSource(key: string): "panel" | "env" | "none" {
  if (g.__ffCfg?.get(key)) return "panel";
  return process.env[key] ? "env" : "none";
}

export async function loadConfig(force = false) {
  if (!force && g.__ffCfgAt && Date.now() - g.__ffCfgAt < 30_000) return;
  if (g.__ffCfgLoading) return g.__ffCfgLoading;
  g.__ffCfgLoading = (async () => {
    try {
      const rows = await db.select().from(schema.appSettings);
      const m = new Map<string, string>();
      for (const r of rows) {
        try {
          m.set(r.key, decryptJson<{ v: string }>(r.value).v);
        } catch {
          /* undecryptable (key changed) — ignore */
        }
      }
      g.__ffCfg = m;
      g.__ffCfgAt = Date.now();
    } catch {
      /* table not there yet (before migrations) — env only */
    } finally {
      g.__ffCfgLoading = undefined;
    }
  })();
  return g.__ffCfgLoading;
}

export async function setConfig(key: string, value: string | null, by?: string) {
  if (value === null || value.trim() === "") await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
  else {
    const enc = encryptJson({ v: value.trim() });
    await db
      .insert(schema.appSettings)
      .values({ key, value: enc, updatedBy: by ?? null, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: enc, updatedBy: by ?? null, updatedAt: new Date() } });
  }
  await loadConfig(true);
}

/** The settings the admin page offers, grouped. secret = shown masked. */
export const SETTING_GROUPS: { title: string; help?: string; keys: { key: string; label: string; secret?: boolean; placeholder?: string }[] }[] = [
  {
    title: "Site",
    help: "Your public address. Change it when you move from the IP to a domain.",
    keys: [{ key: "APP_URL", label: "Site address (APP_URL)", placeholder: "https://flowforge.example.com" }],
  },
  {
    title: "Google & YouTube",
    help: "console.cloud.google.com → APIs & Services → Credentials → OAuth client (Web). Enable YouTube Data API v3.",
    keys: [
      { key: "GOOGLE_CLIENT_ID", label: "Client ID" },
      { key: "GOOGLE_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
  },
  {
    title: "LinkedIn",
    help: "linkedin.com/developers → your app → Auth.",
    keys: [
      { key: "LINKEDIN_CLIENT_ID", label: "Client ID" },
      { key: "LINKEDIN_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
  },
  {
    title: "Facebook & Instagram",
    help: "developers.facebook.com → your app → Settings → Basic.",
    keys: [
      { key: "FACEBOOK_CLIENT_ID", label: "App ID" },
      { key: "FACEBOOK_CLIENT_SECRET", label: "App secret", secret: true },
    ],
  },
  {
    title: "X (Twitter)",
    help: "developer.x.com → your app → Keys and tokens → OAuth 2.0 Client ID and Secret.",
    keys: [
      { key: "TWITTER_CLIENT_ID", label: "Client ID" },
      { key: "TWITTER_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
  },
  {
    title: "Microsoft",
    keys: [
      { key: "MICROSOFT_CLIENT_ID", label: "Application (client) ID" },
      { key: "MICROSOFT_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
  },
  {
    title: "Pinterest, Dropbox, Tumblr, Zoho",
    keys: [
      { key: "PINTEREST_CLIENT_ID", label: "Pinterest app ID" },
      { key: "PINTEREST_CLIENT_SECRET", label: "Pinterest app secret", secret: true },
      { key: "DROPBOX_CLIENT_ID", label: "Dropbox app key" },
      { key: "DROPBOX_CLIENT_SECRET", label: "Dropbox app secret", secret: true },
      { key: "TUMBLR_CLIENT_ID", label: "Tumblr consumer key" },
      { key: "TUMBLR_CLIENT_SECRET", label: "Tumblr consumer secret", secret: true },
      { key: "ZOHO_CLIENT_ID", label: "Zoho client ID" },
      { key: "ZOHO_CLIENT_SECRET", label: "Zoho client secret", secret: true },
    ],
  },
  {
    title: "AI",
    help: "Used for AI steps, rewriting posts and hashtag ideas.",
    keys: [
      { key: "OPENAI_API_KEY", label: "OpenAI API key", secret: true, placeholder: "sk-…" },
      { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude) API key", secret: true, placeholder: "sk-ant-…" },
      { key: "AI_PROVIDER", label: "Default provider (openai or anthropic)", placeholder: "openai" },
    ],
  },
  {
    title: "Payments — Stripe",
    keys: [
      { key: "STRIPE_SECRET_KEY", label: "Secret key", secret: true, placeholder: "sk_live_…" },
      { key: "STRIPE_WEBHOOK_SECRET", label: "Webhook signing secret", secret: true, placeholder: "whsec_…" },
    ],
  },
  {
    title: "Payments — Razorpay",
    keys: [
      { key: "RAZORPAY_KEY_ID", label: "Key ID", placeholder: "rzp_live_…" },
      { key: "RAZORPAY_KEY_SECRET", label: "Key secret", secret: true },
      { key: "RAZORPAY_WEBHOOK_SECRET", label: "Webhook secret", secret: true },
    ],
  },
  {
    title: "Email (SMTP)",
    help: "For team invites and email steps.",
    keys: [
      { key: "SMTP_HOST", label: "Host", placeholder: "smtp.gmail.com" },
      { key: "SMTP_PORT", label: "Port", placeholder: "587" },
      { key: "SMTP_USER", label: "Username" },
      { key: "SMTP_PASS", label: "Password", secret: true },
      { key: "SMTP_FROM", label: "From address", placeholder: "FlowForge <hello@example.com>" },
    ],
  },
];

export const EDITABLE_KEYS = new Set(SETTING_GROUPS.flatMap((g2) => g2.keys.map((k) => k.key)));

const mask = (v: string) => (v.length <= 8 ? "••••" : `${v.slice(0, 4)}••••${v.slice(-4)}`);

/** What the admin page shows: where each value comes from, secrets masked. */
export function settingsView() {
  return SETTING_GROUPS.map((g) => ({
    ...g,
    keys: g.keys.map((k) => {
      const v = cfg(k.key) ?? "";
      return { ...k, source: cfgSource(k.key), preview: v ? (k.secret ? mask(v) : v) : "" };
    }),
  }));
}

