/**
 * Applies SQL migrations in db/migrations to DATABASE_URL.
 * Run after `npm run db:generate` whenever db/schema.ts changes.
 */
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import { db } from "../lib/db";
import { InvalidDatabaseUrl } from "../lib/pg-url";

async function main() {
  const url = process.env.DATABASE_URL ?? "pglite://./.pglite";
  const folder = { migrationsFolder: "./db/migrations" };
  if (url.trim().startsWith("pglite://")) await migrateLite(db as any, folder);
  else await migratePg(db as any, folder);
  console.log("✔ migrations applied");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof InvalidDatabaseUrl ? `✖ DATABASE_URL problem: ${e.message}` : e);
  process.exit(1);
});
