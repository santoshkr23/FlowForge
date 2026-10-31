import { z } from "zod";
import { body, json, withAuth } from "@/lib/http";
import { rewritePost } from "@/lib/social/rewrite";

/** Clean up a pasted post (and rewrite it with AI if a key is set), add credit + hashtags. */
export const POST = withAuth("BUILDER", async (_ctx, req) => {
  const b = await body(
    req,
    z.object({
      text: z.string().min(1, "Paste the post text first").max(20000),
      style: z.enum(["clean", "rewrite", "short", "hook"]).default("clean"),
      author: z.string().max(120).optional(),
      url: z.string().max(2000).optional(),
      credit: z.boolean().default(true),
    }),
  );
  return json(await rewritePost(b.text, b));
});
