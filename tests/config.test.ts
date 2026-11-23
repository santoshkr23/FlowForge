// API keys saved from /admin: encrypted in the DB, used immediately, env as fallback; first user is admin when ADMIN_EMAILS is empty.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, schema } from "../lib/db";
import { cfg, cfgSource, setConfig, settingsView } from "../lib/config";
import { providerConfigured } from "../lib/oauth/providers";
import { registerUser, isSuperAdmin, loadSiteOwner } from "../lib/auth";

before(async () => {
  await migrate(db as never, { migrationsFolder: "./db/migrations" });
});

test("panel values win over env, are encrypted at rest, and removing falls back to env", async () => {
  process.env.GOOGLE_CLIENT_ID = "env-id";
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.equal(cfg("GOOGLE_CLIENT_ID"), "env-id");
  assert.equal(providerConfigured("youtube"), false);

  await setConfig("GOOGLE_CLIENT_ID", "panel-id.apps.googleusercontent.com", "me@example.com");
  await setConfig("GOOGLE_CLIENT_SECRET", "GOCSPX-secret-value", "me@example.com");
  assert.equal(cfg("GOOGLE_CLIENT_ID"), "panel-id.apps.googleusercontent.com");
  assert.equal(cfgSource("GOOGLE_CLIENT_SECRET"), "panel");
  assert.equal(providerConfigured("youtube"), true); // YouTube reuses the Google app
  assert.equal(providerConfigured("google"), true);

  const rows = await db.select().from(schema.appSettings);
  assert.ok(rows.every((r) => !r.value.includes("GOCSPX") && !r.value.includes("panel-id")));

  const view = settingsView().find((g) => g.title === "Google & YouTube")!;
  const secret = view.keys.find((k) => k.key === "GOOGLE_CLIENT_SECRET")!;
  assert.equal(secret.preview, "GOCS••••alue");

  await setConfig("GOOGLE_CLIENT_ID", null);
  assert.equal(cfg("GOOGLE_CLIENT_ID"), "env-id");
  assert.equal(cfgSource("GOOGLE_CLIENT_ID"), "env");
});

test("no ADMIN_EMAILS: the first person who signed up is the site admin", async () => {
  delete process.env.ADMIN_EMAILS;
  await registerUser("owner@example.com", "password123", "Owner");
  await registerUser("someone@example.com", "password123", "Someone");
  await loadSiteOwner();
  assert.equal(isSuperAdmin("owner@example.com"), true);
  assert.equal(isSuperAdmin("someone@example.com"), false);
  process.env.ADMIN_EMAILS = "someone@example.com";
  assert.equal(isSuperAdmin("owner@example.com"), false);
  delete process.env.ADMIN_EMAILS;
});
