import { chat, extractJson, type ChatMsg, type ToolDef } from "../../ai";
import { httpRequest } from "../net";
import { dsGet, dsSet } from "../datastore";
import { StepError, type ModuleRunner, type RunCtx } from "../types";

const clip = (v: unknown, n = 6000) => {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t.length > n ? t.slice(0, n) + "…[truncated]" : t;
};

const TOOL_DEFS: Record<string, ToolDef> = {
  http_get: {
    name: "http_get",
    description: "Fetch a public URL (web page or JSON API) and return its body.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  http_post: {
    name: "http_post",
    description: "POST a JSON body to a public URL.",
    parameters: { type: "object", properties: { url: { type: "string" }, body: { type: "object" } }, required: ["url", "body"] },
  },
  datastore_get: {
    name: "datastore_get",
    description: "Read a value from the workspace data store.",
    parameters: { type: "object", properties: { store: { type: "string" }, key: { type: "string" } }, required: ["key"] },
  },
  datastore_set: {
    name: "datastore_set",
    description: "Save a value to the workspace data store.",
    parameters: { type: "object", properties: { store: { type: "string" }, key: { type: "string" }, value: {} }, required: ["key", "value"] },
  },
  run_workflow: {
    name: "run_workflow",
    description: "Run another FlowForge workflow by id with a JSON input and get its output.",
    parameters: { type: "object", properties: { workflowId: { type: "string" }, input: { type: "object" } }, required: ["workflowId"] },
  },
};

async function runTool(ctx: RunCtx, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "http_get":
      return clip((await httpRequest(String(args.url))).body);
    case "http_post":
      return clip((await httpRequest(String(args.url), { method: "POST", body: args.body })).body);
    case "datastore_get":
      return clip(await dsGet(ctx.orgId, String(args.store || "default"), String(args.key)));
    case "datastore_set":
      await dsSet(ctx.orgId, String(args.store || "default"), String(args.key), args.value);
      return "saved";
    case "run_workflow":
      return clip(await ctx.runWorkflow(String(args.workflowId), args.input ?? {}));
    default:
      return `Unknown tool ${name}`;
  }
}

export const ai: Record<string, ModuleRunner> = {
  "ai.prompt": async ({ config }) => {
    const wantJson = config.json === true || config.json === "true";
    const r = await chat({
      system: config.system ? String(config.system) : undefined,
      messages: [{ role: "user", content: String(config.prompt ?? "") }],
      model: config.model && config.model !== "default" ? String(config.model) : undefined,
      json: wantJson,
    });
    let data: unknown = null;
    if (wantJson) {
      try {
        data = extractJson(r.text);
      } catch {
        throw new StepError("The AI did not return valid JSON");
      }
    }
    return { output: { text: r.text, data } };
  },

  "ai.agent": async (ctx) => {
    const { config } = ctx;
    const allowed = String(config.tools ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => TOOL_DEFS[t]);
    const tools = allowed.map((t) => TOOL_DEFS[t]);
    const maxSteps = Math.max(1, Math.min(Number(config.maxSteps) || 6, 20));
    const system =
      "You are an automation agent inside a workflow. Work toward the goal using the tools when useful. " +
      "Be efficient: call tools only when needed. When done, reply with the final answer only.";
    const messages: ChatMsg[] = [{ role: "user", content: String(config.goal ?? "") }];
    const reasoning: { step: number; thought?: string; tool?: string; args?: unknown; result?: string }[] = [];
    let toolCalls = 0;

    for (let step = 1; step <= maxSteps + 1; step++) {
      const r = await chat({ system, messages, tools: step <= maxSteps ? tools : [] });
      if (!r.toolCalls.length) {
        reasoning.push({ step, thought: r.text });
        return { output: { answer: r.text, reasoning, toolCalls }, extraCredits: toolCalls * 2 };
      }
      messages.push({ role: "assistant", content: r.text, toolCalls: r.toolCalls });
      for (const call of r.toolCalls) {
        toolCalls++;
        let result: string;
        try {
          result = await runTool(ctx, call.name, call.args);
        } catch (e) {
          result = `Error: ${(e as Error).message}`;
        }
        reasoning.push({ step, thought: r.text || undefined, tool: call.name, args: call.args, result: clip(result, 500) });
        ctx.log(`agent → ${call.name}`);
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: result });
      }
    }
    throw new StepError("Agent hit the tool-call limit without finishing");
  },
};
