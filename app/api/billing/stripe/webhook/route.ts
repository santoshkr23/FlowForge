import { NextResponse } from "next/server";
import { stripe, handleStripeEvent } from "@/lib/billing/stripe";

/** Stripe → Developers → Webhooks → endpoint: {APP_URL}/api/billing/stripe/webhook */
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig ?? "", process.env.STRIPE_WEBHOOK_SECRET ?? "");
  } catch (e) {
    return NextResponse.json({ error: `Invalid signature: ${(e as Error).message}` }, { status: 400 });
  }
  try {
    await handleStripeEvent(event);
  } catch (e) {
    console.error("stripe webhook", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
