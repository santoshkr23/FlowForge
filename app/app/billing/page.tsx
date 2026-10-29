import { desc, eq } from "drizzle-orm";
import { requireCtx, hasRole } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead } from "@/components/app/PageHead";
import { Billing } from "@/components/app/Billing";
import { creditsRemaining } from "@/lib/credits";
import { stripeEnabled } from "@/lib/billing/stripe";
import { razorpayEnabled } from "@/lib/billing/razorpay";

export const metadata = { title: "Billing" };

export default async function BillingPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  const payments = await db.select().from(schema.payments).where(eq(schema.payments.orgId, ctx.org.id)).orderBy(desc(schema.payments.createdAt)).limit(24);
  const o = ctx.org;
  return (
    <>
      <PageHead title="Billing" sub="Your plan, credits and payments." />
      <Body>
        <Billing
          org={{
            plan: o.plan,
            provider: o.billingProvider,
            subStatus: o.subStatus,
            periodEnd: o.currentPeriodEnd?.toISOString() ?? null,
            creditsLeft: creditsRemaining(o),
            creditsMonthly: o.creditsMonthly,
            creditsUsed: o.creditsUsed,
            extraCredits: o.extraCredits,
            resetsAt: new Date(o.creditsResetAt.getTime() + 30 * 86400_000).toISOString(),
          }}
          isOwner={hasRole(ctx.role, "OWNER")}
          providers={{ stripe: stripeEnabled(), razorpay: razorpayEnabled() }}
          payments={payments.map((p) => ({ id: p.id, at: p.createdAt.toISOString(), amount: p.amount, currency: p.currency, description: p.description, provider: p.provider }))}
          flash={searchParams.success ? "Thanks! Your plan is being activated — refresh in a few seconds." : searchParams.credits ? "Credits added." : searchParams.canceled ? "Checkout canceled. Nothing was charged." : undefined}
          suggestedPlan={searchParams.plan}
        />
      </Body>
    </>
  );
}
