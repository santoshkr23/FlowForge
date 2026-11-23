/**
 * MCP server (Streamable HTTP transport, JSON responses).
 *
 * Connect from Claude: Settings → Connectors → Add custom connector → {APP_URL}/api/mcp → "Sign in to FlowForge".
 * Sign-in uses OAuth (see lib/mcp-oauth.ts). Scripts and other MCP clients may instead send
 * "Authorization: Bearer ff_…" (an API key from API & MCP).
 */
import { orgFromApiKey } from "@/lib/apikey";
import { isSuperAdmin } from "@/lib/auth";
import { planAllows } from "@/lib/plans";
import { HttpError } from "@/lib/http";
import { CORS, preflight } from "@/lib/cors";
import { principalFromAccessToken, unauthorized } from "@/lib/mcp-oauth";
import { TOOLS, callTool, type McpPrincipal } from "@/lib/mcp-tools";

export const maxDuration = 300;

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (v: unknown, isError = false) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }], isError });
const reply = (data: unknown, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...CORS } });

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

async function principal(req: Request): Promise<McpPrincipal | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (token.startsWith("ffo_")) {
    const p = await principalFromAccessToken(token);
    return p ? { org: p.org, userId: p.user.id, admin: isSuperAdmin(p.user.email), via: "oauth" } : null;
  }
  const org = await orgFromApiKey(req);
  return org ? { org, userId: null, admin: false, via: "apikey" } : null;
}

export async function POST(req: Request) {
  const who = await principal(req);
  if (!who) return unauthorized(req);

  let msg: Rpc | Rpc[];
  try {
    msg = await req.json();
  } catch {
    return reply(fail(null, -32700, "Parse error"), 400);
  }
  const batch = Array.isArray(msg) ? msg : [msg];
  const out: unknown[] = [];

  for (const m of batch) {
    if (m.id === undefined) continue; // notifications (e.g. notifications/initialized) need no reply
    try {
      switch (m.method) {
        case "initialize": {
          const asked = m.params?.protocolVersion as string | undefined;
          out.push(
            ok(m.id, {
              protocolVersion: asked && PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "flowforge", title: "FlowForge", version: "1.1.0" },
              instructions:
                "FlowForge runs automation workflows and publishes social media posts. Use list_social_accounts before creating a post, " +
                "create_social_post to publish now / schedule / save a draft, publish_youtube_video to upload videos to YouTube, import_post_from_link to turn a post link into clean text plus its pictures or PDF, " +
                "and list_workflows + run_workflow for other automations. Posting to social accounts is public: confirm the text and accounts with the user before publishing.",
            }),
          );
          break;
        }
        case "ping":
          out.push(ok(m.id, {}));
          break;
        case "tools/list":
          out.push(ok(m.id, { tools: TOOLS }));
          break;
        case "resources/list":
          out.push(ok(m.id, { resources: [] }));
          break;
        case "prompts/list":
          out.push(ok(m.id, { prompts: [] }));
          break;
        case "tools/call": {
          const name = String(m.params?.name ?? "");
          const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
          if (!TOOLS.some((t) => t.name === name)) {
            out.push(fail(m.id, -32602, `Unknown tool: ${name}`));
            break;
          }
          if (!who.admin && !planAllows(who.org.plan, "PRO")) {
            out.push(ok(m.id, text("FlowForge's AI assistant connector needs the Pro plan or higher. Upgrade under Billing in FlowForge.", true)));
            break;
          }
          try {
            out.push(ok(m.id, text(await callTool(who, name, args, req))));
          } catch (e) {
            out.push(ok(m.id, text(e instanceof HttpError ? e.message : (e as Error).message || "Tool failed", true)));
          }
          break;
        }
        default:
          out.push(fail(m.id, -32601, `Method not found: ${m.method}`));
      }
    } catch (e) {
      out.push(fail(m.id, -32603, (e as Error).message));
    }
  }

  if (!out.length) return reply(null, 202);
  return reply(Array.isArray(msg) ? out : out[0]);
}

export async function GET(req: Request) {
  // Unauthenticated probes get the sign-in pointer; otherwise there's no server-initiated stream.
  if (!(await principal(req))) return unauthorized(req);
  return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS } });
}

export const OPTIONS = preflight;
