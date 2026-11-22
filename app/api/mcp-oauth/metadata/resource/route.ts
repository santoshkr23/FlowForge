import { protectedResourceMetadata } from "@/lib/mcp-oauth";
import { jsonCors, preflight } from "@/lib/cors";

/** RFC 9728 — served at /.well-known/oauth-protected-resource (see next.config rewrites). */
export function GET(req: Request) {
  return jsonCors(protectedResourceMetadata(req));
}
export const OPTIONS = preflight;
