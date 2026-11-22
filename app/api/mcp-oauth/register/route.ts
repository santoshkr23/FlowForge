import { registerClient } from "@/lib/mcp-oauth";
import { jsonCors, preflight } from "@/lib/cors";

/** Dynamic Client Registration (RFC 7591). Public clients only (PKCE, no secret). */
export async function POST(req: Request) {
  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return jsonCors({ error: "invalid_client_metadata", error_description: "Send the client metadata as JSON" }, 400);
  }
  const r = await registerClient(input);
  return "error" in r ? jsonCors(r, 400) : jsonCors(r, 201);
}
export const OPTIONS = preflight;
