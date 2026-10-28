import { z } from "zod";
import { body, err, json, withAuth } from "@/lib/http";
import { createApiKey } from "@/lib/apikey";
import { planAllows } from "@/lib/plans";
import { audit } from "@/lib/audit";

export const POST = withAuth("ADMIN", async (ctx, req) => {
  if (!planAllows(ctx.org.plan, "PRO")) return err("API & MCP access needs the Pro plan or higher", 402);
  const { name } = await body(req, z.object({ name: z.string().trim().min(1).max(60) }));
  const { key, row } = await createApiKey(ctx.org.id, name);
  await audit(ctx.org.id, ctx.user.id, "apikey.created", row.id, { name });
  return json({ key, id: row.id }, 201);
});
