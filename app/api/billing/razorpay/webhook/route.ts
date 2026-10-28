import { NextResponse } from "next/server";
import { handleRazorpayEvent, verifyWebhookSignature } from "@/lib/billing/razorpay";

/**
 * Razorpay Dashboard → Settings → Webhooks → {APP_URL}/api/billing/razorpay/webhook
 * Events: subscription.*, payment.captured
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature") ?? "")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    await handleRazorpayEvent(JSON.parse(raw), req.headers.get("x-razorpay-event-id") ?? "");
  } catch (e) {
    console.error("razorpay webhook", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
