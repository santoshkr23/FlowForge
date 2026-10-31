import * as schema from "../db/schema";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { normalizePgUrl } from "./pg-url";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __ffdb?: DB };

/**
 * DATABASE_URL=postgresql://...   → real Postgres (production; Neon/psql snippet formats are accepted)
 * DATABASE_URL=pglite://./.pglite → embedded Postgres in a local folder (quick local dev / tests)
 * DATABASE_URL=pglite://memory    → in-memory (tests)
 */
function create(): DB {
  const raw = process.env.DATABASE_URL ?? "pglite://./.pglite";
  if (raw.trim().startsWith("pglite://")) {
    const { PGlite } = require("@electric-sql/pglite");
    const { drizzle } = require("drizzle-orm/pglite");
    const target = raw.trim().slice("pglite://".length);
    const client = target === "memory" ? new PGlite() : new PGlite(target);
    return drizzle(client, { schema }) as DB;
  }
  const url = normalizePgUrl(raw);
  // Poolers (Neon "-pooler", PgBouncer) in transaction mode do not support prepared statements.
  const client = postgres(url, { max: 10, prepare: !/-pooler|pgbouncer=true/.test(url) });
  return drizzlePg(client, { schema }) as unknown as DB;
}

function getDb(): DB {
  return g.__ffdb ?? (g.__ffdb = create());
}

/**
 * Created on first use, not at import — so `next build` never needs a working database,
 * and a bad DATABASE_URL shows up as a clear error when the app starts instead of breaking the build.
 */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export { schema };
