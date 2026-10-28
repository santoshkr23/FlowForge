"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { timeAgo } from "@/lib/format";

type Org = { id: string; name: string; plan: string; provider: string; creditsUsed: number; creditsMonthly: number; extra: number; workflows: number; createdAt: string };

export function AdminOrgRow({ org }: { org: Org }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const call = async (body: unknown) => {
    setErr("");
    try {
      await api("/api/admin", { body });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <tr>
      <td className="px-4 py-2">
        <div className="font-medium">{org.name}</div>
        <div className="text-xs text-ink-faint">created {timeAgo(org.createdAt)}</div>
      </td>
      <td className="px-4 py-2">
        <select aria-label={`Plan for ${org.name}`} className="input w-auto py-1" value={org.plan} onChange={(e) => call({ action: "setPlan", orgId: org.id, plan: e.target.value })}>
          {["FREE", "STARTER", "PRO", "TEAMS", "ENTERPRISE"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <div className="text-xs text-ink-faint">{org.provider.toLowerCase()}</div>
      </td>
      <td className="px-4 py-2">
        {org.creditsUsed.toLocaleString()} / {org.creditsMonthly.toLocaleString()}
        {org.extra > 0 && <span className="text-ink-faint"> +{org.extra.toLocaleString()}</span>}
      </td>
      <td className="px-4 py-2">{org.workflows}</td>
      <td className="px-4 py-2">
        <button className="text-wire underline" onClick={() => call({ action: "addCredits", orgId: org.id, credits: 10000 })}>
          Gift 10k credits
        </button>
        {err && <div className="text-xs text-bad">{err}</div>}
      </td>
    </tr>
  );
}

export function AdminUserRow({ user, self }: { user: { id: string; email: string; name: string | null; disabled: boolean; lastLoginAt: string | null }; self: boolean }) {
  const router = useRouter();
  return (
    <tr className={user.disabled ? "opacity-50" : ""}>
      <td className="px-4 py-2 font-medium">{user.name ?? "—"}</td>
      <td className="px-4 py-2">{user.email}</td>
      <td className="px-4 py-2 text-ink-faint">last sign-in {timeAgo(user.lastLoginAt)}</td>
      <td className="px-4 py-2 text-right">
        {!self && (
          <button
            className={user.disabled ? "text-wire underline" : "text-bad underline"}
            onClick={async () => {
              await api("/api/admin", { body: { action: "setDisabled", userId: user.id, disabled: !user.disabled } });
              router.refresh();
            }}
          >
            {user.disabled ? "Enable" : "Disable"}
          </button>
        )}
      </td>
    </tr>
  );
}
