import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { applyPlan, addExtraCredits } from "@/lib/credits";
import { body, err, handleError, json } from "@/lib/http";

/** Super-admin actions (ADMIN_EMAILS). */
export async function POST(req: Request) {
  try {
    const ctx = await getCtx();
    if (!ctx?.isSuperAdmin) return err("Forbidden", 403);
    const b = await body(
      req,
      z.discriminatedUnion("action", [
        z.object({ action: z.literal("setPlan"), orgId: z.string(), plan: z.enum(["FREE", "STARTER", "PRO", "TEAMS", "ENTERPRISE"]) }),
        z.object({ action: z.literal("addCredits"), orgId: z.string(), credits: z.number().int().min(1).max(10_000_000) }),
        z.object({ action: z.literal("setDisabled"), userId: z.string(), disabled: z.boolean() }),
      ]),
    );
    if (b.action === "setPlan") await applyPlan(b.orgId, b.plan, { billingProvider: b.plan === "FREE" ? "NONE" : "MANUAL" });
    if (b.action === "addCredits") await addExtraCredits(b.orgId, b.credits);
    if (b.action === "setDisabled") {
      if (b.userId === ctx.user.id) return err("You can't disable yourself", 400);
      await db.update(schema.users).set({ disabled: b.disabled }).where(eq(schema.users.id, b.userId));
    }
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
