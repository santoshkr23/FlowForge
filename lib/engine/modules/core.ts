import vm from "node:vm";
import { evalExpr, resolveJsonField, resolveString } from "../template";
import { httpRequest } from "../net";
import { dsGet, dsSet } from "../datastore";
import { StepError, type ModuleRunner } from "../types";

const str = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export const core: Record<string, ModuleRunner> = {
  "trigger.manual": async ({ scope }) => ({ output: scope.trigger }),
  "trigger.schedule": async ({ scope }) => ({ output: scope.trigger }),
  "trigger.webhook": async ({ scope }) => ({ output: scope.trigger }),

  "flow.filter": async ({ config }) => {
    const { left, op, right } = config as { left: unknown; op: string; right: unknown };
    const l = left;
    const r = right;
    const num = (x: unknown) => Number(x);
    let passed: boolean;
    switch (op) {
      case "neq":
        passed = str(l) !== str(r);
        break;
      case "contains":
        passed = Array.isArray(l) ? l.map(str).includes(str(r)) : str(l).includes(str(r));
        break;
      case "not_contains":
        passed = Array.isArray(l) ? !l.map(str).includes(str(r)) : !str(l).includes(str(r));
        break;
      case "gt":
        passed = num(l) > num(r);
        break;
      case "lt":
        passed = num(l) < num(r);
        break;
      case "exists":
        passed = l !== undefined && l !== null && l !== "";
        break;
      case "not_exists":
        passed = l === undefined || l === null || l === "";
        break;
      case "regex":
        try {
          passed = new RegExp(str(r)).test(str(l));
        } catch {
          throw new StepError("Invalid regex");
        }
        break;
      default:
        passed = str(l) === str(r);
    }
    return { output: { passed }, stop: !passed };
  },

  "flow.router": async () => ({ output: {} }),

  "flow.iterator": async ({ config }) => {
    let arr = config.array;
    if (typeof arr === "string") {
      try {
        arr = JSON.parse(arr);
      } catch {
        /* not json */
      }
    }
    if (!Array.isArray(arr)) throw new StepError("Iterator needs a list (array). Map it from an earlier step.");
    const max = Math.min(Number(config.max) || 100, 1000);
    const items = arr.slice(0, max);
    return { output: { count: items.length }, iterate: items };
  },

  "flow.delay": async ({ config }) => {
    const s = Math.max(0, Math.min(Number(config.seconds) || 0, 300));
    await new Promise((r) => setTimeout(r, s * 1000));
    return { output: { waited: s } };
  },

  "flow.set": async ({ raw, scope }) => {
    const values = resolveJsonField(raw.values, scope);
    if (!values || typeof values !== "object") throw new StepError("Variables must be a JSON object");
    scope.vars = { ...(scope.vars as object), ...(values as object) };
    return { output: values };
  },

  "flow.respond": async ({ raw, scope, config }) => {
    const body = resolveJsonField(raw.body, scope);
    const status = Number(config.status) || 200;
    return { output: { status, body }, respond: { status, body } };
  },

  "data.compose": async ({ raw, scope }) => ({ output: { text: str(resolveString(String(raw.template ?? ""), scope)) } }),

  "data.parse_json": async ({ config }) => {
    const t = config.text;
    if (typeof t === "object") return { output: { data: t } };
    try {
      return { output: { data: JSON.parse(String(t)) } };
    } catch {
      throw new StepError("Text is not valid JSON");
    }
  },

  "datastore.set": async ({ orgId, config }) => {
    const store = String(config.store || "default");
    await dsSet(orgId, store, String(config.key), config.value);
    return { output: { store, key: config.key, value: config.value } };
  },
  "datastore.get": async ({ orgId, config }) => ({ output: await dsGet(orgId, String(config.store || "default"), String(config.key)) }),

  "http.request": async ({ config, raw, scope, connection }) => {
    const headers = (resolveJsonField(raw.headers, scope) ?? {}) as Record<string, string>;
    if (config.connectionId) {
      const auth = await connection<{ header?: string; value: string }>(config.connectionId);
      headers[auth.header || "Authorization"] = auth.value;
    }
    let body: unknown = config.body;
    if (typeof raw.body === "string" && raw.body.trim().startsWith("{")) {
      try {
        body = resolveJsonField(raw.body, scope);
      } catch {
        /* send as text */
      }
    }
    const res = await httpRequest(String(config.url), { method: String(config.method || "GET"), headers, body });
    if (config.failOnError !== false && res.status >= 400) {
      throw new StepError(`HTTP ${res.status}: ${str(res.body).slice(0, 300)}`);
    }
    return { output: res };
  },

  "code.javascript": async ({ raw, scope, log }) => {
    // NOTE: node:vm is NOT a hard security boundary. For a public multi-tenant launch,
    // swap this for isolated-vm or run code steps in a separate container. See README.
    const logs: string[] = [];
    const sandbox = {
      input: JSON.parse(JSON.stringify({ trigger: scope.trigger, steps: scope.steps, vars: scope.vars, item: scope.item })),
      console: { log: (...a: unknown[]) => logs.push(a.map(str).join(" ")) },
      JSON,
      Math,
      Date,
    };
    const script = new vm.Script(`(function(){ "use strict"; ${String(raw.code ?? "")} \n})()`);
    let result: unknown;
    try {
      result = script.runInNewContext(sandbox, { timeout: 2000, microtaskMode: "afterEvaluate" });
    } catch (e) {
      throw new StepError(`Code error: ${(e as Error).message}`);
    }
    logs.forEach(log);
    return { output: { result: result === undefined ? null : JSON.parse(JSON.stringify(result)), logs } };
  },

  "workflow.run": async ({ config, raw, scope, runWorkflow }) => {
    const input = resolveJsonField(raw.input, scope) ?? {};
    const output = await runWorkflow(String(config.workflowId), input);
    return { output: { output } };
  },
};

export { evalExpr };
