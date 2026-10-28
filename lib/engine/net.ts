import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { StepError } from "./types";

/** Block requests to private / loopback / metadata addresses so users can't probe your servers (SSRF). */
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80")) return true;
    const v4 = l.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return v4 ? isPrivate(v4[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Throws unless the hostname resolves only to public addresses. */
export async function assertPublicHost(hostname: string) {
  if (process.env.ALLOW_PRIVATE_NETWORK === "1") return;
  const host = hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new StepError(`Could not resolve ${host}`);
  if (addrs.some((a) => isPrivate(a.address))) throw new StepError("Connections to private network addresses are blocked");
}

export async function assertPublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StepError(`Invalid URL: ${raw}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new StepError("Only http(s) URLs are allowed");
  if (process.env.ALLOW_PRIVATE_NETWORK === "1") return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new StepError(`Could not resolve ${host}`);
  if (addrs.some((a) => isPrivate(a.address))) throw new StepError("Requests to private network addresses are blocked");
  return url;
}

export type HttpResult = { status: number; headers: Record<string, string>; body: unknown };

export async function httpRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<HttpResult> {
  await assertPublicUrl(url);
  const headers: Record<string, string> = { "user-agent": "FlowForge/1.0", ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.body !== undefined && init.body !== "" && init.method && init.method !== "GET") {
    if (typeof init.body === "string") body = init.body;
    else {
      body = JSON.stringify(init.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
    }
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });
  const text = await res.text();
  const MAX = 2_000_000;
  const clipped = text.length > MAX ? text.slice(0, MAX) : text;
  let parsed: unknown = clipped;
  if ((res.headers.get("content-type") ?? "").includes("json")) {
    try {
      parsed = JSON.parse(clipped);
    } catch {
      /* keep text */
    }
  }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: parsed };
}

/** For calls to known SaaS APIs (no SSRF check needed — fixed host). Throws on non-2xx with the API's message. */
export async function apiCall<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* text */
  }
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string }; message?: string })?.error?.message ??
      (data as { message?: string })?.message ??
      (typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300));
    throw new StepError(`${res.status} ${msg}`);
  }
  return data as T;
}

/** Download a public file (SSRF-checked) with a size cap. */
export async function downloadFile(url: string, maxBytes = 256 * 1024 * 1024): Promise<{ data: Buffer; contentType: string; name: string }> {
  await assertPublicUrl(url);
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(240_000) });
  if (!res.ok || !res.body) throw new StepError(`Couldn't download the file (${res.status})`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new StepError(`File is larger than ${Math.round(maxBytes / 1048576)} MB`);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new StepError(`File is larger than ${Math.round(maxBytes / 1048576)} MB`);
    }
    chunks.push(Buffer.from(value));
  }
  const name = decodeURIComponent(new URL(res.url || url).pathname.split("/").pop() || "file");
  return { data: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "application/octet-stream", name };
}

/** Raw fetch to a known API that returns status, headers and parsed body; throws StepError on non-2xx. */
export async function apiRaw(url: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body, signal: init.signal ?? AbortSignal.timeout(60_000) });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* text */
  }
  if (!res.ok) {
    const d = data as { error?: { message?: string } | string; message?: string; errors?: unknown };
    const msg = (typeof d?.error === "object" ? d.error?.message : d?.error) ?? d?.message ?? (typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300));
    throw new StepError(`${res.status} ${msg}`);
  }
  return { status: res.status, headers: res.headers, data };
}
