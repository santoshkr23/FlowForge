import Link from "next/link";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { requireCtx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { creditsRemaining } from "@/lib/credits";
import { PLANS } from "@/lib/plans";
import { Body, PageHead, StatusPill } from "@/components/app/PageHead";
import { timeAgo, num } from "@/lib/format";

export default async function Overview() {
  const ctx = await requireCtx();
  const since = new Date(Date.now() - 7 * 86400_000);
  const e = schema.executions;
  const [[stats], [{ active }], recent, daily] = await Promise.all([
    db
      .select({
        runs: count(),
        failed: sql<number>`count(*) filter (where ${e.status} = 'ERROR')`.mapWith(Number),
        credits: sql<number>`coalesce(sum(${e.creditsUsed}),0)`.mapWith(Number),
      })
      .from(e)
      .where(and(eq(e.orgId, ctx.org.id), gte(e.startedAt, since))),
    db
      .select({ active: count() })
      .from(schema.workflows)
      .where(and(eq(schema.workflows.orgId, ctx.org.id), eq(schema.workflows.active, true))),
    db
      .select({ id: e.id, status: e.status, startedAt: e.startedAt, trigger: e.trigger, name: schema.workflows.name, error: e.error })
      .from(e)
      .innerJoin(schema.workflows, eq(schema.workflows.id, e.workflowId))
      .where(eq(e.orgId, ctx.org.id))
      .orderBy(desc(e.startedAt))
      .limit(8),
    db
      .select({ day: sql<string>`to_char(date_trunc('day', ${e.startedAt}), 'YYYY-MM-DD')`, runs: count() })
      .from(e)
      .where(and(eq(e.orgId, ctx.org.id), gte(e.startedAt, since)))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);

  const plan = PLANS[ctx.org.plan];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400_000).toISOString().slice(0, 10);
    return { d, runs: daily.find((x) => x.day === d)?.runs ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.runs));

  return (
    <>
      <PageHead title={`Hi ${ctx.user.name?.split(" ")[0] ?? "there"}`} sub="Here's what your workflows did this week.">
        <Link href="/app/workflows?new=1" className="btn-primary">
          New workflow
        </Link>
      </PageHead>
      <Body>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { k: "Runs, last 7 days", v: num(stats.runs) },
            { k: "Failed runs", v: num(stats.failed), bad: stats.failed > 0 },
            { k: "Active workflows", v: `${active}${plan.activeWorkflows >= 0 ? ` of ${plan.activeWorkflows}` : ""}` },
            { k: "Credits left this month", v: num(creditsRemaining(ctx.org)) },
          ].map((s) => (
            <div key={s.k} className="panel p-5">
              <dt className="text-sm text-ink-soft">{s.k}</dt>
              <dd className={`mt-1 font-display text-3xl font-bold ${s.bad ? "text-bad" : ""}`}>{s.v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <section className="panel p-5">
            <h2 className="text-lg">Runs per day</h2>
            <div className="mt-6 flex h-36 items-end gap-2" role="img" aria-label={`Runs per day: ${days.map((d) => `${d.d} ${d.runs}`).join(", ")}`}>
              {days.map((d) => (
                <div key={d.d} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-xs text-ink-soft">{d.runs || ""}</span>
                  <div className="w-full rounded-t bg-wire" style={{ height: `${(d.runs / max) * 100}%`, minHeight: d.runs ? 4 : 1, opacity: d.runs ? 1 : 0.2 }} />
                  <span className="text-xs text-ink-faint">{new Date(d.d).toLocaleDateString("en", { weekday: "short" })}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="flex items-center justify-between p-5 pb-3">
              <h2 className="text-lg">Latest runs</h2>
              <Link href="/app/executions" className="text-sm text-wire underline">
                All runs
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="px-5 pb-6 text-ink-soft">
                Nothing has run yet.{" "}
                <Link href="/app/templates" className="text-wire underline">
                  Start from a template
                </Link>{" "}
                to see your first run in a minute.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/app/executions/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                      <StatusPill status={r.status} />
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <span className="text-sm text-ink-faint">{timeAgo(r.startedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Body>
    </>
  );
}
