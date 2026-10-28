import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { PLANS } from "./plans";
import type { Org, PlanId } from "@/db/schema";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Monthly reset: if 30 days passed since last reset, zero usage. Paid plans also reset on renewal webhooks. */
export async function ensureCreditWindow(org: Org): Promise<Org> {
  if (Date.now() - org.creditsResetAt.getTime() < MONTH_MS) return org;
  const [o] = await db
    .update(schema.orgs)
    .set({ creditsUsed: 0, creditsResetAt: new Date() })
    .where(eq(schema.orgs.id, org.id))
    .returning();
  return o;
}

export function creditsRemaining(org: Pick<Org, "creditsMonthly" | "creditsUsed" | "extraCredits">) {
  return Math.max(0, org.creditsMonthly - org.creditsUsed) + org.extraCredits;
}

/**
 * Charge credits atomically in a single UPDATE. Monthly allowance first, then purchased extra credits.
 * Returns false when the org can't afford it (nothing is charged).
 */
export async function chargeCredits(orgId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return true;
  const o = schema.orgs;
  const monthlyLeft = sql`GREATEST(0, ${o.creditsMonthly} - ${o.creditsUsed})`;
  const fromMonthly = sql`LEAST(${monthlyLeft}, ${amount})`;
  const rows = await db
    .update(o)
    .set({
      creditsUsed: sql`${o.creditsUsed} + ${fromMonthly}`,
      extraCredits: sql`${o.extraCredits} - (${amount} - ${fromMonthly})`,
    })
    .where(sql`${o.id} = ${orgId} AND ${monthlyLeft} + ${o.extraCredits} >= ${amount}`)
    .returning({ id: o.id });
  return rows.length > 0;
}

export async function applyPlan(orgId: string, plan: PlanId, extra: Partial<Org> = {}) {
  const [o] = await db
    .update(schema.orgs)
    .set({ plan, creditsMonthly: PLANS[plan].credits, ...extra })
    .where(eq(schema.orgs.id, orgId))
    .returning();
  return o;
}

export async function addExtraCredits(orgId: string, amount: number) {
  await db
    .update(schema.orgs)
    .set({ extraCredits: sql`${schema.orgs.extraCredits} + ${amount}` })
    .where(eq(schema.orgs.id, orgId));
}
