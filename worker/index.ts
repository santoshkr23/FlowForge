/**
 * Background worker: processes queued executions and fires scheduled workflows.
 *   REDIS_URL=redis://… npm run worker
 * Run as many workers as you need; scheduling is claim-safe.
 */
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAME } from "../lib/engine/queue";
import { runExecution } from "../lib/engine/runner";
import { tickScheduler } from "../lib/engine/scheduler";

const url = process.env.REDIS_URL;
if (!url) {
  console.error("REDIS_URL is required for the worker. Without Redis, the web server runs workflows itself.");
  process.exit(1);
}

const connection = new IORedis(url, { maxRetriesPerRequest: null });
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 10);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const r = await runExecution(job.data.executionId);
    return { status: r.status, credits: r.creditsUsed };
  },
  { connection, concurrency },
);

worker.on("failed", (job, e) => console.error(`job ${job?.id} crashed`, e));
worker.on("ready", () => console.log(`⚙  FlowForge worker ready (concurrency ${concurrency})`));

setInterval(() => {
  tickScheduler()
    .then((n) => n && console.log(`⏰ fired ${n} scheduled run(s)`))
    .catch((e) => console.error("scheduler", e));
}, 30_000);

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});
