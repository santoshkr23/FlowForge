import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireCtx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead, StatusPill } from "@/components/app/PageHead";
import { StepLog } from "@/components/app/StepLog";
import { duration } from "@/lib/format";

export const metadata = { title: "Run" };

export default async function Execution({ params }: { params: { id: string } }) {
  const ctx = await requireCtx();
  const [row] = await db
    .select({ ex: schema.executions, name: schema.workflows.name })
    .from(schema.executions)
    .innerJoin(schema.workflows, eq(schema.workflows.id, schema.executions.workflowId))
    .where(and(eq(schema.executions.id, params.id), eq(schema.executions.orgId, ctx.org.id)))
    .limit(1);
  if (!row) notFound();
  const { ex } = row;

  return (
    <>
      <PageHead title={row.name} sub={`Run started ${ex.startedAt.toLocaleString("en-IN")} by ${ex.trigger}`}>
        <Link href={`/app/workflows/${ex.workflowId}`} className="btn-quiet">
          Open workflow
        </Link>
      </PageHead>
      <Body>
        <div className="mb-6 flex flex-wrap items-center gap-6 text-sm">
          <StatusPill status={ex.status} />
          <span>Took {duration(ex.durationMs)}</span>
          <span>{ex.creditsUsed} credits</span>
        </div>
        {ex.error && <p className="mb-6 rounded-lg bg-bad-tint p-4 text-bad">{ex.error}</p>}
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <section>
            <h2 className="mb-3 text-lg">Steps</h2>
            <StepLog steps={ex.steps ?? []} />
          </section>
          <section className="space-y-4">
            <div>
              <h2 className="mb-2 text-lg">Trigger data</h2>
              <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-paper p-3 font-mono text-xs">{JSON.stringify(ex.input, null, 2)}</pre>
            </div>
            <div>
              <h2 className="mb-2 text-lg">Final output</h2>
              <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-paper p-3 font-mono text-xs">{JSON.stringify(ex.output, null, 2)}</pre>
            </div>
          </section>
        </div>
      </Body>
    </>
  );
}
