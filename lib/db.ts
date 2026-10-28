import * as schema from "../db/schema";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __ffdb?: DB };

/**
 * DATABASE_URL=postgresql://...   → real Postgres (production)
 * DATABASE_URL=pglite://./.pglite → embedded Postgres in a local folder (quick local dev / tests)
 * DATABASE_URL=pglite://memory    → in-memory (tests)
 */
function create(): DB {
  const url = process.env.DATABASE_URL ?? "pglite://./.pglite";
  if (url.startsWith("pglite://")) {
    const { PGlite } = require("@electric-sql/pglite");
    const { drizzle } = require("drizzle-orm/pglite");
    const target = url.slice("pglite://".length);
    const client = target === "memory" ? new PGlite() : new PGlite(target);
    return drizzle(client, { schema }) as DB;
  }
  const client = postgres(url, { max: 10 });
  return drizzlePg(client, { schema }) as unknown as DB;
}

export const db: DB = g.__ffdb ?? (g.__ffdb = create());
export { schema };
