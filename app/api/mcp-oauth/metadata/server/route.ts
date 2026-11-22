import { authServerMetadata } from "@/lib/mcp-oauth";
import { jsonCors, preflight } from "@/lib/cors";

/** RFC 8414 — served at /.well-known/oauth-authorization-server (see next.config rewrites). */
export function GET(req: Request) {
  return jsonCors(authServerMetadata(req));
}
export const OPTIONS = preflight;
