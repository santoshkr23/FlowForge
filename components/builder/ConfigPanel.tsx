"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { AppIcon } from "../AppIcon";
import { APPS, CATALOG, CATALOG_BY_TYPE, connectionApps, type Field } from "@/lib/engine/catalog";
import { PLANS, planAllows } from "@/lib/plans";
import type { PlanId, StepLog } from "@/db/schema";
import type { StepData } from "./StepNode";

type Conn = { id: string; app: string; name: string };
type Upstream = { id: string; label: string; moduleType: string };

/** Flatten a sample value into insertable {{paths}}. */
function paths(prefix: string, v: unknown, depth = 0, out: { path: string; preview: string }[] = []) {
  if (out.length > 60) return out;
  if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) {
    for (const [k, val] of Object.entries(v)) paths(`${prefix}.${k}`, val, depth + 1, out);
  } else {
    const preview = v === undefined ? "" : JSON.stringify(v)?.slice(0, 40) ?? "";
    out.push({ path: prefix, preview });
    if (Array.isArray(v) && v[0] && typeof v[0] === "object" && depth < 3) paths(`${prefix}[0]`, v[0], depth + 1, out);
  }
  return out;
}

export function ConfigPanel(props: {
  nodeId: string;
  data: StepData;
  plan: PlanId;
  connections: Conn[];
  upstream: Upstream[];
  insideIterator: boolean;
  lastSteps: StepLog[];
  webhookUrl: string | null;
  readOnly: boolean;
  onChange: (patch: Partial<StepData>) => void;
  onChangeType: (moduleType: string) => void;
  onDelete: () => void;
}) {
  const { data, plan, connections, upstream, lastSteps, onChange, readOnly } = props;
  const meta = CATALOG_BY_TYPE[data.moduleType];
  const focused = useRef<{ key: string; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const [copied, setCopied] = useState(false);

  const setField = (key: string, value: unknown) => onChange({ config: { ...data.config, [key]: value } });

  const mappable = useMemo(() => {
    const groups: { title: string; items: { path: string; preview: string }[] }[] = [];
    const last = (id: string) => [...lastSteps].reverse().find((s) => s.nodeId === id)?.output;
    for (const u of upstream) {
      const m = CATALOG_BY_TYPE[u.moduleType];
      const sample = last(u.id);
      const base = m?.trigger ? "trigger" : `steps.${u.id}`;
      const items =
        sample !== undefined && sample !== null
          ? paths(base, sample)
          : m?.trigger && u.moduleType === "trigger.webhook"
            ? ["body", "query", "headers"].map((k) => ({ path: `trigger.${k}`, preview: "" }))
            : (m?.outputs ?? []).map((k) => ({ path: m?.trigger ? `trigger.${k}` : `${base}.${k}`, preview: "" }));
      if (m?.trigger && u.moduleType === "trigger.manual" && !sample) items.unshift({ path: "trigger", preview: "whole input" });
      groups.push({ title: u.label || m?.name || u.id, items });
    }
    if (props.insideIterator) groups.unshift({ title: "Current item", items: [{ path: "item", preview: "" }, { path: "index", preview: "" }] });
    groups.push({ title: "Variables & helpers", items: ["vars.", "now", "today", "uuid"].map((p) => ({ path: p, preview: "" })) });
    return groups;
  }, [upstream, lastSteps, props.insideIterator]);

  function insert(path: string) {
    const f = focused.current;
    const token = `{{${path}}}`;
    if (!f) {
      navigator.clipboard?.writeText(token);
      return;
    }
    const { el, key } = f;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setField(key, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  if (!meta) return <div className="p-4 text-sm text-bad">Unknown step type “{data.moduleType}”. Delete it and add a new step.</div>;
  const locked = meta.minPlan && !planAllows(plan, meta.minPlan);

  const visible = (f: Field) => !f.showIf || (data.config[f.showIf.key] ?? CATALOG_BY_TYPE[data.moduleType]?.fields.find((x) => x.key === f.showIf!.key)?.default) === f.showIf.equals;

  const control = (f: Field) => {
    const value = data.config[f.key] ?? f.default ?? "";
    const common = {
      id: `f-${f.key}`,
      disabled: readOnly,
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => (focused.current = { key: f.key, el: e.currentTarget }),
    };
    switch (f.type) {
      case "select":
        return (
          <select id={common.id} disabled={readOnly} className="input" value={String(value)} onChange={(e) => setField(f.key, e.target.value)}>
            {f.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "boolean":
        return (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={readOnly} checked={value === true || value === "true"} onChange={(e) => setField(f.key, e.target.checked)} />
            Yes
          </label>
        );
      case "connection": {
        const list = connections.filter((c) => connectionApps(f).includes(c.app));
        return (
          <div className="flex gap-2">
            <select id={common.id} disabled={readOnly} className="input" value={String(value)} onChange={(e) => setField(f.key, e.target.value)}>
              <option value="">{f.required ? "Choose a connection" : "None"}</option>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Link href={`/app/connections?add=${connectionApps(f).slice(-1)[0]}`} target="_blank" className="btn-quiet shrink-0">
              Add
            </Link>
          </div>
        );
      }
      case "textarea":
      case "json":
      case "code":
        return (
          <textarea
            {...common}
            rows={f.type === "code" ? 10 : f.type === "json" ? 5 : 4}
            spellCheck={f.type === "textarea"}
            className={`input ${f.type !== "textarea" ? "font-mono text-[13px]" : ""}`}
            placeholder={f.placeholder}
            value={String(value)}
            onChange={(e) => setField(f.key, e.target.value)}
          />
        );
      case "number":
        return <input {...common} className="input" placeholder={f.placeholder} value={String(value)} onChange={(e) => setField(f.key, e.target.value)} inputMode="decimal" />;
      default:
        return <input {...common} className="input" placeholder={f.placeholder} value={String(value)} onChange={(e) => setField(f.key, e.target.value)} />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line p-4">
        <AppIcon app={meta.app} color={meta.color} size={18} />
        <div className="min-w-0 flex-1">
          <input
            aria-label="Step name"
            disabled={readOnly}
            className="w-full bg-transparent font-display text-lg font-bold focus:outline-none"
            value={data.label ?? ""}
            placeholder={meta.name}
            onChange={(e) => onChange({ label: e.target.value })}
          />
          <p className="text-xs text-ink-faint">
            {meta.name} · {meta.credits ? `${meta.credits} credit${meta.credits > 1 ? "s" : ""} per run` : "free"} · id <code>{props.nodeId}</code>
          </p>
        </div>
        {!meta.trigger && !readOnly && (
          <button className="rounded-lg p-2 text-ink-soft hover:bg-bad-tint hover:text-bad" onClick={props.onDelete} aria-label="Delete step">
            <Trash2 size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-sm text-ink-soft">{meta.description}</p>
        {locked && (
          <p className="rounded-lg bg-spark-tint p-3 text-sm">
            This step runs on the {PLANS[meta.minPlan!].name} plan and above.{" "}
            <Link href="/app/billing" className="underline">
              Upgrade
            </Link>
          </p>
        )}

        {meta.trigger && !readOnly && (
          <div>
            <label className="label" htmlFor="trigger-type">
              Trigger
            </label>
            <select id="trigger-type" className="input" value={data.moduleType} onChange={(e) => props.onChangeType(e.target.value)}>
              <optgroup label="Start">
                {CATALOG.filter((m) => m.trigger && !m.poll).map((m) => (
                  <option key={m.type} value={m.type}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Watch for something new">
                {CATALOG.filter((m) => m.poll).map((m) => (
                  <option key={m.type} value={m.type}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        )}

        {data.moduleType === "trigger.webhook" && props.webhookUrl && (
          <div>
            <span className="label">Your webhook URL</span>
            <div className="flex gap-2">
              <code className="input truncate font-mono text-xs">{props.webhookUrl}</code>
              <button
                className="btn-quiet shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(props.webhookUrl!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Copy size={14} aria-hidden />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-faint">Switch the workflow on, then send any GET or POST to this address. JSON, form and query data all work.</p>
          </div>
        )}

        {meta.fields.filter(visible).map((f) => (
          <div key={f.key}>
            <label className="label" htmlFor={`f-${f.key}`}>
              {f.label}
              {f.required && <span className="text-bad"> *</span>}
            </label>
            {control(f)}
            {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
            {f.type === "connection" && APPS[connectionApps(f).slice(-1)[0]] && !connections.some((c) => connectionApps(f).includes(c.app)) && (
              <p className="mt-1 text-xs text-ink-faint">No {APPS[connectionApps(f).slice(-1)[0]].name} connection yet. Add one, then come back and pick it.</p>
            )}
          </div>
        ))}

        {!meta.trigger && (
          <div>
            <label className="label" htmlFor="on-error">
              If this step fails
            </label>
            <select id="on-error" disabled={readOnly} className="input" value={String(data.config.__onError ?? "stop")} onChange={(e) => setField("__onError", e.target.value)}>
              <option value="stop">Stop the run</option>
              <option value="continue">Note the error and continue</option>
            </select>
          </div>
        )}

        {!meta.trigger && mappable.length > 0 && (
          <section className="rounded-lg border border-line p-3">
            <h3 className="font-sans text-sm font-semibold">Use data from earlier steps</h3>
            <p className="mb-2 text-xs text-ink-soft">Click a field above, then pick a value to insert it. Run the workflow once to see real values here.</p>
            <div className="max-h-64 space-y-3 overflow-y-auto">
              {mappable.map((g) => (
                <div key={g.title}>
                  <div className="mb-1 text-xs font-medium text-ink-soft">{g.title}</div>
                  <div className="flex flex-wrap gap-1">
                    {g.items.map((it) => (
                      <button
                        key={it.path}
                        type="button"
                        disabled={readOnly}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insert(it.path)}
                        title={it.preview || it.path}
                        className="max-w-full truncate rounded-md bg-wire-tint px-2 py-0.5 font-mono text-[11px] text-wire-dark hover:bg-wire hover:text-white"
                      >
                        {it.path.split(".").slice(-2).join(".")}
                        {it.preview && <span className="ml-1 opacity-60">{it.preview}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
