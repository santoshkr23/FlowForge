import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { decryptJson } from "../crypto";
import { chargeCredits, creditsRemaining, ensureCreditWindow } from "../credits";
import { planAllows, PLANS } from "../plans";
import { CATALOG_BY_TYPE } from "./catalog";
import { childrenMap, findTrigger } from "./graph";
import { resolveDeep, type Scope } from "./template";
import { core } from "./modules/core";
import { apps } from "./modules/apps";
import { ai } from "./modules/ai";
import { StepError, type ModuleResult, type ModuleRunner } from "./types";
import type { GraphNode, StepLog, Workflow } from "@/db/schema";

export const RUNNERS: Record<string, ModuleRunner> = { ...core, ...apps, ...ai };

const MAX_STEPS_PER_RUN = 2000;
const STEP_TIMEOUT_MS = 330_000;
const MAX_LOG_BYTES = 20_000;
const MAX_DEPTH = 3;

class OutOfCredits extends Error {
  constructor() {
    super("Out of credits — upgrade your plan or buy a credit pack");
  }
}

function clipForLog(v: unknown): unknown {
  if (v === undefined) return undefined;
  try {
    const s = JSON.stringify(v);
    if (s.length <= MAX_LOG_BYTES) return v;
    return { _truncated: true, preview: s.slice(0, MAX_LOG_BYTES) };
  } catch {
    return String(v);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new StepError(`${what} timed out`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export type RunOutcome = {
  status: "SUCCESS" | "ERROR";
  output: unknown;
  error?: string;
  respond?: { status: number; body: unknown };
  creditsUsed: number;
  steps: StepLog[];
};

/** Execute an existing QUEUED execution row. Safe to call from the web process or the worker. */
export async function runExecution(executionId: string, depth = 0): Promise<RunOutcome> {
  const [exec] = await db.select().from(schema.executions).where(eq(schema.executions.id, executionId)).limit(1);
  if (!exec) throw new Error(`Execution ${executionId} not found`);
  const [wf] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, exec.workflowId)).limit(1);
  const [orgRow] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, exec.orgId)).limit(1);
  if (!wf || !orgRow) throw new Error("Workflow or organization missing");
  const org = await ensureCreditWindow(orgRow);

  const started = Date.now();
  const steps: StepLog[] = [];
  let creditsUsed = 0;
  let respond: RunOutcome["respond"];
  let lastOutput: unknown = null;

  const finish = async (status: "SUCCESS" | "ERROR", error?: string): Promise<RunOutcome> => {
    const output = respond?.body ?? lastOutput;
    await db
      .update(schema.executions)
      .set({
        status,
        error: error ?? null,
        steps,
        output: clipForLog(output) as object,
        creditsUsed,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
      })
      .where(eq(schema.executions.id, executionId));
    return { status, output, error, respond, creditsUsed, steps };
  };

  await db.update(schema.executions).set({ status: "RUNNING", startedAt: new Date() }).where(eq(schema.executions.id, executionId));

  if (creditsRemaining(org) <= 0) return finish("ERROR", new OutOfCredits().message);

  const graph = wf.graph;
  const trigger = findTrigger(graph);
  if (!trigger) return finish("ERROR", "Workflow has no trigger");
  const kids = childrenMap(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let stepCount = 0;

  const connCache = new Map<string, unknown>();
  const connection = async <T,>(id: unknown): Promise<T> => {
    const key = String(id ?? "");
    if (!key) throw new StepError("Pick a connection for this step");
    if (!connCache.has(key)) {
      const [c] = await db
        .select()
        .from(schema.connections)
        .where(and(eq(schema.connections.id, key), eq(schema.connections.orgId, org.id)))
        .limit(1);
      if (!c) throw new StepError("Connection not found — it may have been deleted");
      connCache.set(key, decryptJson(c.secret));
    }
    return connCache.get(key) as T;
  };

  const runSubWorkflow = async (workflowId: string, input: unknown) => {
    if (depth + 1 > MAX_DEPTH) throw new StepError("Sub-workflows can only be nested 3 levels deep");
    const [sub] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, workflowId), eq(schema.workflows.orgId, org.id)))
      .limit(1);
    if (!sub) throw new StepError(`Workflow ${workflowId} not found in this workspace`);
    const [subExec] = await db.insert(schema.executions).values({ orgId: org.id, workflowId: sub.id, trigger: "subflow", input: input as object }).returning();
    const r = await runExecution(subExec.id, depth + 1);
    if (r.status === "ERROR") throw new StepError(`Sub-workflow failed: ${r.error}`);
    return r.output;
  };

  const execNode = async (node: GraphNode, scope: Scope): Promise<void> => {
    if (++stepCount > MAX_STEPS_PER_RUN) throw new StepError(`Run exceeded ${MAX_STEPS_PER_RUN} steps`);
    const meta = CATALOG_BY_TYPE[node.type];
    const runner = RUNNERS[node.type];
    const startedAt = new Date();
    const raw = (node.data?.config ?? {}) as Record<string, unknown>;
    const log: StepLog = { nodeId: node.id, type: node.type, label: node.data?.label, status: "success", startedAt: startedAt.toISOString(), durationMs: 0, credits: 0 };
    steps.push(log);
    let ownWorkDone = false;

    try {
      if (!meta || !runner) throw new StepError(`Unknown step type ${node.type}`);
      if (meta.minPlan && !planAllows(org.plan, meta.minPlan)) throw new StepError(`${meta.name} needs the ${PLANS[meta.minPlan].name} plan or higher`);
      if (meta.credits > 0) {
        if (!(await chargeCredits(org.id, meta.credits))) throw new OutOfCredits();
        creditsUsed += meta.credits;
        log.credits = meta.credits;
      }
      // Resolve mapped values. JSON/code fields are resolved inside the module after parsing.
      const rawFieldTypes = new Map(meta.fields.map((f) => [f.key, f.type]));
      const config: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        const ft = rawFieldTypes.get(k);
        config[k] = ft === "json" || ft === "code" ? v : resolveDeep(v, scope);
      }
      log.input = clipForLog(Object.fromEntries(Object.entries(config).filter(([k]) => k !== "connectionId")));

      const result: ModuleResult = await withTimeout(
        runner({
          orgId: org.id,
          executionId,
          workflowId: wf.id,
          nodeId: node.id,
          scope,
          config,
          raw,
          depth,
          connection,
          runWorkflow: runSubWorkflow,
          log: () => {},
        }),
        STEP_TIMEOUT_MS,
        meta.name,
      );

      if (result.extraCredits) {
        await chargeCredits(org.id, result.extraCredits); // best effort: the work is already done
        creditsUsed += result.extraCredits;
        log.credits += result.extraCredits;
      }
      (scope.steps as Record<string, unknown>)[node.id] = result.output ?? null;
      log.output = clipForLog(result.output);
      log.durationMs = Date.now() - startedAt.getTime();
      if (result.output !== undefined && !node.type.startsWith("trigger.")) lastOutput = result.output;
      if (result.respond) respond = result.respond;
      ownWorkDone = true;

      if (result.stop) {
        log.status = "skipped";
        return;
      }
      const next = (kids.get(node.id) ?? []).map((id) => byId.get(id)!).filter(Boolean);
      if (result.iterate) {
        for (let i = 0; i < result.iterate.length; i++) {
          const child: Scope = { ...scope, steps: { ...(scope.steps as object) }, item: result.iterate[i], index: i };
          for (const n of next) await execNode(n, child);
        }
        return;
      }
      for (const n of next) await execNode(n, scope);
    } catch (e) {
      if (ownWorkDone) throw e; // error came from a downstream step — already logged there
      log.durationMs = Date.now() - startedAt.getTime();
      log.status = "error";
      if (e instanceof OutOfCredits) {
        log.error = e.message;
        throw e;
      }
      log.error = (e as Error).message ?? String(e);
      if (raw.__onError === "continue") {
        (scope.steps as Record<string, unknown>)[node.id] = { error: log.error };
        for (const id of kids.get(node.id) ?? []) await execNode(byId.get(id)!, scope);
        return;
      }
      throw e;
    }
  };

  try {
    const scope: Scope = { trigger: exec.input ?? {}, steps: {}, vars: {}, workflow: { id: wf.id, name: wf.name }, execution: { id: executionId } };
    await execNode(trigger, scope);
    return finish("SUCCESS");
  } catch (e) {
    return finish("ERROR", (e as Error).message);
  }
}

/** Create an execution row for a workflow. */
export async function createExecution(wf: Pick<Workflow, "id" | "orgId">, trigger: string, input: unknown) {
  const [e] = await db
    .insert(schema.executions)
    .values({ orgId: wf.orgId, workflowId: wf.id, trigger, input: (input ?? {}) as object })
    .returning();
  return e;
}
