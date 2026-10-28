import { orgFromApiKey } from "@/lib/apikey";
import { apiListWorkflows } from "@/lib/public-api";
import { err, handleError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/workflows  (Authorization: Bearer ff_…) */
export async function GET(req: Request) {
  try {
    const org = await orgFromApiKey(req);
    if (!org) return err("Invalid API key", 401);
    return json(await apiListWorkflows(org));
  } catch (e) {
    return handleError(e);
  }
}
