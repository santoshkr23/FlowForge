import { desc, eq } from "drizzle-orm";
import { requireCtx, hasRole } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead } from "@/components/app/PageHead";
import { Connections } from "@/components/app/Connections";
import { headers } from "next/headers";
import { encryptionKeyProblem } from "@/lib/crypto";
import { PROVIDERS, providerConfigured, redirectUri } from "@/lib/oauth/providers";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage(props: { searchParams: Promise<{ add?: string; connected?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  const h = await headers();
  const callbackUrl = redirectUri({ headers: h });
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
        {encryptionKeyProblem() && (
          <p role="alert" className="mb-4 rounded-lg bg-bad-tint p-3 text-sm text-bad">
            Connections can't be saved until the site owner fixes this: {encryptionKeyProblem()} In Render: your service → Environment → ENCRYPTION_KEY → paste a 64-character key → Save, then redeploy.
          </p>
        )}
        <Connections
          initial={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
          canEdit={hasRole(ctx.role, "BUILDER")}
          openApp={searchParams.add}
          oauthReady={Object.keys(PROVIDERS).filter(providerConfigured)}
          flash={flash}
          callbackUrl={callbackUrl}
        />
      </Body>
    </>
  );
}
