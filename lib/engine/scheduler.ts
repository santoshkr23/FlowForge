import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "../db";
import { nextRunAfter } from "./graph";
import { startRun } from "./queue";

/**
 * Finds active scheduled workflows that are due, claims each one by moving nextRunAt forward
 * (conditional update, so two schedulers never double-fire), then starts a run.
 */
export async function tickScheduler(now = new Date()) {
  const due = await db
    .select()
    .from(schema.workflows)
    .where(
      and(
        eq(schema.workflows.active, true),
        eq(schema.workflows.triggerType, "schedule"),
        isNotNull(schema.workflows.nextRunAt),
        lte(schema.workflows.nextRunAt, now),
      ),
    )
    .limit(500);

  let fired = 0;
  for (const wf of due) {
    const next = nextRunAfter(wf, now);
    const claimed = await db
      .update(schema.workflows)
      .set({ nextRunAt: next })
      .where(and(eq(schema.workflows.id, wf.id), eq(schema.workflows.nextRunAt, wf.nextRunAt!)))
      .returning({ id: schema.workflows.id });
    if (!claimed.length) continue;
    await startRun(wf, "schedule", { firedAt: now.toISOString() });
    fired++;
  }
  return fired;
}

/** In-process scheduler for single-server setups without the worker. */
export function startInlineScheduler(intervalMs = 30_000) {
  const g = globalThis as unknown as { __ffSched?: NodeJS.Timeout };
  if (g.__ffSched) return;
  g.__ffSched = setInterval(() => tickScheduler().catch((e) => console.error("scheduler", e)), intervalMs);
}
