// DATABASE_URL / ENCRYPTION_KEY are set by `npm test` (imports are hoisted, so setting them here is too late)

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, schema } from "../lib/db";
import { registerUser } from "../lib/auth";
import { startRun } from "../lib/engine/queue";
import { validateGraph, deriveTrigger, nextRunAfter } from "../lib/engine/graph";
import { resolveString } from "../lib/engine/template";
import { chargeCredits } from "../lib/credits";
import { encryptJson, decryptJson } from "../lib/crypto";
import { tickScheduler } from "../lib/engine/scheduler";
import type { Graph } from "../db/schema";

let orgId = "";

before(async () => {
  await migrate(db as any, { migrationsFolder: "./db/migrations" });
  const { org } = await registerUser("test@example.com", "password123", "Test User");
  orgId = org.id;
});

const node = (id: string, type: string, config: Record<string, unknown> = {}, y = 0) => ({ id, type, position: { x: 0, y }, data: { config } });
const edge = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });

async function makeWf(graph: Graph) {
  const [wf] = await db.insert(schema.workflows).values({ orgId, name: "t", graph }).returning();
  return wf;
}

test("templates resolve paths, fallbacks and helpers", () => {
  const scope = { trigger: { body: { name: "Asha", items: [1, 2, 3] } } };
  assert.equal(resolveString("Hi {{trigger.body.name}}!", scope), "Hi Asha!");
  assert.deepEqual(resolveString("{{trigger.body.items}}", scope), [1, 2, 3]);
  assert.equal(resolveString("{{trigger.body.missing || \"friend\"}}", scope), "friend");
  assert.equal(resolveString("{{upper(trigger.body.name)}}", scope), "ASHA");
  assert.equal(resolveString("{{length(trigger.body.items)}}", scope), 3);
});

test("graph validation catches cycles and missing triggers", () => {
  assert.ok(validateGraph({ nodes: [node("a", "data.compose")], edges: [] }).some((p) => p.includes("trigger")));
  const cyc = { nodes: [node("t", "trigger.manual"), node("a", "data.compose"), node("b", "data.compose")], edges: [edge("t", "a"), edge("a", "b"), edge("b", "a")] };
  assert.ok(validateGraph(cyc).some((p) => p.includes("loop")));
});

test("free plan can't schedule faster than 15 minutes", () => {
  const g = { nodes: [node("t", "trigger.schedule", { mode: "interval", intervalMin: 1 })], edges: [] };
  assert.equal(deriveTrigger(g, "FREE").intervalMin, 15);
  assert.equal(deriveTrigger(g, "PRO").intervalMin, 1);
  assert.throws(() => deriveTrigger({ nodes: [node("t", "trigger.schedule", { mode: "cron", cron: "* * * * *" })], edges: [] }, "FREE"));
});

test("full run: set → compose → router → filters → iterator → code → datastore", async () => {
  const g: Graph = {
    nodes: [
      node("trigger", "trigger.manual"),
      node("vars", "flow.set", { values: '{ "who": "{{trigger.name}}" }' }),
      node("hello", "data.compose", { template: "Hello {{vars.who}}, you have {{length(trigger.items)}} items" }),
      node("router", "flow.router"),
      node("big", "flow.filter", { left: "{{length(trigger.items)}}", op: "gt", right: "2" }, 0),
      node("small", "flow.filter", { left: "{{length(trigger.items)}}", op: "lt", right: "3" }, 100),
      node("each", "flow.iterator", { array: "{{trigger.items}}" }),
      node("save", "datastore.set", { store: "t", key: "item-{{index}}", value: "{{item}}" }),
      node("never", "data.compose", { template: "should not run" }),
    ],
    edges: [edge("trigger", "vars"), edge("vars", "hello"), edge("hello", "router"), edge("router", "big"), edge("router", "small"), edge("big", "each"), edge("each", "save"), edge("small", "never")],
  };
  assert.deepEqual(validateGraph(g), []);
  const wf = await makeWf(g);
  const { outcome, executionId } = await startRun(wf, "manual", { name: "Ravi", items: ["a", "b", "c"] }, { wait: true });
  assert.equal(outcome?.status, "SUCCESS", outcome?.error);
  const [ex] = await db.select().from(schema.executions).where(eq(schema.executions.id, executionId));
  const ran = ex.steps!.map((s) => s.nodeId);
  assert.ok(!ran.includes("never"), "filtered branch must not run");
  assert.equal(ran.filter((n) => n === "save").length, 3, "iterator runs save 3×");
  const hello = ex.steps!.find((s) => s.nodeId === "hello")!;
  assert.deepEqual(hello.output, { text: "Hello Ravi, you have 3 items" });
  // credits: set1 + compose1 + iterator1 + save×3 = 6 (trigger/router/filter are free)
  assert.equal(ex.creditsUsed, 6);
  const [store] = await db.select().from(schema.dataStores).where(eq(schema.dataStores.name, "t"));
  assert.deepEqual(store.records, { "item-0": "a", "item-1": "b", "item-2": "c" });
});

test("code step is plan-gated on Free", async () => {
  const wf = await makeWf({ nodes: [node("t", "trigger.manual"), node("c", "code.javascript", { code: "return 1" })], edges: [edge("t", "c")] });
  const { outcome } = await startRun(wf, "manual", {}, { wait: true });
  assert.equal(outcome?.status, "ERROR");
  assert.match(outcome!.error!, /Pro plan/);
});

test("code step runs on Pro with a timeout", async () => {
  await db.update(schema.orgs).set({ plan: "PRO" }).where(eq(schema.orgs.id, orgId));
  const wf = await makeWf({
    nodes: [node("t", "trigger.manual"), node("c", "code.javascript", { code: "return { total: input.trigger.nums.reduce((a,b)=>a+b,0) }" })],
    edges: [edge("t", "c")],
  });
  const { outcome } = await startRun(wf, "manual", { nums: [1, 2, 3, 4] }, { wait: true });
  assert.equal(outcome?.status, "SUCCESS", outcome?.error);
  assert.deepEqual((outcome!.output as { result: unknown }).result, { total: 10 });
  const loop = await makeWf({ nodes: [node("t", "trigger.manual"), node("c", "code.javascript", { code: "while(true){}" })], edges: [edge("t", "c")] });
  const r2 = await startRun(loop, "manual", {}, { wait: true });
  assert.equal(r2.outcome?.status, "ERROR");
  assert.match(r2.outcome!.error!, /timed out|Code error/);
});

test("continue-on-error keeps the run going", async () => {
  const wf = await makeWf({
    nodes: [node("t", "trigger.manual"), node("bad", "data.parse_json", { text: "not json", __onError: "continue" }), node("after", "data.compose", { template: "ok: {{steps.bad.error}}" })],
    edges: [edge("t", "bad"), edge("bad", "after")],
  });
  const { outcome } = await startRun(wf, "manual", {}, { wait: true });
  assert.equal(outcome?.status, "SUCCESS");
  assert.match(String((outcome!.output as { text: string }).text), /ok: Text is not valid JSON/);
});

test("webhook response step + sub-workflow", async () => {
  const child = await makeWf({ nodes: [node("t", "trigger.manual"), node("r", "flow.respond", { body: '{ "double": "{{trigger.n}}{{trigger.n}}" }' })], edges: [edge("t", "r")] });
  const parent = await makeWf({
    nodes: [node("t", "trigger.webhook"), node("sub", "workflow.run", { workflowId: child.id, input: '{ "n": "{{trigger.body.n}}" }' }), node("r", "flow.respond", { status: 201, body: '{ "got": "{{steps.sub.output.double}}" }' })],
    edges: [edge("t", "sub"), edge("sub", "r")],
  });
  const { outcome } = await startRun(parent, "webhook", { body: { n: "7" } }, { wait: true });
  assert.equal(outcome?.status, "SUCCESS", outcome?.error);
  assert.deepEqual(outcome?.respond, { status: 201, body: { got: "77" } });
});

test("credits: atomic charge refuses when exhausted, then run fails cleanly", async () => {
  await db.update(schema.orgs).set({ creditsMonthly: 10, creditsUsed: 9, extraCredits: 2 }).where(eq(schema.orgs.id, orgId));
  assert.equal(await chargeCredits(orgId, 4), false);
  assert.equal(await chargeCredits(orgId, 3), true); // 1 monthly + 2 extra
  const [o] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  assert.equal(o.creditsUsed, 10);
  assert.equal(o.extraCredits, 0);
  const wf = await makeWf({ nodes: [node("t", "trigger.manual"), node("c", "data.compose", { template: "x" })], edges: [edge("t", "c")] });
  const { outcome } = await startRun(wf, "manual", {}, { wait: true });
  assert.equal(outcome?.status, "ERROR");
  assert.match(outcome!.error!, /Out of credits/);
  await db.update(schema.orgs).set({ creditsMonthly: 10000, creditsUsed: 0 }).where(eq(schema.orgs.id, orgId));
});

test("HTTP step blocks private network addresses", async () => {
  const wf = await makeWf({ nodes: [node("t", "trigger.manual"), node("h", "http.request", { method: "GET", url: "http://127.0.0.1:5432/" })], edges: [edge("t", "h")] });
  const { outcome } = await startRun(wf, "manual", {}, { wait: true });
  assert.equal(outcome?.status, "ERROR");
  assert.match(outcome!.error!, /private network/);
});

test("scheduler fires due workflows exactly once", async () => {
  const wf = await makeWf({ nodes: [node("t", "trigger.schedule", { mode: "interval", intervalMin: 15 }), node("c", "data.compose", { template: "tick" })], edges: [edge("t", "c")] });
  const past = new Date(Date.now() - 60_000);
  await db.update(schema.workflows).set({ active: true, triggerType: "schedule", intervalMin: 15, nextRunAt: past }).where(eq(schema.workflows.id, wf.id));
  const [a, b] = await Promise.all([tickScheduler(), tickScheduler()]);
  assert.equal(a + b, 1);
  const [after] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, wf.id));
  assert.ok(after.nextRunAt! > new Date());
  assert.ok(nextRunAfter({ intervalMin: null, cron: "0 9 * * *" })!.getUTCHours() === 9);
});

test("credentials encrypt round-trip", () => {
  const enc = encryptJson({ token: "secret-123" });
  assert.ok(!enc.includes("secret-123"));
  assert.deepEqual(decryptJson(enc), { token: "secret-123" });
});
