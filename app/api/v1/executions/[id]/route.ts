import { orgFromApiKey } from "@/lib/apikey";
import { apiGetExecution } from "@/lib/public-api";
import { err, handleError, json } from "@/lib/http";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const org = await orgFromApiKey(req);
    if (!org) return err("Invalid API key", 401);
    return json(await apiGetExecution(org, params.id));
  } catch (e) {
    return handleError(e);
  }
}
