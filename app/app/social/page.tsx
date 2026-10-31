import { desc, eq } from "drizzle-orm";
import { hasRole, requireCtx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead } from "@/components/app/PageHead";
import { Social } from "@/components/app/Social";
import { accountsFrom } from "@/lib/social/publish";

export const metadata = { title: "Social" };

export default async function SocialPage() {
  const ctx = await requireCtx();
  const conns = await db
    .select({ id: schema.connections.id, app: schema.connections.app, name: schema.connections.name })
    .from(schema.connections)
    .where(eq(schema.connections.orgId, ctx.org.id))
    .orderBy(desc(schema.connections.createdAt));
  const posts = await db
    .select({
      id: schema.posts.id,
      text: schema.posts.text,
      link: schema.posts.link,
      mediaId: schema.posts.mediaId,
      mediaTitle: schema.posts.mediaTitle,
      targets: schema.posts.targets,
      status: schema.posts.status,
      scheduledAt: schema.posts.scheduledAt,
      postedAt: schema.posts.postedAt,
      results: schema.posts.results,
      createdAt: schema.posts.createdAt,
    })
    .from(schema.posts)
    .where(eq(schema.posts.orgId, ctx.org.id))
    .orderBy(desc(schema.posts.createdAt))
    .limit(100);
  return (
    <>
      <PageHead title="Social" sub="Write once, post a picture, PDF carousel or text to all your connected accounts — now or on a schedule." />
      <Body>
        <Social
          accounts={accountsFrom(conns)}
          canEdit={hasRole(ctx.role, "BUILDER")}
          initialPosts={posts.map((p) => ({
            ...p,
            scheduledAt: p.scheduledAt?.toISOString() ?? null,
            postedAt: p.postedAt?.toISOString() ?? null,
            createdAt: p.createdAt.toISOString(),
          }))}
        />
      </Body>
    </>
  );
}
