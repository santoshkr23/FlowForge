"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "../AppIcon";
import { APPS, CATALOG } from "@/lib/engine/catalog";
import { api } from "@/lib/client";
import { timeAgo } from "@/lib/format";

const SOCIAL = ["linkedin", "facebook", "twitter", "bluesky", "mastodon", "discord", "slack"];

type Row = { id: string; app: string; name: string; createdAt: string };

const ICON_APP: Record<string, string> = { google: "sheets", smtp: "mail", google_oauth: "google", http_auth: "globe" };
const colorFor = (app: string) => CATALOG.find((m) => m.app === (ICON_APP[app] ?? app) || m.fields.some((f) => f.type === "connection" && f.app?.split(",")[0] === app))?.color;
const iconFor = (app: string) => ICON_APP[app] ?? app;

export function Connections(props: { initial: Row[]; canEdit: boolean; openApp?: string; oauthReady: string[]; flash?: { ok: boolean; text: string }; callbackUrl: string }) {
  const { canEdit, oauthReady } = props;
  const [rows, setRows] = useState(props.initial);
  const [app, setApp] = useState<string | null>(props.openApp && APPS[props.openApp] ? props.openApp : null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const appList = useMemo(
    () =>
      Object.entries(APPS)
        .filter(([, a]) => !q || a.name.toLowerCase().includes(q.toLowerCase()))
        .sort(([, a], [, b]) => a.name.localeCompare(b.name)),
    [q],
  );

  function start(a: string) {
    setApp(a);
    setValues({});
    setName(`My ${APPS[a].name.replace(/ \(.*\)$/, "")}`);
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

  const def = app ? APPS[app] : null;
  const canOAuth = !!def?.oauth && oauthReady.includes(def.oauth);

  return (
    <div className="space-y-4">
      {props.flash && (
        <p role="status" className={`rounded-lg p-3 text-sm ${props.flash.ok ? "bg-ok-tint text-ok" : "bg-bad-tint text-bad"}`}>
          {props.flash.text}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <section>
          {rows.length === 0 ? (
            <p className="panel p-8 text-ink-soft">No connections yet. Add one for each app your workflows talk to.</p>
          ) : (
            <ul className="panel divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <AppIcon app={iconFor(r.app)} color={colorFor(r.app)} size={14} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="text-xs text-ink-faint">
                      {APPS[r.app]?.name ?? r.app} · added {timeAgo(r.createdAt)}
                    </div>
                  </div>
                  {canEdit && APPS[r.app]?.oauth && oauthReady.includes(APPS[r.app].oauth!) && (
                    <a className="text-sm text-wire underline" href={`/api/oauth/start?app=${r.app}&name=${encodeURIComponent(r.name.replace(/ \(.*\)$/, ""))}`}>
                      Reconnect
                    </a>
                  )}
                  {canEdit && (
                    <button className="text-sm text-bad underline" onClick={() => remove(r.id)}>
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rows.some((r) => SOCIAL.includes(r.app)) && (
            <a href="/app/social" className="panel mt-3 flex items-center justify-between px-5 py-3 text-sm hover:border-wire">
              <span>Write and schedule posts for your connected social accounts</span>
              <span className="font-medium text-wire">Open Social →</span>
            </a>
          )}
        </section>

        {canEdit && (
          <section className="panel p-5">
            {!app || !def ? (
              <>
                <h2 className="text-lg">Add a connection</h2>
                <input className="input mt-3" placeholder="Search apps" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search apps" />
                <div className="mt-3 grid max-h-[28rem] grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {appList.map(([k, a]) => (
                    <button key={k} onClick={() => start(k)} className="flex items-center gap-2 rounded-lg border border-line p-2 text-left text-sm hover:border-wire">
                      <AppIcon app={iconFor(k)} color={colorFor(k)} size={12} />
                      <span className="min-w-0 truncate" title={a.name}>
                        {k === "google" ? "Google (service account)" : a.name.replace(/ \(.*\)$/, "")}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <form onSubmit={save} className="space-y-3">
                <h2 className="flex items-center gap-2 text-lg">
                  <AppIcon app={iconFor(app)} color={colorFor(app)} size={14} /> {def.name}
                </h2>
                <p className="rounded-lg bg-canvas p-3 text-sm text-ink-soft">{def.help}</p>
                <div>
                  <label className="label" htmlFor="c-name">
                    Name
                  </label>
                  <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>

                {def.oauth && (
                  <div className="rounded-lg border border-line p-3 text-xs">
                    <div className="font-medium text-ink">Callback / redirect URL</div>
                    <p className="mt-0.5 text-ink-soft">Register exactly this in the {def.name.replace(/ \(.*\)$/, "")} developer app (site owner only).</p>
                    <div className="mt-1.5 flex gap-2">
                      <code className="min-w-0 flex-1 break-all rounded bg-canvas px-2 py-1 font-mono">{props.callbackUrl}</code>
                      <button type="button" className="btn-quiet shrink-0 px-2 py-1 text-xs" onClick={() => navigator.clipboard.writeText(props.callbackUrl)}>
                        Copy
                      </button>
                    </div>
                  </div>
                )}

                {def.oauth &&
                  (canOAuth ? (
                    <a className="btn-primary w-full" href={`/api/oauth/start?app=${app}&name=${encodeURIComponent(name)}`}>
                      Connect with {def.name.replace(/ \(.*\)$/, "").split(" & ")[0]}
                    </a>
                  ) : (
                    <p className="rounded-lg bg-spark-tint p-3 text-sm">
                      One-click sign-in for {def.name.replace(/ \(.*\)$/, "")} isn't switched on for this site yet. The site owner needs to add its developer keys (see the README).
                      {def.fields.length > 0 && " Meanwhile you can paste a token below."}
                    </p>
                  ))}

                {def.fields.length > 0 && (
                  <>
                    {def.oauth && canOAuth && <p className="text-center text-xs text-ink-faint">or paste a token</p>}
                    {def.fields.map((f) => (
                      <div key={f.key}>
                        <label className="label" htmlFor={`c-${f.key}`}>
                          {f.label}
                          {f.optional && <span className="font-normal text-ink-faint"> (optional)</span>}
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
                  </>
                )}
                {error && (
                  <p role="alert" className="text-sm text-bad">
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  {def.fields.length > 0 && (
                    <button className={`${def.oauth && canOAuth ? "btn-quiet" : "btn-primary"} flex-1`} disabled={busy}>
                      {busy ? "Saving…" : "Save connection"}
                    </button>
                  )}
                  <button type="button" className="btn-quiet" onClick={() => setApp(null)}>
                    Back
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
