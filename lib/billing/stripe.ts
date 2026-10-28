import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { applyPlan, addExtraCredits } from "../credits";
import { CREDIT_PACK } from "../plans";
import type { Org, PlanId } from "@/db/schema";

let client: Stripe | null = null;
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY));
}
export const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;

const PRICE_ENV: Partial<Record<PlanId, string>> = {
  STARTER: "STRIPE_PRICE_STARTER",
  PRO: "STRIPE_PRICE_PRO",
  TEAMS: "STRIPE_PRICE_TEAMS",
};

function priceFor(plan: PlanId) {
  const key = PRICE_ENV[plan];
  const id = key && process.env[key];
  if (!id) throw new Error(`No Stripe price configured for ${plan}`);
  return id;
}

function planForPrice(priceId: string): PlanId | null {
  for (const [plan, key] of Object.entries(PRICE_ENV)) if (process.env[key!] === priceId) return plan as PlanId;
  return null;
}

async function ensureCustomer(org: Org, email: string) {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const c = await stripe().customers.create({ email, name: org.name, metadata: { orgId: org.id } });
  await db.update(schema.orgs).set({ stripeCustomerId: c.id }).where(eq(schema.orgs.id, org.id));
  return c.id;
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

export async function stripeCheckout(org: Org, email: string, plan: PlanId) {
  const customer = await ensureCustomer(org, email);
  const s = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceFor(plan), quantity: 1 }],
    subscription_data: { metadata: { orgId: org.id, plan } },
    metadata: { orgId: org.id, plan, kind: "subscription" },
    allow_promotion_codes: true,
    success_url: `${appUrl()}/app/billing?success=1`,
    cancel_url: `${appUrl()}/app/billing?canceled=1`,
  });
  return s.url!;
}

export async function stripeCreditPack(org: Org, email: string) {
  const customer = await ensureCustomer(org, email);
  const price = process.env.STRIPE_PRICE_CREDITS_10K;
  const s = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: price
      ? [{ price, quantity: 1 }]
      : [{ price_data: { currency: "usd", unit_amount: CREDIT_PACK.usd * 100, product_data: { name: `${CREDIT_PACK.credits.toLocaleString()} extra credits` } }, quantity: 1 }],
    metadata: { orgId: org.id, kind: "credits", credits: String(CREDIT_PACK.credits) },
    success_url: `${appUrl()}/app/billing?credits=1`,
    cancel_url: `${appUrl()}/app/billing`,
  });
  return s.url!;
}

export async function stripePortal(org: Org) {
  if (!org.stripeCustomerId) throw new Error("No Stripe customer yet");
  const s = await stripe().billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: `${appUrl()}/app/billing` });
  return s.url;
}

async function orgBy(field: "stripeSubId" | "stripeCustomerId" | "id", value: string) {
  const [o] = await db.select().from(schema.orgs).where(eq(schema.orgs[field], value)).limit(1);
  return o;
}

async function syncSubscription(sub: Stripe.Subscription) {
  const org = (sub.metadata?.orgId && (await orgBy("id", sub.metadata.orgId))) || (await orgBy("stripeSubId", sub.id));
  if (!org) return;
  const active = ["active", "trialing", "past_due"].includes(sub.status);
  const plan = planForPrice(sub.items.data[0]?.price.id ?? "") ?? (sub.metadata?.plan as PlanId) ?? "STARTER";
  await applyPlan(org.id, active ? plan : "FREE", {
    billingProvider: active ? "STRIPE" : "NONE",
    stripeSubId: active ? sub.id : null,
    subStatus: sub.status,
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
  });
}

/** Handles a verified Stripe event. Idempotent. */
export async function handleStripeEvent(event: Stripe.Event) {
  const inserted = await db.insert(schema.webhookEvents).values({ id: event.id, provider: "stripe" }).onConflictDoNothing().returning();
  if (!inserted.length) return; // already processed

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const orgId = s.metadata?.orgId;
      if (!orgId) return;
      if (s.metadata?.kind === "credits" && s.payment_status === "paid") {
        await addExtraCredits(orgId, Number(s.metadata.credits) || CREDIT_PACK.credits);
        await db
          .insert(schema.payments)
          .values({ orgId, provider: "STRIPE", externalId: s.id, amount: s.amount_total ?? 0, currency: s.currency ?? "usd", description: "Credit pack" })
          .onConflictDoNothing();
      }
      if (s.mode === "subscription" && s.subscription) {
        const sub = await stripe().subscriptions.retrieve(String(s.subscription));
        await syncSubscription(sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      const org = inv.customer ? await orgBy("stripeCustomerId", String(inv.customer)) : undefined;
      if (!org) return;
      // new billing period → fresh monthly credits
      if (inv.billing_reason === "subscription_cycle" || inv.billing_reason === "subscription_create") {
        await db.update(schema.orgs).set({ creditsUsed: 0, creditsResetAt: new Date() }).where(eq(schema.orgs.id, org.id));
      }
      await db
        .insert(schema.payments)
        .values({ orgId: org.id, provider: "STRIPE", externalId: inv.id, amount: inv.amount_paid, currency: inv.currency, description: "Subscription" })
        .onConflictDoNothing();
      break;
    }
  }
}
