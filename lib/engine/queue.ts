/**
 * Execution queue. With REDIS_URL set, runs go to BullMQ and are processed by `npm run worker`
 * (scales horizontally). Without Redis, runs execute inside the web process — fine for development.
 */
import type { Queue } from "bullmq";
import { createExecution, runExecution, type RunOutcome } from "./runner";
import type { Workflow } from "@/db/schema";

export const QUEUE_NAME = "ff-executions";

const g = globalThis as unknown as { __ffQueue?: Queue | null };

async function queue(): Promise<Queue | null> {
  if (g.__ffQueue !== undefined) return g.__ffQueue;
  if (!process.env.REDIS_URL) return (g.__ffQueue = null);
  const { Queue } = await import("bullmq");
  const IORedis = (await import("ioredis")).default;
  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  g.__ffQueue = new Queue(QUEUE_NAME, { connection });
  return g.__ffQueue;
}

/** Start a run. `wait: true` runs inline and returns the outcome (used for "Run once" and webhook responses). */
export async function startRun(
  wf: Pick<Workflow, "id" | "orgId">,
  trigger: string,
  input: unknown,
  opts: { wait?: boolean } = {},
): Promise<{ executionId: string; outcome?: RunOutcome }> {
  const exec = await createExecution(wf, trigger, input);
  if (opts.wait) return { executionId: exec.id, outcome: await runExecution(exec.id) };
  const q = await queue();
  if (q) {
    await q.add("run", { executionId: exec.id }, { removeOnComplete: 1000, removeOnFail: 5000 });
  } else {
    setImmediate(() => runExecution(exec.id).catch((e) => console.error("run failed", e)));
  }
  return { executionId: exec.id };
}
