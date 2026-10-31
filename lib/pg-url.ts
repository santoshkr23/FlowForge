/**
 * Accepts a Postgres connection string in the forms people actually paste:
 *   postgresql://…            (plain)
 *   psql 'postgresql://…'     (Neon's "psql" snippet)
 *   DATABASE_URL=postgresql://… / "postgresql://…"
 * and drops libpq-only options that postgres.js would otherwise send to the
 * server as startup parameters (which the server rejects), e.g. Neon's channel_binding.
 */
const LIBPQ_ONLY = ["channel_binding", "gssencmode", "krbsrvname", "sslcompression", "requirepeer", "target_session_attrs_compat"];

export class InvalidDatabaseUrl extends Error {}

export function normalizePgUrl(raw: string | undefined | null): string {
  let s = String(raw ?? "").trim();
  s = s.replace(/^DATABASE_URL\s*=\s*/i, "");
  const found = s.match(/postgres(?:ql)?:\/\/[^\s'"`]+/i);
  if (!found) throw new InvalidDatabaseUrl("The database connection string should start with postgresql://. Copy the connection string itself, not a psql command.");
  let url: URL;
  try {
    url = new URL(found[0]);
  } catch {
    throw new InvalidDatabaseUrl("The database connection string isn't a valid address. Copy it again from your database provider.");
  }
  for (const k of LIBPQ_ONLY) url.searchParams.delete(k);
  return url.toString();
}
