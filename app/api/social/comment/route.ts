import { z } from "zod";
import { body, err, json, withAuth } from "@/lib/http";
import { connectionHelpers } from "@/lib/engine/connections";
import { linkedinComment } from "@/lib/social/linkedin";
import { StepError } from "@/lib/engine/types";
import { chargeCredits } from "@/lib/credits";

/** Comment on a LinkedIn post by its link. */
export const POST = withAuth("BUILDER", async (ctx, req) => {
  const b = await body(req, z.object({ connectionId: z.string().min(1, "Pick your LinkedIn account"), postUrl: z.string().min(5, "Paste the post link"), text: z.string().min(1).max(1250) }));
  if (!(await chargeCredits(ctx.org.id, 1))) return err("Not enough credits", 402);
  try {
    return json(await linkedinComment(connectionHelpers(ctx.org.id), b.connectionId, b.postUrl, b.text), 201);
  } catch (e) {
    if (e instanceof StepError) return err(e.message, 422);
    throw e;
  }
});
