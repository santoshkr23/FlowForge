import { and, desc, eq, isNull } from "drizzle-orm";
import { requireCtx, hasRole } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { Body, PageHead } from "@/components/app/PageHead";
import { Team } from "@/components/app/Team";
import { PLANS, planAllows } from "@/lib/plans";
import { timeAgo } from "@/lib/format";

export const metadata = { title: "Team" };

const ACTION_TEXT: Record<string, string> = {
  "workflow.created": "created workflow",
  "workflow.deleted": "deleted workflow",
  "workflow.activated": "switched on",
  "workflow.deactivated": "switched off",
  "connection.created": "added connection",
  "connection.deleted": "deleted connection",
  "member.invited": "invited",
  "member.joined": "joined",
  "member.removed": "removed a member",
  "member.role_changed": "changed a role",
  "apikey.created": "created an API key",
  "apikey.revoked": "revoked an API key",
};

export default async function TeamPage() {
  const ctx = await requireCtx();
  const [members, pending, logs] = await Promise.all([
    db
      .select({ id: schema.memberships.id, role: schema.memberships.role, name: schema.users.name, email: schema.users.email, userId: schema.users.id })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.orgId, ctx.org.id)),
    db
      .select({ id: schema.invites.id, email: schema.invites.email, role: schema.invites.role })
      .from(schema.invites)
      .where(and(eq(schema.invites.orgId, ctx.org.id), isNull(schema.invites.acceptedAt))),
    planAllows(ctx.org.plan, "TEAMS")
      ? db
          .select({ id: schema.auditLogs.id, action: schema.auditLogs.action, target: schema.auditLogs.target, meta: schema.auditLogs.meta, at: schema.auditLogs.createdAt, who: schema.users.name, email: schema.users.email })
          .from(schema.auditLogs)
          .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
          .where(eq(schema.auditLogs.orgId, ctx.org.id))
          .orderBy(desc(schema.auditLogs.createdAt))
          .limit(100)
      : Promise.resolve(null),
  ]);
  const seats = PLANS[ctx.org.plan].maxSeats;

  return (
    <>
      <PageHead title="Team" sub={`${members.length} of ${seats < 0 ? "unlimited" : seats} seat${seats === 1 ? "" : "s"} used on the ${PLANS[ctx.org.plan].name} plan.`} />
      <Body>
        <Team members={members} pending={pending} canManage={hasRole(ctx.role, "ADMIN")} meId={ctx.user.id} />
        <section className="mt-10">
          <h2 className="mb-3 text-xl">Activity log</h2>
          {!logs ? (
            <p className="panel p-6 text-ink-soft">The activity log shows who changed what, and comes with the Teams plan.</p>
          ) : logs.length === 0 ? (
            <p className="panel p-6 text-ink-soft">Nothing yet.</p>
          ) : (
            <ul className="panel divide-y divide-line text-sm">
              {logs.map((l) => {
                const m = (l.meta ?? {}) as { name?: string };
                return (
                  <li key={l.id} className="flex gap-3 px-5 py-2.5">
                    <span className="w-24 shrink-0 text-ink-faint">{timeAgo(l.at)}</span>
                    <span>
                      <b className="font-medium">{l.who ?? l.email ?? "Someone"}</b> {ACTION_TEXT[l.action] ?? l.action} {m.name ?? (l.action.startsWith("member") ? l.target : "")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Body>
    </>
  );
}
