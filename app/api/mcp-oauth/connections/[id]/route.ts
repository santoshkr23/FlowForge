import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { err, json, withAuth } from "@/lib/http";
import { audit } from "@/lib/audit";

/** Disconnect an AI app (Claude, ChatGPT…) from this workspace. */
export const DELETE = withAuth("ADMIN", async (ctx, _req, { params }) => {
  const r = await db.delete(schema.mcpTokens).where(and(eq(schema.mcpTokens.id, params.id), eq(schema.mcpTokens.orgId, ctx.org.id))).returning({ id: schema.mcpTokens.id, name: schema.mcpTokens.clientName });
  if (!r.length) return err("Not found", 404);
  await audit(ctx.org.id, ctx.user.id, "mcp.disconnected", r[0].id, { app: r[0].name });
  return json({ ok: true });
});
