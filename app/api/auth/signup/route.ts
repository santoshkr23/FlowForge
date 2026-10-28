import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSession, registerUser } from "@/lib/auth";
import { body, err, handleError, json } from "@/lib/http";
import { acceptInvite } from "@/lib/team";

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  invite: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const b = await body(req, Body);
    const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, b.email.toLowerCase())).limit(1);
    if (exists) return err("An account with this email already exists", 409);
    const { user, org } = await registerUser(b.email, b.password, b.name);
    let orgId = org.id;
    if (b.invite) orgId = (await acceptInvite(b.invite, user.id, user.email)) ?? org.id;
    await createSession({ uid: user.id, oid: orgId });
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
