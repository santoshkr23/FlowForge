import { z } from "zod";
import { body, json, withAuth } from "@/lib/http";
import { setActive } from "@/lib/workflows";
import { audit } from "@/lib/audit";

export const POST = withAuth("BUILDER", async (ctx, req, { params }) => {
  const { active } = await body(req, z.object({ active: z.boolean() }));
  const wf = await setActive(ctx.org, params.id, active);
  await audit(ctx.org.id, ctx.user.id, active ? "workflow.activated" : "workflow.deactivated", wf.id, { name: wf.name });
  return json({ active: wf.active, nextRunAt: wf.nextRunAt });
});
