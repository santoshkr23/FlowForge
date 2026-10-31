import { db, schema } from "@/lib/db";
import { err, json, withAuth } from "@/lib/http";
import { randomToken } from "@/lib/crypto";
import { mediaUrl } from "@/lib/social/publish";
import { siteUrl } from "@/lib/oauth/providers";

const MAX_MEDIA = 20 * 1024 * 1024;
const OK = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

/** Upload a picture or PDF for a social post (multipart field "file"). */
export const POST = withAuth("BUILDER", async (ctx, req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return err("Choose a file to upload");
  let mime = file.type;
  if (!mime && /\.pdf$/i.test(file.name)) mime = "application/pdf";
  if (!OK.test(mime)) return err("Only pictures (JPG, PNG, GIF, WebP) and PDFs can be attached", 415);
  if (file.size > MAX_MEDIA) return err("Files can be up to 20 MB", 413);
  const name = (file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(-120);
  const data = Buffer.from(await file.arrayBuffer());
  const [m] = await db
    .insert(schema.media)
    .values({ orgId: ctx.org.id, token: randomToken(18), name, mime, size: data.length, data })
    .returning({ id: schema.media.id, token: schema.media.token, name: schema.media.name, mime: schema.media.mime, size: schema.media.size });
  return json({ ...m, url: mediaUrl(siteUrl(req), m) }, 201);
});
