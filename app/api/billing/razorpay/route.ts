import { z } from "zod";
import { body, err, json, withAuth } from "@/lib/http";
import {
  activateRazorpaySubscription,
  cancelRazorpaySubscription,
  grantCreditPack,
  razorpayCreateCreditOrder,
  razorpayCreateSubscription,
  verifyCheckoutSignature,
} from "@/lib/billing/razorpay";
import { CREDIT_PACK } from "@/lib/plans";

/**
 * POST { action: "subscribe", plan }            → { subscriptionId, keyId, … } for Razorpay Checkout
 * POST { action: "credits" }                    → { orderId, keyId, amount }
 * POST { action: "verify", paymentId, signature, subscriptionId? | orderId? }
 * POST { action: "cancel" }
 */
export const POST = withAuth("OWNER", async (ctx, req) => {
  const b = await body(
    req,
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("subscribe"), plan: z.enum(["STARTER", "PRO", "TEAMS"]) }),
      z.object({ action: z.literal("credits") }),
      z.object({ action: z.literal("verify"), paymentId: z.string(), signature: z.string(), subscriptionId: z.string().optional(), orderId: z.string().optional() }),
      z.object({ action: z.literal("cancel") }),
    ]),
  );
  switch (b.action) {
    case "subscribe":
      return json({ ...(await razorpayCreateSubscription(ctx.org, ctx.user.email, b.plan)), email: ctx.user.email, name: ctx.user.name });
    case "credits":
      return json({ ...(await razorpayCreateCreditOrder(ctx.org)), email: ctx.user.email, name: ctx.user.name });
    case "verify": {
      if (!verifyCheckoutSignature(b)) return err("Payment signature mismatch", 400);
      if (b.subscriptionId) await activateRazorpaySubscription(b.subscriptionId);
      else if (b.orderId) await grantCreditPack(ctx.org.id, b.paymentId, CREDIT_PACK.inr * 100, "INR");
      return json({ ok: true });
    }
    case "cancel":
      await cancelRazorpaySubscription(ctx.org);
      return json({ ok: true });
  }
});
