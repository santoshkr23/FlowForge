import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { decryptJson, encryptJson } from "../crypto";
import { refreshIfNeeded, type OAuthSecret } from "../oauth/tokens";
import { StepError } from "./types";

export type Helpers = {
  /** decrypted connection values (token-paste apps) */
  connection: <T = Record<string, string>>(id: unknown) => Promise<T>;
  /** access token for OAuth or token-paste apps; refreshes and saves OAuth tokens when needed */
  token: (id: unknown) => Promise<{ accessToken: string; data: Record<string, unknown> }>;
};

/** Per-run connection access scoped to one workspace. */
export function connectionHelpers(orgId: string): Helpers {
  const cache = new Map<string, Record<string, unknown>>();

  async function load(id: unknown) {
    const key = String(id ?? "");
    if (!key) throw new StepError("Pick a connection for this step");
    if (cache.has(key)) return { key, data: cache.get(key)! };
    const [c] = await db
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.id, key), eq(schema.connections.orgId, orgId)))
      .limit(1);
    if (!c) throw new StepError("Connection not found — it may have been deleted");
    const data = decryptJson<Record<string, unknown>>(c.secret);
    cache.set(key, data);
    return { key, data };
  }

  return {
    connection: async <T,>(id: unknown) => (await load(id)).data as T,
    token: async (id: unknown) => {
      const { key, data } = await load(id);
      if (data.oauth) {
        let s = data as unknown as OAuthSecret;
        let fresh: OAuthSecret | null;
        try {
          fresh = await refreshIfNeeded(s);
        } catch (e) {
          throw new StepError((e as Error).message);
        }
        if (fresh) {
          s = fresh;
          cache.set(key, fresh as unknown as Record<string, unknown>);
          await db.update(schema.connections).set({ secret: encryptJson(fresh) }).where(eq(schema.connections.id, key));
        }
        return { accessToken: s.accessToken, data: { ...(s.extra ?? {}), account: s.account } };
      }
      const accessToken = String(data.accessToken ?? data.token ?? data.apiKey ?? "");
      if (!accessToken) throw new StepError("This connection has no token. Reconnect it.");
      return { accessToken, data };
    },
  };
}
