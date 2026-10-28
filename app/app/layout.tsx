import { eq } from "drizzle-orm";
import { requireCtx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { creditsRemaining, ensureCreditWindow } from "@/lib/credits";
import { Sidebar } from "@/components/app/Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const org = await ensureCreditWindow(ctx.org);
  const orgs = await db
    .select({ id: schema.orgs.id, name: schema.orgs.name })
    .from(schema.memberships)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, ctx.user.id));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        user={{ name: ctx.user.name, email: ctx.user.email }}
        org={{ id: org.id, name: org.name, plan: org.plan }}
        orgs={orgs}
        credits={{ left: creditsRemaining(org), total: org.creditsMonthly + org.extraCredits }}
        isSuperAdmin={ctx.isSuperAdmin}
      />
      <main className="min-w-0 flex-1 md:h-screen md:overflow-y-auto">{children}</main>
    </div>
  );
}
