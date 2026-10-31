import { z } from "zod";
import { body, json, withAuth } from "@/lib/http";
import { suggestHashtags } from "@/lib/social/hashtags";

export const POST = withAuth("BUILDER", async (_ctx, req) => {
  const b = await body(req, z.object({ text: z.string().max(10000) }));
  return json(await suggestHashtags(b.text));
});
