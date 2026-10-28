/**
 * Razorpay (India): UPI / cards / netbanking subscriptions in INR, via the REST API.
 * Flow: server creates a subscription → browser opens Razorpay Checkout → we verify the
 * signature on return AND via webhook (webhook is the source of truth).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { applyPlan, addExtraCredits } from "../credits";
import { CREDIT_PACK, PLANS } from "../plans";
import type { Org, PlanId } from "@/db/schema";

export const razorpayEnabled = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

const PLAN_ENV: Partial<Record<PlanId, string>> = {
  STARTER: "RAZORPAY_PLAN_STARTER",
  PRO: "RAZORPAY_PLAN_PRO",
  TEAMS: "RAZORPAY_PLAN_TEAMS",
};

async function rzp<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!razorpayEnabled()) throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Razorpay: ${data?.error?.description ?? res.statusText}`);
  return data as T;
}

function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
const hmac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

export async function razorpayCreateSubscription(org: Org, email: string, plan: PlanId) {
  const planId = PLAN_ENV[plan] && process.env[PLAN_ENV[plan]!];
  if (!planId) throw new Error(`No Razorpay plan configured for ${plan}`);
  const sub = await rzp<{ id: string; short_url: string }>("/subscriptions", {
    method: "POST",
    body: { plan_id: planId, total_count: 120, customer_notify: 1, notes: { orgId: org.id, plan, email } },
  });
  return { subscriptionId: sub.id, keyId: process.env.RAZORPAY_KEY_ID!, amount: PLANS[plan].inr * 100, planName: PLANS[plan].name };
}

export async function razorpayCreateCreditOrder(org: Org) {
  const order = await rzp<{ id: string; amount: number }>("/orders", {
    method: "POST",
    body: { amount: CREDIT_PACK.inr * 100, currency: "INR", receipt: `cr_${org.id}_${Date.now()}`.slice(0, 40), notes: { orgId: org.id, kind: "credits", credits: String(CREDIT_PACK.credits) } },
  });
  return { orderId: order.id, amount: order.amount, keyId: process.env.RAZORPAY_KEY_ID! };
}

/** Verify the checkout handler response (subscription or order). */
export function verifyCheckoutSignature(p: { paymentId: string; signature: string; subscriptionId?: string; orderId?: string }) {
  const payload = p.subscriptionId ? `${p.paymentId}|${p.subscriptionId}` : `${p.orderId}|${p.paymentId}`;
  return safeEqualHex(hmac(process.env.RAZORPAY_KEY_SECRET ?? "", payload), p.signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  return safeEqualHex(hmac(secret, rawBody), signature);
}

export async function activateRazorpaySubscription(subscriptionId: string) {
  const sub = await rzp<{ id: string; status: string; current_end?: number; notes?: { orgId?: string; plan?: PlanId } }>(`/subscriptions/${subscriptionId}`);
  const orgId = sub.notes?.orgId;
  const plan = sub.notes?.plan;
  if (!orgId || !plan || !PLANS[plan]) return;
  const active = ["active", "authenticated", "charged"].includes(sub.status);
  await applyPlan(orgId, active ? plan : "FREE", {
    billingProvider: active ? "RAZORPAY" : "NONE",
    razorpaySubId: active ? sub.id : null,
    subStatus: sub.status,
    currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
  });
}

export async function cancelRazorpaySubscription(org: Org) {
  if (!org.razorpaySubId) throw new Error("No Razorpay subscription");
  await rzp(`/subscriptions/${org.razorpaySubId}/cancel`, { method: "POST", body: { cancel_at_cycle_end: 1 } });
  await db.update(schema.orgs).set({ subStatus: "cancel_at_period_end" }).where(eq(schema.orgs.id, org.id));
}

type RzpEvent = {
  event: string;
  payload: {
    subscription?: { entity: { id: string; notes?: { orgId?: string } } };
    payment?: { entity: { id: string; amount: number; currency: string; order_id?: string; notes?: { orgId?: string; kind?: string; credits?: string } } };
  };
};

/** Handles a verified Razorpay webhook. Idempotent via payment ids / event ids. */
export async function handleRazorpayEvent(evt: RzpEvent, eventId: string) {
  if (eventId) {
    const inserted = await db.insert(schema.webhookEvents).values({ id: `rzp_${eventId}`, provider: "razorpay" }).onConflictDoNothing().returning();
    if (!inserted.length) return;
  }
  const sub = evt.payload.subscription?.entity;
  const pay = evt.payload.payment?.entity;

  switch (evt.event) {
    case "subscription.activated":
    case "subscription.authenticated":
    case "subscription.resumed":
    case "subscription.updated":
      if (sub) await activateRazorpaySubscription(sub.id);
      break;
    case "subscription.charged":
      if (sub) {
        await activateRazorpaySubscription(sub.id);
        const orgId = sub.notes?.orgId;
        if (orgId) {
          await db.update(schema.orgs).set({ creditsUsed: 0, creditsResetAt: new Date() }).where(eq(schema.orgs.id, orgId));
          if (pay)
            await db
              .insert(schema.payments)
              .values({ orgId, provider: "RAZORPAY", externalId: pay.id, amount: pay.amount, currency: pay.currency, description: "Subscription" })
              .onConflictDoNothing();
        }
      }
      break;
    case "subscription.cancelled":
    case "subscription.halted":
    case "subscription.completed":
      if (sub?.notes?.orgId) await applyPlan(sub.notes.orgId, "FREE", { billingProvider: "NONE", razorpaySubId: null, subStatus: evt.event.split(".")[1] });
      break;
    case "payment.captured":
      if (pay?.notes?.kind === "credits" && pay.notes.orgId) await grantCreditPack(pay.notes.orgId, pay.id, pay.amount, pay.currency, Number(pay.notes.credits));
      break;
  }
}

/** Grants a credit pack exactly once per payment id. */
export async function grantCreditPack(orgId: string, paymentId: string, amount: number, currency: string, credits = CREDIT_PACK.credits) {
  const inserted = await db
    .insert(schema.payments)
    .values({ orgId, provider: "RAZORPAY", externalId: paymentId, amount, currency, description: "Credit pack" })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) await addExtraCredits(orgId, credits || CREDIT_PACK.credits);
}
