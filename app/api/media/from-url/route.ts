import { z } from "zod";
import { body, err, json, withAuth } from "@/lib/http";
import { downloadVideo } from "@/lib/social/media-store";
import { mediaUrl } from "@/lib/social/publish";
import { siteUrl } from "@/lib/oauth/providers";
import { StepError } from "@/lib/engine/types";

export const maxDuration = 900;

/** Download a video from a public link (Google Drive / Dropbox share links work) into the media library. */
export const POST = withAuth("BUILDER", async (ctx, req) => {
  const b = await body(req, z.object({ url: z.string().trim().url("Paste a full link starting with https://") }));
  try {
    const m = await downloadVideo(ctx.org.id, b.url);
    return json({ ...m, url: mediaUrl(siteUrl(req), m) }, 201);
  } catch (e) {
    if (e instanceof StepError) return err(e.message, 422);
    throw e;
  }
});
