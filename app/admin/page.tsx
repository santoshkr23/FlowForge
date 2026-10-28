import Link from "next/link";
import { notFound } from "next/navigation";
import { count, desc, gte, sql, sum } from "drizzle-orm";
import { requireCtx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { AdminOrgRow, AdminUserRow } from "@/components/app/AdminRows";
import { PLANS } from "@/lib/plans";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function Admin() {
  const ctx = await requireCtx();
  if (!ctx.isSuperAdmin) notFound();
  const since = new Date(Date.now() - 30 * 86400_000);

  const [orgs, users, [rev], [runs], byPlan] = await Promise.all([
    db
      .select({
        id: schema.orgs.id,
        name: schema.orgs.name,
        plan: schema.orgs.plan,
        provider: schema.orgs.billingProvider,
        creditsUsed: schema.orgs.creditsUsed,
        creditsMonthly: schema.orgs.creditsMonthly,
        extra: schema.orgs.extraCredits,
        createdAt: schema.orgs.createdAt,
        workflows: sql<number>`(select count(*) from workflows w where w.org_id = ${schema.orgs.id})`.mapWith(Number),
      })
      .from(schema.orgs)
      .orderBy(desc(schema.orgs.createdAt))
      .limit(200),
    db.select().from(schema.users).orderBy(desc(schema.users.createdAt)).limit(200),
    db
      .select({ inr: sql<number>`coalesce(sum(case when upper(${schema.payments.currency})='INR' then ${schema.payments.amount} end),0)`.mapWith(Number), usd: sql<number>`coalesce(sum(case when upper(${schema.payments.currency})='USD' then ${schema.payments.amount} end),0)`.mapWith(Number) })
      .from(schema.payments)
      .where(gte(schema.payments.createdAt, since)),
    db.select({ n: count(), credits: sum(schema.executions.creditsUsed) }).from(schema.executions).where(gte(schema.executions.startedAt, since)),
    db.select({ plan: schema.orgs.plan, n: count() }).from(schema.orgs).groupBy(schema.orgs.plan),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Platform admin</h1>
        <Link href="/app" className="btn-quiet">
          Back to app
        </Link>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Revenue, 30 days (₹)", `₹${(rev.inr / 100).toLocaleString("en-IN")}`],
          ["Revenue, 30 days ($)", `$${(rev.usd / 100).toLocaleString()}`],
          ["Runs, 30 days", runs.n.toLocaleString()],
          ["Workspaces", byPlan.map((p) => `${p.n} ${PLANS[p.plan].name}`).join(", ") || "0"],
        ].map(([k, v]) => (
          <div key={k} className="panel p-5">
            <dt className="text-sm text-ink-soft">{k}</dt>
            <dd className="mt-1 font-display text-xl font-bold">{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mb-3 mt-10 text-xl">Workspaces</h2>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="text-left text-ink-soft">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 font-medium">Credits used</th>
              <th className="px-4 py-2 font-medium">Workflows</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orgs.map((o) => (
              <AdminOrgRow key={o.id} org={{ ...o, createdAt: o.createdAt.toISOString() }} />
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-10 text-xl">Users</h2>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <tbody className="divide-y divide-line">
            {users.map((u) => (
              <AdminUserRow key={u.id} user={{ id: u.id, email: u.email, name: u.name, disabled: u.disabled, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }} self={u.id === ctx.user.id} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

