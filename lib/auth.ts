import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import type { Org, Role, User } from "@/db/schema";

const COOKIE = "ff_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me-dev-secret-change-me");

export type SessionPayload = { uid: string; oid: string };

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function signSession(p: SessionPayload) {
  return new SignJWT(p).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(secret());
}

export async function createSession(p: SessionPayload) {
  cookies().set(COOKIE, await signSession(p), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function destroySession() {
  cookies().delete(COOKIE);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return { uid: String(payload.uid), oid: String(payload.oid) };
  } catch {
    return null;
  }
}

export async function readSession() {
  const token = cookies().get(COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export type Ctx = { user: User; org: Org; role: Role; isSuperAdmin: boolean };

export async function loadCtx(s: SessionPayload): Promise<Ctx | null> {
  const rows = await db
    .select({ m: schema.memberships, u: schema.users, o: schema.orgs })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.memberships.orgId))
    .where(and(eq(schema.memberships.userId, s.uid), eq(schema.memberships.orgId, s.oid)))
    .limit(1);
  const r = rows[0];
  if (!r || r.u.disabled) return null;
  return { user: r.u, org: r.o, role: r.m.role, isSuperAdmin: isSuperAdmin(r.u.email) };
}

/** For API routes: returns ctx or null. */
export async function getCtx() {
  const s = await readSession();
  return s ? loadCtx(s) : null;
}

/** For server pages: redirects to /login when not signed in. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

export function isSuperAdmin(email: string) {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

const RANK: Record<Role, number> = { VIEWER: 0, BUILDER: 1, ADMIN: 2, OWNER: 3 };
export const hasRole = (role: Role, min: Role) => RANK[role] >= RANK[min];

/** Creates a user with their own personal workspace. Returns ids. */
export async function registerUser(email: string, password: string, name?: string) {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({ email: email.toLowerCase(), name, passwordHash }).returning();
    const [org] = await tx
      .insert(schema.orgs)
      .values({ name: name ? `${name.split(" ")[0]}'s workspace` : "My workspace" })
      .returning();
    await tx.insert(schema.memberships).values({ userId: user.id, orgId: org.id, role: "OWNER" });
    return { user, org };
  });
}
