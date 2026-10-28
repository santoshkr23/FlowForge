"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { timeAgo } from "@/lib/format";

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export function ApiKeys({ keys, canManage, allowed }: { keys: Key[]; canManage: boolean; allowed: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!allowed)
    return (
      <p className="panel p-6">
        API keys and MCP access come with the Pro plan.{" "}
        <Link href="/app/billing" className="text-wire underline">
          See plans
        </Link>
      </p>
    );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await api<{ key: string }>("/api/keys", { body: { name } });
      setFresh(r.key);
      setName("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function revoke(id: string) {
    if (!confirm("Revoke this key? Anything using it stops working immediately.")) return;
    await api(`/api/keys/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-3 text-xl">API keys</h2>
      {fresh && (
        <div role="status" className="mb-4 rounded-lg border border-ok bg-ok-tint p-4 text-sm">
          Copy your new key now — it won't be shown again.
          <code className="mt-2 block break-all rounded bg-paper p-2 font-mono text-xs">{fresh}</code>
        </div>
      )}
      <ul className="panel divide-y divide-line text-sm">
        {keys.length === 0 && <li className="px-5 py-4 text-ink-soft">No keys yet.</li>}
        {keys.map((k) => (
          <li key={k.id} className="flex items-center gap-4 px-5 py-3">
            <span className="flex-1 font-medium">{k.name}</span>
            <code className="font-mono text-xs text-ink-soft">{k.prefix}…</code>
            <span className="w-32 text-ink-faint">used {timeAgo(k.lastUsedAt)}</span>
            {canManage && (
              <button className="text-bad underline" onClick={() => revoke(k.id)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form onSubmit={create} className="mt-3 flex max-w-md gap-2">
          <input className="input" placeholder="Key name, e.g. Claude desktop" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Key name" />
          <button className="btn-primary shrink-0">Create key</button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </section>
  );
}
