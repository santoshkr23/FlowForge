import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";

const MAX_KEYS = 10_000;

export async function dsGet(orgId: string, store: string, key: string) {
  const [row] = await db
    .select()
    .from(schema.dataStores)
    .where(and(eq(schema.dataStores.orgId, orgId), eq(schema.dataStores.name, store)))
    .limit(1);
  const records = row?.records ?? {};
  return { found: key in records, value: records[key] };
}

export async function dsSet(orgId: string, store: string, key: string, value: unknown) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.dataStores)
      .where(and(eq(schema.dataStores.orgId, orgId), eq(schema.dataStores.name, store)))
      .for("update")
      .limit(1);
    if (!row) {
      await tx.insert(schema.dataStores).values({ orgId, name: store, records: { [key]: value } });
      return;
    }
    const records = { ...row.records, [key]: value };
    if (Object.keys(records).length > MAX_KEYS) throw new Error(`Data store "${store}" is full (${MAX_KEYS} keys)`);
    await tx.update(schema.dataStores).set({ records, updatedAt: new Date() }).where(eq(schema.dataStores.id, row.id));
  });
}
