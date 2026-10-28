/**
 * Minimal LLM client for OpenAI and Anthropic (Claude), with tool calling.
 * Provider is chosen by AI_PROVIDER (default: whichever key is set).
 */
import { apiCall } from "./engine/net";

export type ChatMsg =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ChatResult = { text: string; toolCalls: ToolCall[] };

export function aiProvider(): "openai" | "anthropic" | null {
  const p = process.env.AI_PROVIDER;
  if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (p === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export async function chat(opts: { system?: string; messages: ChatMsg[]; tools?: ToolDef[]; model?: string; json?: boolean; maxTokens?: number }): Promise<ChatResult> {
  const provider = aiProvider();
  if (!provider) throw new Error("No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
  return provider === "openai" ? openai(opts) : anthropic(opts);
}

async function openai(o: Parameters<typeof chat>[0]): Promise<ChatResult> {
  const messages: unknown[] = [];
  if (o.system) messages.push({ role: "system", content: o.system });
  for (const m of o.messages) {
    if (m.role === "tool") messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    else if ("toolCalls" in m)
      messages.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })),
      });
    else messages.push(m);
  }
  type R = { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
  const r = await apiCall<R>("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    json: {
      model: o.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      max_tokens: o.maxTokens ?? 1500,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
      ...(o.tools?.length ? { tools: o.tools.map((t) => ({ type: "function", function: t })) } : {}),
    },
  });
  const msg = r.choices[0].message;
  return {
    text: msg.content ?? "",
    toolCalls: (msg.tool_calls ?? []).map((t) => ({ id: t.id, name: t.function.name, args: safeParse(t.function.arguments) })),
  };
}

async function anthropic(o: Parameters<typeof chat>[0]): Promise<ChatResult> {
  const messages: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const m of o.messages) {
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = messages[messages.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) (last.content as unknown[]).push(block);
      else messages.push({ role: "user", content: [block] });
    } else if ("toolCalls" in m) {
      messages.push({
        role: "assistant",
        content: [...(m.content ? [{ type: "text", text: m.content }] : []), ...m.toolCalls.map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: t.args }))],
      });
    } else messages.push({ role: m.role, content: m.content });
  }
  type R = { content: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> })[] };
  const system = (o.system ?? "") + (o.json ? "\nRespond with a single valid JSON object and nothing else." : "");
  const r = await apiCall<R>("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
    json: {
      model: o.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: o.maxTokens ?? 1500,
      ...(system.trim() ? { system } : {}),
      messages,
      ...(o.tools?.length ? { tools: o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
    },
  });
  return {
    text: r.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join(""),
    toolCalls: r.content
      .filter((b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: b.input })),
  };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error("AI did not return JSON");
  return JSON.parse(m[0]);
}
