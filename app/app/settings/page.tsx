import { desc, eq } from "drizzle-orm";
import { requireCtx, hasRole } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead } from "@/components/app/PageHead";
import { ApiKeys } from "@/components/app/ApiKeys";
import { planAllows } from "@/lib/plans";

export const metadata = { title: "API & MCP" };

export default async function Settings() {
  const ctx = await requireCtx();
  const keys = await db
    .select({ id: schema.apiKeys.id, name: schema.apiKeys.name, prefix: schema.apiKeys.prefix, createdAt: schema.apiKeys.createdAt, lastUsedAt: schema.apiKeys.lastUsedAt })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.orgId, ctx.org.id))
    .orderBy(desc(schema.apiKeys.createdAt));
  const stores = await db.select({ name: schema.dataStores.name, records: schema.dataStores.records, updatedAt: schema.dataStores.updatedAt }).from(schema.dataStores).where(eq(schema.dataStores.orgId, ctx.org.id));
  const base = process.env.APP_URL ?? "http://localhost:3000";

  return (
    <>
      <PageHead title="API & MCP" sub="Run your workflows from your own code, or from Claude, ChatGPT and other AI assistants." />
      <Body>
        <ApiKeys
          keys={keys.map((k) => ({ ...k, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null }))}
          canManage={hasRole(ctx.role, "ADMIN")}
          allowed={planAllows(ctx.org.plan, "PRO")}
        />

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="panel p-5">
            <h2 className="text-lg">Use from an AI assistant (MCP)</h2>
            <p className="mt-2 text-sm text-ink-soft">Add a remote MCP server in Claude, ChatGPT or any MCP client:</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="font-medium">Server URL</dt>
                <dd>
                  <code className="block break-all rounded bg-canvas p-2 font-mono text-xs">{base}/api/mcp</code>
                </dd>
              </div>
              <div>
                <dt className="font-medium">Header</dt>
                <dd>
                  <code className="block rounded bg-canvas p-2 font-mono text-xs">Authorization: Bearer ff_your_key</code>
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-ink-soft">The assistant can list your workflows, run one with input, and read run results.</p>
          </div>
          <div className="panel p-5">
            <h2 className="text-lg">REST API</h2>
            <pre className="mt-3 overflow-x-auto rounded bg-canvas p-3 font-mono text-xs leading-relaxed">{`# list workflows
curl ${base}/api/v1/workflows \\
  -H "Authorization: Bearer ff_your_key"

# run one and get its output
curl -X POST ${base}/api/v1/workflows/WORKFLOW_ID/run \\
  -H "Authorization: Bearer ff_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Asha"}'

# fetch a run's full log
curl ${base}/api/v1/executions/RUN_ID \\
  -H "Authorization: Bearer ff_your_key"`}</pre>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-xl">Data stores</h2>
          {stores.length === 0 ? (
            <p className="panel p-6 text-sm text-ink-soft">Workflows can remember values between runs with the Data store steps. Stores appear here once a workflow saves something.</p>
          ) : (
            <ul className="panel divide-y divide-line text-sm">
              {stores.map((s) => (
                <li key={s.name} className="px-5 py-3">
                  <details>
                    <summary className="cursor-pointer">
                      <b className="font-medium">{s.name}</b> <span className="text-ink-soft">· {Object.keys(s.records).length} keys</span>
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-canvas p-2 font-mono text-xs">{JSON.stringify(s.records, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Body>
    </>
  );
}
