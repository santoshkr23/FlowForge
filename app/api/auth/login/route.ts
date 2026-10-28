import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { body, err, handleError, json } from "@/lib/http";
import { acceptInvite } from "@/lib/team";

const Body = z.object({ email: z.string().trim().email(), password: z.string().min(1), invite: z.string().optional() });

// naive in-memory throttle; put a real rate limiter (e.g. Upstash) in front for production
const attempts = new Map<string, { n: number; t: number }>();

export async function POST(req: Request) {
  try {
    const b = await body(req, Body);
    const key = b.email.toLowerCase();
    const a = attempts.get(key);
    if (a && a.n >= 8 && Date.now() - a.t < 15 * 60_000) return err("Too many attempts. Try again in 15 minutes.", 429);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, key)).limit(1);
    if (!user || user.disabled || !(await verifyPassword(b.password, user.passwordHash))) {
      attempts.set(key, { n: (a?.n ?? 0) + 1, t: Date.now() });
      return err("Wrong email or password", 401);
    }
    attempts.delete(key);
    let orgId: string | null = null;
    if (b.invite) orgId = await acceptInvite(b.invite, user.id, user.email);
    if (!orgId) {
      const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).orderBy(asc(schema.memberships.createdAt)).limit(1);
      if (!m) return err("Your account has no workspace", 403);
      orgId = m.orgId;
    }
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    await createSession({ uid: user.id, oid: orgId });
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
