import { revokeToken } from "@/lib/mcp-oauth";
import { jsonCors, preflight } from "@/lib/cors";

/** RFC 7009 token revocation. Always 200, as the spec asks. */
export async function POST(req: Request) {
  const p = new URLSearchParams(await req.text().catch(() => ""));
  const token = p.get("token");
  if (token) await revokeToken(token).catch(() => {});
  return jsonCors({});
}
export const OPTIONS = preflight;
