"use client";

import { useState } from "react";
import { AppIcon } from "../AppIcon";
import { APPS, CATALOG } from "@/lib/engine/catalog";
import { api } from "@/lib/client";
import { timeAgo } from "@/lib/format";

type Row = { id: string; app: string; name: string; createdAt: string };
const colorFor = (app: string) => CATALOG.find((m) => m.app === app || (app === "google" && m.app === "sheets") || (app === "smtp" && m.app === "mail"))?.color;

export function Connections({ initial, canEdit, openApp }: { initial: Row[]; canEdit: boolean; openApp?: string }) {
  const [rows, setRows] = useState(initial);
  const [app, setApp] = useState<string | null>(openApp && APPS[openApp] ? openApp : null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function start(a: string) {
    setApp(a);
    setValues({});
    setName(`My ${APPS[a].name}`);
    setError("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!app) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<Row>("/api/connections", { body: { app, name, values } });
      setRows([{ ...r, createdAt: new Date().toISOString() }, ...rows]);
      setApp(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this connection? Steps that use it will fail until you pick another one.")) return;
    await api(`/api/connections/${id}`, { method: "DELETE" });
    setRows(rows.filter((r) => r.id !== id));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        {rows.length === 0 ? (
          <p className="panel p-8 text-ink-soft">No connections yet. Add one for each app your workflows talk to.</p>
        ) : (
          <ul className="panel divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <AppIcon app={r.app} color={colorFor(r.app)} size={14} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-ink-faint">
                    {APPS[r.app]?.name ?? r.app} · added {timeAgo(r.createdAt)}
                  </div>
                </div>
                {canEdit && (
                  <button className="text-sm text-bad underline" onClick={() => remove(r.id)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit && (
        <section className="panel p-5">
          {!app ? (
            <>
              <h2 className="text-lg">Add a connection</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {Object.entries(APPS).map(([k, a]) => (
                  <button key={k} onClick={() => start(k)} className="flex items-center gap-2 rounded-lg border border-line p-2 text-left text-sm hover:border-wire">
                    <AppIcon app={k} color={colorFor(k)} size={12} />
                    {a.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form onSubmit={save} className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg">
                <AppIcon app={app} color={colorFor(app)} size={14} /> {APPS[app].name}
              </h2>
              <p className="rounded-lg bg-canvas p-3 text-sm text-ink-soft">{APPS[app].help}</p>
              <div>
                <label className="label" htmlFor="c-name">
                  Name
                </label>
                <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              {APPS[app].fields.map((f) => (
                <div key={f.key}>
                  <label className="label" htmlFor={`c-${f.key}`}>
                    {f.label}
                  </label>
                  {f.textarea ? (
                    <textarea id={`c-${f.key}`} rows={6} className="input font-mono text-xs" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                  ) : (
                    <input
                      id={`c-${f.key}`}
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      className="input"
                      placeholder={f.placeholder}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
              {error && (
                <p role="alert" className="text-sm text-bad">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button className="btn-primary flex-1" disabled={busy}>
                  {busy ? "Saving…" : "Save connection"}
                </button>
                <button type="button" className="btn-quiet" onClick={() => setApp(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
