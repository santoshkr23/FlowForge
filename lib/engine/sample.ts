import type { Workflow } from "@/db/schema";
import { findTrigger } from "./graph";
import { POLLERS } from "./pollers";
import { connectionHelpers } from "./connections";

/**
 * Watch triggers ("someone posts", "new RSS item"…) only fire on their timer. For a test run with no
 * input, check the source now and return its newest item, so the rest of the workflow gets real data.
 * Returns null for other triggers.
 */
export async function sampleTriggerInput(wf: Pick<Workflow, "graph">, orgId: string): Promise<unknown | null> {
  const t = findTrigger(wf.graph);
  if (!t || !POLLERS[t.type]) return null;
  let r;
  try {
    r = await POLLERS[t.type]({ config: (t.data?.config ?? {}) as Record<string, unknown>, state: { seen: [] }, h: connectionHelpers(orgId) });
  } catch (e) {
    throw new Error(`Test run: the trigger couldn't check its source — ${(e as Error).message}`);
  }
  if (!r.items.length) throw new Error("Test run: the trigger found nothing at its source yet (no posts / items).");
  return r.items[r.items.length - 1];
}
