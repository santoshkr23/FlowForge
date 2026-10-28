import { z } from "zod";
import { body, err, json, withAuth } from "@/lib/http";
import { aiProvider, chat, extractJson } from "@/lib/ai";
import { CATALOG } from "@/lib/engine/catalog";
import { validateGraph } from "@/lib/engine/graph";
import { chargeCredits } from "@/lib/credits";
import type { Graph } from "@/db/schema";

export const maxDuration = 60;

const catalogText = CATALOG.map((m) => `- ${m.type}: ${m.description} Fields: ${m.fields.filter((f) => f.type !== "connection").map((f) => f.key).join(", ") || "none"}`).join("\n");

const SYSTEM = `You design automation workflows for FlowForge. Output ONLY JSON: {"name": string, "graph": {"nodes": [...], "edges": [...]}}.
Node: {"id": short_snake_id, "type": one of the module types, "position": {"x": number, "y": number}, "data": {"label": short label, "config": {...}}}.
Edge: {"id": "a->b", "source": id, "target": id}.
Rules: exactly one trigger node (type starts with "trigger."), laid out left to right (x += 260), branches stacked vertically (y += 160).
Reference data with {{trigger.…}} (webhook data is under trigger.body), {{steps.<nodeId>.<field>}}, {{item}} inside an iterator.
JSON fields (headers, values, fields, body, input) are strings containing JSON. Leave connectionId empty.
Modules:
${catalogText}`;

/** Build a workflow draft from a plain-English description. Costs 5 credits. */
export const POST = withAuth("BUILDER", async (ctx, req) => {
  const { prompt } = await body(req, z.object({ prompt: z.string().trim().min(5).max(2000) }));
  if (!aiProvider()) return err("AI isn't configured on this server (set OPENAI_API_KEY or ANTHROPIC_API_KEY)", 501);
  if (!(await chargeCredits(ctx.org.id, 5))) return err("Out of credits", 402);
  const r = await chat({ system: SYSTEM, messages: [{ role: "user", content: prompt }], json: true, maxTokens: 3000 });
  let parsed: { name?: string; graph?: Graph };
  try {
    parsed = extractJson(r.text) as typeof parsed;
  } catch {
    return err("The AI returned something unusable — try rephrasing", 502);
  }
  const graph = parsed.graph;
  if (!graph?.nodes) return err("The AI didn't return a workflow — try rephrasing", 502);
  graph.nodes = graph.nodes.map((n) => ({ ...n, position: n.position ?? { x: 0, y: 0 }, data: { label: n.data?.label, config: n.data?.config ?? {} } }));
  graph.edges = (graph.edges ?? []).map((e) => ({ ...e, id: e.id ?? `${e.source}->${e.target}` }));
  return json({ name: parsed.name ?? "AI workflow", graph, problems: validateGraph(graph) });
});
