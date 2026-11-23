import { z } from "zod";
import { getCtx } from "@/lib/auth";
import { body, err, json } from "@/lib/http";
import { EDITABLE_KEYS, loadConfig, setConfig, settingsView } from "@/lib/config";
import { audit } from "@/lib/audit";

export async function GET() {
  const ctx = await getCtx();
  if (!ctx?.isSuperAdmin) return err("Forbidden", 403);
  await loadConfig(true);
  return json(settingsView());
}

/** Save API keys. A value of "" or null removes the panel value (the server's env value, if any, applies again). */
export async function POST(req: Request) {
  const ctx = await getCtx();
  if (!ctx?.isSuperAdmin) return err("Forbidden", 403);
  const b = await body(req, z.object({ values: z.record(z.string(), z.string().max(4000).nullable()) }));
  const keys = Object.keys(b.values).filter((k) => EDITABLE_KEYS.has(k));
  if (!keys.length) return err("Nothing to save", 422);
  if (b.values.APP_URL && !/^https?:\/\/[^/\s]+$/.test(b.values.APP_URL.trim().replace(/\/+$/, ""))) return err("Site address must look like https://flowforge.example.com (no path)", 422);
  for (const k of keys) await setConfig(k, b.values[k] === null ? null : k === "APP_URL" ? b.values[k]!.trim().replace(/\/+$/, "") : b.values[k], ctx.user.email);
  await audit(ctx.org.id, ctx.user.id, "settings.updated", undefined, { keys });
  return json(settingsView());
}
