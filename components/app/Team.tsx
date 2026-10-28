"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

type Member = { id: string; role: string; name: string | null; email: string; userId: string };
const ROLE_HELP: Record<string, string> = {
  OWNER: "Everything, including billing",
  ADMIN: "Manage people, keys and all workflows",
  BUILDER: "Build and run workflows",
  VIEWER: "See workflows and runs",
};

export function Team({ members, pending, canManage, meId }: { members: Member[]; pending: { id: string; email: string; role: string }[]; canManage: boolean; meId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("BUILDER");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api<{ link: string; emailed: boolean }>("/api/team/invite", { body: { email, role } });
      setMsg({ ok: true, text: r.emailed ? `Invite sent to ${email}.` : `Invite created. Email isn't set up, so send this link to ${email} yourself:`, link: r.emailed ? undefined : r.link });
      setEmail("");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  async function setMemberRole(id: string, r: string) {
    await api(`/api/team/members/${id}`, { method: "PATCH", body: { role: r } });
    router.refresh();
  }
  async function remove(id: string) {
    if (!confirm("Remove this person from the workspace?")) return;
    await api(`/api/team/members/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <ul className="panel divide-y divide-line">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {m.name ?? m.email} {m.userId === meId && <span className="text-ink-faint">(you)</span>}
              </div>
              <div className="text-xs text-ink-faint">{m.email}</div>
            </div>
            {canManage && m.role !== "OWNER" && m.userId !== meId ? (
              <>
                <select aria-label={`Role for ${m.email}`} className="input w-auto" value={m.role} onChange={(e) => setMemberRole(m.id, e.target.value)}>
                  {["ADMIN", "BUILDER", "VIEWER"].map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0) + r.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
                <button className="text-sm text-bad underline" onClick={() => remove(m.id)}>
                  Remove
                </button>
              </>
            ) : (
              <span className="text-sm text-ink-soft" title={ROLE_HELP[m.role]}>
                {m.role.charAt(0) + m.role.slice(1).toLowerCase()}
              </span>
            )}
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-ink-soft">
            <span className="flex-1">{p.email}</span>
            <span className="text-sm">Invited · {p.role.toLowerCase()}</span>
          </li>
        ))}
      </ul>
      {canManage && (
        <form onSubmit={invite} className="panel space-y-3 p-5">
          <h2 className="text-lg">Invite someone</h2>
          <div>
            <label className="label" htmlFor="inv-email">
              Email
            </label>
            <input id="inv-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="inv-role">
              Role
            </label>
            <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {["ADMIN", "BUILDER", "VIEWER"].map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0) + r.slice(1).toLowerCase()} — {ROLE_HELP[r]}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-primary w-full">Send invite</button>
          {msg && (
            <div role="status" className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>
              {msg.text}
              {msg.link && <code className="mt-2 block break-all rounded bg-canvas p-2 text-xs text-ink">{msg.link}</code>}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
