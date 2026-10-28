import { desc, eq } from "drizzle-orm";
import { requireCtx, hasRole } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead } from "@/components/app/PageHead";
import { Connections } from "@/components/app/Connections";
import { PROVIDERS, providerConfigured } from "@/lib/oauth/providers";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage({ searchParams }: { searchParams: { add?: string; connected?: string; error?: string } }) {
  const ctx = await requireCtx();
  const rows = await db
    .select({ id: schema.connections.id, app: schema.connections.app, name: schema.connections.name, createdAt: schema.connections.createdAt })
    .from(schema.connections)
    .where(eq(schema.connections.orgId, ctx.org.id))
    .orderBy(desc(schema.connections.createdAt));
  const flash = searchParams.connected
    ? { ok: true, text: `Connected: ${searchParams.connected}` }
    : searchParams.error
      ? { ok: false, text: searchParams.error }
      : undefined;
  return (
    <>
      <PageHead title="Connections" sub="Saved logins and keys for your apps. They're encrypted and shared by everyone in this workspace." />
      <Body>
        <Connections
          initial={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
          canEdit={hasRole(ctx.role, "BUILDER")}
          openApp={searchParams.add}
          oauthReady={Object.keys(PROVIDERS).filter(providerConfigured)}
          flash={flash}
        />
      </Body>
    </>
  );
}
