/**
 * Mapping language: {{path.to.value}} with optional fallback {{a.b || "default"}}
 * and a few helpers: {{now}}, {{today}}, {{uuid}}, {{json(steps.x)}}, {{upper(x)}}, {{lower(x)}}, {{length(x)}}.
 * A field that is exactly one {{…}} keeps the raw type (object, number…); otherwise values are interpolated as text.
 */
import { randomUUID } from "node:crypto";

export type Scope = Record<string, unknown>;

const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;

export function getPath(obj: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const FNS: Record<string, (v: unknown) => unknown> = {
  json: (v) => JSON.stringify(v),
  upper: (v) => String(v ?? "").toUpperCase(),
  lower: (v) => String(v ?? "").toLowerCase(),
  trim: (v) => String(v ?? "").trim(),
  length: (v) => (Array.isArray(v) || typeof v === "string" ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0),
  number: (v) => Number(v),
  first: (v) => (Array.isArray(v) ? v[0] : v),
  last: (v) => (Array.isArray(v) ? v[v.length - 1] : v),
};

function evalTerm(term: string, scope: Scope): unknown {
  term = term.trim();
  if (/^".*"$|^'.*'$/.test(term)) return term.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(term)) return Number(term);
  if (term === "now") return new Date().toISOString();
  if (term === "today") return new Date().toISOString().slice(0, 10);
  if (term === "uuid") return randomUUID();
  const fn = term.match(/^(\w+)\((.*)\)$/);
  if (fn && FNS[fn[1]]) return FNS[fn[1]](evalTerm(fn[2], scope));
  return getPath(scope, term);
}

export function evalExpr(expr: string, scope: Scope): unknown {
  for (const alt of expr.split("||")) {
    const v = evalTerm(alt, scope);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function stringify(v: unknown) {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function resolveString(s: string, scope: Scope): unknown {
  const whole = s.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (whole) return evalExpr(whole[1], scope);
  return s.replace(EXPR, (_, e: string) => stringify(evalExpr(e, scope)));
}

/** Deep-resolve every string inside a value. */
export function resolveDeep<T>(value: T, scope: Scope): T {
  if (typeof value === "string") return resolveString(value, scope) as T;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, scope)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDeep(v, scope)])) as T;
  }
  return value;
}

/** Parse a JSON config field (stored as text) then resolve templates inside it. */
export function resolveJsonField(raw: unknown, scope: Scope): unknown {
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") return resolveDeep(raw, scope);
  try {
    return resolveDeep(JSON.parse(raw), scope);
  } catch {
    // Not valid JSON before resolving — resolve first, then try again.
    const s = resolveString(raw, scope);
    if (typeof s !== "string") return s;
    try {
      return JSON.parse(s);
    } catch {
      throw new Error("Field is not valid JSON");
    }
  }
}
