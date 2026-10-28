"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PLANS, PAID_PLANS, CREDIT_PACK } from "@/lib/plans";
import { api } from "@/lib/client";
import type { PlanId } from "@/db/schema";

type Props = {
  org: {
    plan: PlanId;
    provider: string;
    subStatus: string | null;
    periodEnd: string | null;
    creditsLeft: number;
    creditsMonthly: number;
    creditsUsed: number;
    extraCredits: number;
    resetsAt: string;
  };
  isOwner: boolean;
  providers: { stripe: boolean; razorpay: boolean };
  payments: { id: string; at: string; amount: number; currency: string; description: string | null; provider: string }[];
  flash?: string;
  suggestedPlan?: string;
};

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: unknown) => void) => void };
  }
}

function loadRazorpay() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Razorpay checkout. Check your connection and try again."));
    document.body.appendChild(s);
  });
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(currency.toUpperCase() === "INR" ? "en-IN" : "en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);

export function Billing({ org, isOwner, providers, payments, flash, suggestedPlan }: Props) {
  const router = useRouter();
  const [currency, setCurrency] = useState<"INR" | "USD">(providers.razorpay || !providers.stripe ? "INR" : "USD");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(flash ? { ok: true, text: flash } : null);
  const usesRazorpay = currency === "INR";
  const providerReady = usesRazorpay ? providers.razorpay : providers.stripe;

  async function razorpayCheckout(kind: "subscribe" | "credits", plan?: PlanId) {
    await loadRazorpay();
    const r = await api<{ keyId: string; subscriptionId?: string; orderId?: string; amount: number; email: string; name: string | null; planName?: string }>("/api/billing/razorpay", {
      body: kind === "subscribe" ? { action: "subscribe", plan } : { action: "credits" },
    });
    await new Promise<void>((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: r.keyId,
        ...(r.subscriptionId ? { subscription_id: r.subscriptionId } : { order_id: r.orderId, amount: r.amount, currency: "INR" }),
        name: "FlowForge",
        description: kind === "subscribe" ? `${r.planName} plan` : `${CREDIT_PACK.credits.toLocaleString()} extra credits`,
        prefill: { email: r.email, name: r.name ?? undefined },
        theme: { color: "#2B59C3" },
        handler: async (resp: { razorpay_payment_id: string; razorpay_signature: string; razorpay_subscription_id?: string; razorpay_order_id?: string }) => {
          try {
            await api("/api/billing/razorpay", {
              body: { action: "verify", paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature, subscriptionId: resp.razorpay_subscription_id, orderId: resp.razorpay_order_id },
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        modal: { ondismiss: () => reject(new Error("Checkout closed. Nothing was charged.")) },
      });
      rzp.on("payment.failed", () => reject(new Error("Payment failed. Try another method.")));
      rzp.open();
    });
  }

  async function act(key: string, fn: () => Promise<void>, okText?: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ ok: true, text: okText });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  const subscribe = (plan: PlanId) =>
    act(
      plan,
      async () => {
        if (usesRazorpay) await razorpayCheckout("subscribe", plan);
        else window.location.href = (await api<{ url: string }>("/api/billing/stripe", { body: { action: "subscribe", plan } })).url;
      },
      usesRazorpay ? `You're on ${PLANS[plan].name}. Enjoy!` : undefined,
    );

  const buyCredits = () =>
    act(
      "credits",
      async () => {
        if (usesRazorpay) await razorpayCheckout("credits");
        else window.location.href = (await api<{ url: string }>("/api/billing/stripe", { body: { action: "credits" } })).url;
      },
      usesRazorpay ? `${CREDIT_PACK.credits.toLocaleString()} credits added.` : undefined,
    );

  const manage = () =>
    act(
      "manage",
      async () => {
        if (org.provider === "STRIPE") window.location.href = (await api<{ url: string }>("/api/billing/stripe", { body: { action: "portal" } })).url;
        else if (org.provider === "RAZORPAY") {
          if (!confirm("Cancel your plan? You keep it until the end of this billing period.")) return;
          await api("/api/billing/razorpay", { body: { action: "cancel" } });
        }
      },
      org.provider === "RAZORPAY" ? "Your plan will end at the close of this billing period." : undefined,
    );

  const usedPct = org.creditsMonthly ? Math.min(100, Math.round((org.creditsUsed / org.creditsMonthly) * 100)) : 0;
  const price = (p: PlanId) => (usesRazorpay ? `₹${PLANS[p].inr.toLocaleString("en-IN")}` : `$${PLANS[p].usd}`);

  return (
    <div className="space-y-8">
      {msg && (
        <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-ok-tint text-ok" : "bg-bad-tint text-bad"}`}>
          {msg.text}
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="panel p-5">
          <h2 className="text-lg">Current plan</h2>
          <p className="mt-2 font-display text-3xl font-bold">{PLANS[org.plan].name}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {org.plan === "FREE"
              ? "Free forever."
              : org.subStatus === "cancel_at_period_end"
                ? `Ends ${org.periodEnd ? new Date(org.periodEnd).toLocaleDateString("en-IN") : "at period end"}.`
                : org.periodEnd
                  ? `Renews ${new Date(org.periodEnd).toLocaleDateString("en-IN")} via ${org.provider === "RAZORPAY" ? "Razorpay" : org.provider === "STRIPE" ? "Stripe" : "invoice"}.`
                  : "Active."}
          </p>
          {isOwner && (org.provider === "STRIPE" || (org.provider === "RAZORPAY" && org.subStatus !== "cancel_at_period_end")) && (
            <button className="btn-quiet mt-4" onClick={manage} disabled={!!busy}>
              {org.provider === "STRIPE" ? "Manage subscription" : busy === "manage" ? "Canceling…" : "Cancel plan"}
            </button>
          )}
        </div>
        <div className="panel p-5">
          <h2 className="text-lg">Credits</h2>
          <p className="mt-2 font-display text-3xl font-bold">{org.creditsLeft.toLocaleString()} left</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly credits used">
            <div className={`h-full ${usedPct > 85 ? "bg-bad" : "bg-wire"}`} style={{ width: `${usedPct}%` }} />
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            {org.creditsUsed.toLocaleString()} of {org.creditsMonthly.toLocaleString()} monthly credits used · refills {new Date(org.resetsAt).toLocaleDateString("en-IN")}
            {org.extraCredits > 0 && ` · plus ${org.extraCredits.toLocaleString()} extra`}
          </p>
          {isOwner && (
            <button className="btn-quiet mt-4" onClick={buyCredits} disabled={!!busy || !providerReady}>
              {busy === "credits" ? "Opening checkout…" : `Buy ${CREDIT_PACK.credits.toLocaleString()} credits for ${usesRazorpay ? `₹${CREDIT_PACK.inr}` : `$${CREDIT_PACK.usd}`}`}
            </button>
          )}
        </div>
      </section>

      {isOwner && (
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl">Change plan</h2>
            <div className="inline-flex rounded-lg border border-line bg-paper p-1" role="radiogroup" aria-label="Pay in">
              {(["INR", "USD"] as const).map((c) => (
                <button key={c} role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)} className={`rounded-md px-3 py-1 text-sm ${currency === c ? "bg-ink text-white" : "text-ink-soft"}`}>
                  {c === "INR" ? "₹ UPI / card (Razorpay)" : "$ Card (Stripe)"}
                </button>
              ))}
            </div>
          </div>
          {!providerReady && (
            <p className="mb-4 rounded-lg bg-spark-tint p-3 text-sm">
              {usesRazorpay ? "Razorpay" : "Stripe"} isn't configured on this server yet. Add its keys to the environment (see the README) to take payments.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {PAID_PLANS.map((p) => {
              const current = org.plan === p;
              return (
                <div key={p} className={`panel flex flex-col p-5 ${suggestedPlan === p ? "border-wire ring-2 ring-wire/15" : ""}`}>
                  <h3 className="text-lg">{PLANS[p].name}</h3>
                  <p className="font-display text-2xl font-bold">
                    {price(p)}
                    <span className="font-sans text-sm font-normal text-ink-soft"> / month</span>
                  </p>
                  <ul className="mt-3 flex-1 space-y-1 text-sm text-ink-soft">
                    {PLANS[p].features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button className={current ? "btn-quiet mt-4" : "btn-primary mt-4"} disabled={current || !!busy || !providerReady || (org.provider !== "NONE" && org.provider !== "MANUAL" && org.plan !== "FREE")} onClick={() => subscribe(p)}>
                    {current ? "Your plan" : busy === p ? "Opening checkout…" : `Switch to ${PLANS[p].name}`}
                  </button>
                </div>
              );
            })}
          </div>
          {org.provider !== "NONE" && org.provider !== "MANUAL" && org.plan !== "FREE" && (
            <p className="mt-3 text-sm text-ink-soft">To move to a different paid plan, {org.provider === "STRIPE" ? "use Manage subscription" : "cancel this one first, then choose the new plan"}.</p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xl">Payments</h2>
        {payments.length === 0 ? (
          <p className="panel p-6 text-ink-soft">No payments yet.</p>
        ) : (
          <ul className="panel divide-y divide-line text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-5 py-3">
                <span className="w-28 text-ink-soft">{new Date(p.at).toLocaleDateString("en-IN")}</span>
                <span className="flex-1">{p.description}</span>
                <span className="text-ink-soft">{p.provider === "RAZORPAY" ? "Razorpay" : "Stripe"}</span>
                <span className="w-24 text-right font-medium">{money(p.amount, p.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
