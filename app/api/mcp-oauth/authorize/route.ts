import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCtx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { siteUrl } from "@/lib/oauth/providers";
import { createCode } from "@/lib/mcp-oauth";
import { checkAuthorize, errorRedirect, pick } from "@/lib/mcp-authorize";

/** The consent form posts here: issue a code and send the browser back to the app. */
export async function POST(req: Request) {
  const site = siteUrl(req);
  // CSRF: only our own consent page may post here
  const origin = req.headers.get("origin");
  if (origin && origin !== site && origin !== new URL(req.url).origin) return new NextResponse("Forbidden", { status: 403 });

  const form = await req.formData();
  const ctx = await getCtx();
  const p = pick(form);
  if (!ctx) return NextResponse.redirect(`${site}/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(p as Record<string, string>).toString()}`)}`, 303);

  const c = await checkAuthorize(p);
  if (!c.ok) return "redirect" in c ? NextResponse.redirect(c.redirect, 303) : new NextResponse(c.show, { status: 400 });

  if (form.get("decision") !== "allow") return NextResponse.redirect(errorRedirect(p.redirect_uri, "access_denied", "You cancelled the connection", p.state), 303);

  const orgId = String(form.get("org") ?? ctx.org.id);
  const [m] = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id))).limit(1);
  if (!m) return new NextResponse("You're not a member of that workspace", { status: 403 });

  const code = await createCode({ client: c.client, userId: ctx.user.id, orgId, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge, scope: c.scope, resource: p.resource });
  const back = new URL(p.redirect_uri);
  back.searchParams.set("code", code);
  if (p.state) back.searchParams.set("state", p.state);
  back.searchParams.set("iss", site);
  return NextResponse.redirect(back.toString(), 303);
}
