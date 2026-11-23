import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { mediaStream } from "@/lib/social/media-store";

/** Public, unguessable link to an uploaded file — Facebook/Instagram fetch pictures from here. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; token: string; name: string }> }) {
  const { id, token } = await params;
  const [m] = await db.select().from(schema.media).where(and(eq(schema.media.id, id), eq(schema.media.token, token))).limit(1);
  if (!m) return new Response("Not found", { status: 404 });
  try {
    const { stream, size } = await mediaStream(m);
    return new Response(stream, {
      headers: {
        "content-type": m.mime,
        "content-length": String(size),
        "content-disposition": `inline; filename="${m.name.replace(/"/g, "")}"`,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Gone", { status: 410 });
  }
}
