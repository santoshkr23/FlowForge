import { orgFromApiKey } from "@/lib/apikey";
import { apiRunWorkflow } from "@/lib/public-api";
import { err, handleError, json } from "@/lib/http";

export const maxDuration = 300;

/** POST /api/v1/workflows/:id/run  body: any JSON → becomes the trigger input */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const org = await orgFromApiKey(req);
    if (!org) return err("Invalid API key", 401);
    const input = await req.json().catch(() => ({}));
    return json(await apiRunWorkflow(org, params.id, input, "api"));
  } catch (e) {
    return handleError(e);
  }
}
