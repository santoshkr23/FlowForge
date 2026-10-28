import { and, count, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { PLANS } from "./plans";
import { audit } from "./audit";

export async function seatCount(orgId: string) {
  const [{ n }] = await db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId));
  return n;
}

/** Joins the invited workspace if the token is valid and matches the email. Returns orgId or null. */
export async function acceptInvite(token: string, userId: string, email: string): Promise<string | null> {
  const [inv] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.token, token), isNull(schema.invites.acceptedAt)))
    .limit(1);
  if (!inv || inv.email.toLowerCase() !== email.toLowerCase()) return null;
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, inv.orgId)).limit(1);
  if (!org) return null;
  const max = PLANS[org.plan].maxSeats;
  if (max >= 0 && (await seatCount(org.id)) >= max) return null;
  await db.insert(schema.memberships).values({ userId, orgId: inv.orgId, role: inv.role }).onConflictDoNothing();
  await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, inv.id));
  await audit(inv.orgId, userId, "member.joined", email);
  return inv.orgId;
}
