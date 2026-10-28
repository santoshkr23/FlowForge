import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "../db";
import { findTrigger, nextRunAfter } from "./graph";
import { startRun } from "./queue";
import { createExecution } from "./runner";
import { POLLERS } from "./pollers";
import { connectionHelpers } from "./connections";
import type { Workflow } from "@/db/schema";

const MAX_ITEMS_PER_CHECK = 25;

/** Run a watch trigger once: fetch new items, save the new position, start one run per item. */
export async function checkWatch(wf: Workflow): Promise<number> {
  const t = findTrigger(wf.graph);
  const poller = t && POLLERS[t.type];
  if (!t || !poller) return 0;
  try {
    const { items, state } = await poller({ config: t.data?.config ?? {}, state: wf.pollState ?? null, h: connectionHelpers(wf.orgId) });
    await db.update(schema.workflows).set({ pollState: state }).where(eq(schema.workflows.id, wf.id));
    const batch = items.slice(0, MAX_ITEMS_PER_CHECK);
    for (const item of batch) await startRun(wf, "schedule", item);
    return batch.length;
  } catch (e) {
    // make the failure visible in Run history instead of failing silently
    const ex = await createExecution(wf, "schedule", {});
    await db
      .update(schema.executions)
      .set({ status: "ERROR", error: `Checking for new items failed: ${(e as Error).message}`, finishedAt: new Date(), durationMs: 0, steps: [] })
      .where(eq(schema.executions.id, ex.id));
    return 0;
  }
}

/**
 * Finds active scheduled workflows that are due, claims each one by moving nextRunAt forward
 * (conditional update, so two schedulers never double-fire), then starts a run
 * — or, for watch triggers, checks for new items.
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
    const t = findTrigger(wf.graph);
    if (t && POLLERS[t.type]) fired += await checkWatch(wf);
    else {
      await startRun(wf, "schedule", { firedAt: now.toISOString() });
      fired++;
    }
  }
  return fired;
}

/** In-process scheduler for single-server setups without the worker. */
export function startInlineScheduler(intervalMs = 30_000) {
  const g = globalThis as unknown as { __ffSched?: NodeJS.Timeout };
  if (g.__ffSched) return;
  g.__ffSched = setInterval(() => tickScheduler().catch((e) => console.error("scheduler", e)), intervalMs);
}
