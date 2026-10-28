import { z } from "zod";
import { body, json, withAuth } from "@/lib/http";
import { stripeCheckout, stripeCreditPack, stripePortal } from "@/lib/billing/stripe";

/** POST { action: "subscribe", plan } | { action: "credits" } | { action: "portal" } → { url } */
export const POST = withAuth("OWNER", async (ctx, req) => {
  const b = await body(
    req,
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("subscribe"), plan: z.enum(["STARTER", "PRO", "TEAMS"]) }),
      z.object({ action: z.literal("credits") }),
      z.object({ action: z.literal("portal") }),
    ]),
  );
  const url =
    b.action === "subscribe" ? await stripeCheckout(ctx.org, ctx.user.email, b.plan) : b.action === "credits" ? await stripeCreditPack(ctx.org, ctx.user.email) : await stripePortal(ctx.org);
  return json({ url });
});
