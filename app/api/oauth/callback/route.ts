import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { db, schema } from "@/lib/db";
import { encryptJson } from "@/lib/crypto";
import { exchangeCode } from "@/lib/oauth/tokens";
import { siteUrl } from "@/lib/oauth/providers";
import { audit } from "@/lib/audit";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me-dev-secret-change-me");

type Pending = { state: string; verifier?: string; redirect?: string; app: string; provider: string; orgId: string; userId: string; name: string };

/** Providers redirect here after the user approves (or cancels). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const done = (q: string) => {
    const res = NextResponse.redirect(`${siteUrl(req)}/app/connections?${q}`);
    res.cookies.delete({ name: "ff_oauth", path: "/api/oauth" });
    return res;
  };
  // If the app (LinkedIn, Google…) refused, show its reason — that's what the user needs to fix.
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) return done("error=" + encodeURIComponent(`The app refused the connection: ${providerError.replace(/\+/g, " ")}`));
  const raw = (await cookies()).get("ff_oauth")?.value;
  if (!raw) return done("error=" + encodeURIComponent("This sign-in link was already used or has expired. Click Connect again."));
  let p: Pending;
  try {
    p = (await jwtVerify(raw, secret())).payload as unknown as Pending;
  } catch {
    return done("error=" + encodeURIComponent("Sign-in took too long. Please try again."));
  }
  if (url.searchParams.get("state") !== p.state) return done("error=" + encodeURIComponent("Sign-in couldn't be verified. Please try again."));
  const code = url.searchParams.get("code");
  if (!code) return done("error=" + encodeURIComponent("The app didn't send a sign-in code."));

  try {
    const s = await exchangeCode(p.provider, code, p.verifier, p.redirect);
    const name = s.account ? `${p.name} (${s.account})` : p.name;
    const [c] = await db.insert(schema.connections).values({ orgId: p.orgId, app: p.app, name, secret: encryptJson(s) }).returning();
    await audit(p.orgId, p.userId, "connection.created", c.id, { app: p.app, name });
    return done(`connected=${encodeURIComponent(name)}`);
  } catch (e) {
    return done("error=" + encodeURIComponent((e as Error).message));
  }
}
