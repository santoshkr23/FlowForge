import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireCtx, hasRole } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead } from "@/components/app/PageHead";
import { NewWorkflow } from "@/components/app/NewWorkflow";
import { ActiveToggle } from "@/components/app/ActiveToggle";
import { AppIcon } from "@/components/AppIcon";
import { CATALOG_BY_TYPE } from "@/lib/engine/catalog";
import { findTrigger } from "@/lib/engine/graph";
import { timeAgo } from "@/lib/format";

export const metadata = { title: "Workflows" };

export default async function Workflows({ searchParams }: { searchParams: { new?: string } }) {
  const ctx = await requireCtx();
  const w = schema.workflows;
  const rows = await db
    .select({
      wf: w,
      lastRun: sql<Date | null>`(select max(started_at) from executions where workflow_id = ${w.id})`,
    })
    .from(w)
    .where(eq(w.orgId, ctx.org.id))
    .orderBy(desc(w.updatedAt));
  const canEdit = hasRole(ctx.role, "BUILDER");

  return (
    <>
      <PageHead title="Workflows" sub="Each workflow starts with a trigger and runs its steps from left to right.">
        {canEdit && <NewWorkflow autoOpen={searchParams.new === "1"} />}
      </PageHead>
      <Body>
        {rows.length === 0 ? (
          <div className="panel p-10 text-center">
            <h2 className="text-xl">No workflows yet</h2>
            <p className="mt-2 text-ink-soft">Start from a blank canvas, describe what you want to the AI, or pick a template.</p>
            <Link href="/app/templates" className="btn-quiet mt-5">
              Browse templates
            </Link>
          </div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-ink-soft">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Starts on</th>
                  <th className="px-5 py-3 font-medium">Last run</th>
                  <th className="px-5 py-3 font-medium">On</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ wf, lastRun }) => {
                  const t = findTrigger(wf.graph);
                  const meta = t ? CATALOG_BY_TYPE[t.type] : undefined;
                  const apps = Array.from(new Set(wf.graph.nodes.filter((n) => !CATALOG_BY_TYPE[n.type]?.trigger).map((n) => CATALOG_BY_TYPE[n.type]).filter(Boolean))).slice(0, 5);
                  return (
                    <tr key={wf.id} className="hover:bg-canvas">
                      <td className="px-5 py-3">
                        <Link href={`/app/workflows/${wf.id}`} className="font-medium hover:underline">
                          {wf.name}
                        </Link>
                        <div className="mt-1.5 flex gap-1">
                          {apps.map((m) => (
                            <span key={m!.type} title={m!.name}>
                              <AppIcon app={m!.app} color={m!.color} size={11} />
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-ink-soft">
                        {meta?.name ?? "—"}
                        {wf.triggerType === "schedule" && (wf.intervalMin ? ` · every ${wf.intervalMin} min` : ` · ${wf.cron}`)}
                      </td>
                      <td className="px-5 py-3 text-ink-soft">{timeAgo(lastRun)}</td>
                      <td className="px-5 py-3">
                        <ActiveToggle id={wf.id} active={wf.active} disabled={!canEdit || wf.triggerType === "manual"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Body>
    </>
  );
}
