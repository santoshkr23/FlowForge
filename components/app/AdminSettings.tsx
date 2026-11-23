"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { api } from "@/lib/client";

type Key = { key: string; label: string; secret?: boolean; placeholder?: string; source: "panel" | "env" | "none"; preview: string };
type Group = { title: string; help?: string; keys: Key[] };

const BADGE: Record<Key["source"], [string, string]> = {
  panel: ["Saved here", "bg-ok-tint text-ok"],
  env: ["From server settings", "bg-spark-tint text-ink"],
  none: ["Not set", "bg-canvas text-ink-faint"],
};

export function AdminSettings({ initial, callbackUrl, mcpUrl }: { initial: Group[]; callbackUrl: string; mcpUrl: string }) {
  const [groups, setGroups] = useState(initial);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ group: string; ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState("");

  async function save(g: Group, clear?: string) {
    const values: Record<string, string | null> = {};
    if (clear) values[clear] = null;
    else for (const k of g.keys) if (draft[k.key]?.trim()) values[k.key] = draft[k.key].trim();
    if (!Object.keys(values).length) return setMsg({ group: g.title, ok: false, text: "Type a new value first" });
    setBusy(g.title);
    setMsg(null);
    try {
      const next = await api<Group[]>("/api/admin/settings", { body: { values } });
      setGroups(next);
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !(k in values))));
      setMsg({ group: g.title, ok: true, text: clear ? "Removed." : "Saved — works right away, no restart needed." });
    } catch (e) {
      setMsg({ group: g.title, ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const copy = (v: string) => {
    navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <KeyRound size={20} /> API keys &amp; settings
      </h2>
      <p className="mt-1 text-sm text-ink-soft">Stored encrypted. Values saved here take priority over the server&apos;s environment settings and apply immediately.</p>

      <div className="panel mt-4 space-y-2 p-4 text-sm">
        {[
          ["Redirect / callback URL for Google, LinkedIn, Facebook, X…", callbackUrl],
          ["Claude connector URL", mcpUrl],
        ].map(([label, v]) => (
          <div key={label} className="flex flex-wrap items-center gap-2">
            <span className="w-full text-ink-soft sm:w-80">{label}</span>
            <code className="min-w-0 flex-1 truncate rounded bg-canvas px-2 py-1 font-mono text-xs">{v}</code>
            <button className="btn-quiet px-2 py-1 text-xs" onClick={() => copy(v)}>
              {copied === v ? <Check size={13} /> : <Copy size={13} />} {copied === v ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="panel space-y-3 p-4">
            <div>
              <h3 className="font-medium">{g.title}</h3>
              {g.help && <p className="text-xs text-ink-faint">{g.help}</p>}
            </div>
            {g.keys.map((k) => {
              const [label, cls] = BADGE[k.source];
              return (
                <div key={k.key}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                    <label htmlFor={`s-${k.key}`}>{k.label}</label>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{label}</span>
                    {k.preview && <code className="font-mono text-[11px] text-ink-faint">{k.preview}</code>}
                    {k.source === "panel" && (
                      <button className="ml-auto text-xs text-bad underline" disabled={busy === g.title} onClick={() => confirm(`Remove ${k.label}?`) && save(g, k.key)}>
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    id={`s-${k.key}`}
                    className="input font-mono text-xs"
                    type={k.secret ? "password" : "text"}
                    autoComplete="off"
                    placeholder={k.source === "none" ? (k.placeholder ?? "") : "Type a new value to replace it"}
                    value={draft[k.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [k.key]: e.target.value })}
                  />
                </div>
              );
            })}
            <div className="flex items-center gap-3">
              <button className="btn-primary px-3 py-1.5" disabled={busy === g.title || !g.keys.some((k) => draft[k.key]?.trim())} onClick={() => save(g)}>
                {busy === g.title ? "Saving…" : "Save"}
              </button>
              {msg?.group === g.title && <span className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
