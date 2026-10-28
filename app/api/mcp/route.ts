/**
 * MCP server (Streamable HTTP transport, JSON responses).
 * Customers add  {APP_URL}/api/mcp  as a remote MCP server in Claude / ChatGPT / any MCP client,
 * with header  Authorization: Bearer ff_…  (an API key from Settings).
 */
import { NextResponse } from "next/server";
import { orgFromApiKey } from "@/lib/apikey";
import { apiGetExecution, apiListWorkflows, apiRunWorkflow } from "@/lib/public-api";
import { HttpError } from "@/lib/http";

export const maxDuration = 300;

const TOOLS = [
  {
    name: "list_workflows",
    description: "List the automation workflows in this FlowForge workspace, with ids, names and whether they are active.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_workflow",
    description: "Run a FlowForge workflow by id and return its output. `input` becomes the workflow's trigger data.",
    inputSchema: {
      type: "object",
      properties: { workflow_id: { type: "string" }, input: { type: "object", description: "JSON input for the trigger" } },
      required: ["workflow_id"],
    },
  },
  {
    name: "get_execution",
    description: "Get the status, step log and output of a past workflow run.",
    inputSchema: { type: "object", properties: { execution_id: { type: "string" } }, required: ["execution_id"] },
  },
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (v: unknown, isError = false) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }], isError });

export async function POST(req: Request) {
  const org = await orgFromApiKey(req);
  if (!org) return NextResponse.json(fail(null, -32001, "Invalid or missing API key"), { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

  let msg: Rpc | Rpc[];
  try {
    msg = await req.json();
  } catch {
    return NextResponse.json(fail(null, -32700, "Parse error"), { status: 400 });
  }
  const batch = Array.isArray(msg) ? msg : [msg];
  const out: unknown[] = [];

  for (const m of batch) {
    if (m.id === undefined) continue; // notifications (e.g. notifications/initialized) need no reply
    try {
      switch (m.method) {
        case "initialize":
          out.push(
            ok(m.id, {
              protocolVersion: (m.params?.protocolVersion as string) ?? "2025-06-18",
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "flowforge", version: "1.0.0" },
              instructions: "Use list_workflows to discover automations, then run_workflow to execute one.",
            }),
          );
          break;
        case "ping":
          out.push(ok(m.id, {}));
          break;
        case "tools/list":
          out.push(ok(m.id, { tools: TOOLS }));
          break;
        case "tools/call": {
          const name = m.params?.name as string;
          const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
          try {
            if (name === "list_workflows") out.push(ok(m.id, text(await apiListWorkflows(org))));
            else if (name === "run_workflow") {
              const r = await apiRunWorkflow(org, String(args.workflow_id), args.input ?? {}, "mcp");
              out.push(ok(m.id, text(r, r.status === "ERROR")));
            } else if (name === "get_execution") out.push(ok(m.id, text(await apiGetExecution(org, String(args.execution_id)))));
            else out.push(fail(m.id, -32602, `Unknown tool: ${name}`));
          } catch (e) {
            out.push(ok(m.id, text(e instanceof HttpError ? e.message : "Tool failed", true)));
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

  if (!out.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(msg) ? out : out[0]);
}

export async function GET() {
  // No server-initiated stream; clients fall back to plain POST request/response.
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
