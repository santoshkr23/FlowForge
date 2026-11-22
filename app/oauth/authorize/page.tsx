import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getCtx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Logo } from "@/components/Logo";
import { checkAuthorize, pick } from "@/lib/mcp-authorize";

export const metadata = { title: "Connect an app to FlowForge" };
export const dynamic = "force-dynamic";

/** OAuth consent screen for MCP clients (Claude, ChatGPT…). */
export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") sp.set(k, v);
  const ctx = await getCtx();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${sp.toString()}`)}`);

  const c = await checkAuthorize(pick(sp));
  if (!c.ok && "redirect" in c) redirect(c.redirect);

  const workspaces = await db
    .select({ id: schema.orgs.id, name: schema.orgs.name, plan: schema.orgs.plan })
    .from(schema.memberships)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, ctx.user.id));

  return (
    <main className="grid-bg flex min-h-screen flex-col items-center justify-center gap-8 px-5 py-10">
      <Logo />
      <div className="panel w-full max-w-md space-y-5 p-6">
        {!c.ok ? (
          <>
            <h1 className="text-xl font-bold">Can't connect this app</h1>
            <p className="text-sm text-bad">{"show" in c ? c.show : "Something went wrong."}</p>
          </>
        ) : (
          <form method="post" action="/api/mcp-oauth/authorize" className="space-y-5">
            <div>
              <h1 className="text-xl font-bold">
                Allow <span className="text-wire">{c.client.name}</span> to use FlowForge?
              </h1>
              <p className="mt-1 text-sm text-ink-soft">
                Signed in as {ctx.user.email}. It will return to <b className="font-medium text-ink">{new URL(c.p.redirect_uri).host}</b>.
              </p>
            </div>
            <ul className="space-y-1.5 rounded-lg bg-canvas p-3 text-sm">
              <li>✓ See and run your workflows, and read their results</li>
              <li>✓ See your connected social accounts</li>
              <li>✓ Create, schedule and publish social posts for you</li>
            </ul>
            {workspaces.length > 1 ? (
              <div>
                <label className="label" htmlFor="org">
                  Workspace
                </label>
                <select id="org" name="org" className="input" defaultValue={ctx.org.id}>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input type="hidden" name="org" value={ctx.org.id} />
            )}
            {Object.entries(c.p).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            {/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.p.redirect_uri) && (
              <p className="rounded-lg bg-spark-tint p-2 text-xs">This app runs on your own computer (for example Claude Code). Only allow it if you just started connecting it.</p>
            )}
            <div className="flex gap-2">
              <button name="decision" value="allow" className="btn-primary flex-1">
                Allow
              </button>
              <button name="decision" value="deny" className="btn-quiet flex-1">
                Cancel
              </button>
            </div>
            <p className="text-xs text-ink-faint">You can disconnect it any time under API &amp; MCP.</p>
          </form>
        )}
      </div>
    </main>
  );
}
