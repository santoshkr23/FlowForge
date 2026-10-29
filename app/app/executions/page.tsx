import Link from "next/link";
import { and, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { requireCtx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead, StatusPill } from "@/components/app/PageHead";
import { duration, timeAgo } from "@/lib/format";
import { planAllows } from "@/lib/plans";

export const metadata = { title: "Run history" };
const PAGE = 50;

export default async function Executions(props: { searchParams: Promise<{ status?: string; q?: string; before?: string; wf?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  const e = schema.executions;
  const conds: SQL[] = [eq(e.orgId, ctx.org.id)];
  if (searchParams.status && ["SUCCESS", "ERROR", "RUNNING", "QUEUED"].includes(searchParams.status)) conds.push(eq(e.status, searchParams.status as "SUCCESS"));
  if (searchParams.wf) conds.push(eq(e.workflowId, searchParams.wf));
  if (searchParams.before) conds.push(lt(e.startedAt, new Date(searchParams.before)));
  const canSearch = planAllows(ctx.org.plan, "PRO");
  if (searchParams.q && canSearch) {
    const q = `%${searchParams.q}%`;
    conds.push(or(ilike(e.error, q), ilike(sql`${e.steps}::text`, q), ilike(schema.workflows.name, q))!);
  }
  const rows = await db
    .select({ id: e.id, status: e.status, trigger: e.trigger, startedAt: e.startedAt, durationMs: e.durationMs, creditsUsed: e.creditsUsed, error: e.error, name: schema.workflows.name })
    .from(e)
    .innerJoin(schema.workflows, eq(schema.workflows.id, e.workflowId))
    .where(and(...conds))
    .orderBy(desc(e.startedAt))
    .limit(PAGE);

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...searchParams, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `?${p}`;
  };

  return (
    <>
      <PageHead title="Run history" sub="Every run, with the input and output of each step." />
      <Body>
        <form className="mb-4 flex flex-wrap gap-2">
          <select name="status" defaultValue={searchParams.status ?? ""} className="input w-auto" aria-label="Status">
            <option value="">All statuses</option>
            <option value="SUCCESS">Succeeded</option>
            <option value="ERROR">Failed</option>
            <option value="RUNNING">Running</option>
          </select>
          <input
            name="q"
            defaultValue={searchParams.q}
            className="input w-64"
            placeholder={canSearch ? "Search inside run data" : "Search inside runs (Pro plan)"}
            disabled={!canSearch}
            aria-label="Search"
          />
          {searchParams.wf && <input type="hidden" name="wf" value={searchParams.wf} />}
          <button className="btn-quiet">Filter</button>
        </form>
        {rows.length === 0 ? (
          <p className="panel p-8 text-ink-soft">No runs match. Runs appear here as soon as a workflow starts.</p>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-ink-soft">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Workflow</th>
                  <th className="px-5 py-3 font-medium">Started by</th>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Took</th>
                  <th className="px-5 py-3 text-right font-medium">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas">
                    <td className="px-5 py-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/app/executions/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      {r.error && <div className="max-w-md truncate text-xs text-bad">{r.error}</div>}
                    </td>
                    <td className="px-5 py-3 capitalize text-ink-soft">{r.trigger}</td>
                    <td className="px-5 py-3 text-ink-soft" title={r.startedAt.toISOString()}>
                      {timeAgo(r.startedAt)}
                    </td>
                    <td className="px-5 py-3 text-ink-soft">{duration(r.durationMs)}</td>
                    <td className="px-5 py-3 text-right">{r.creditsUsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length === PAGE && (
          <Link className="btn-quiet mt-4" href={qs({ before: rows[rows.length - 1].startedAt.toISOString() })}>
            Older runs
          </Link>
        )}
      </Body>
    </>
  );
}
