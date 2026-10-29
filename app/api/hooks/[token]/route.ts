import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { startRun } from "@/lib/engine/queue";
import { findTrigger } from "@/lib/engine/graph";

export const maxDuration = 300;
const MAX_BODY = 1_000_000;

async function handle(req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const [wf] = await db.select().from(schema.workflows).where(eq(schema.workflows.webhookToken, params.token)).limit(1);
  if (!wf || wf.triggerType !== "webhook") return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  if (!wf.active) return NextResponse.json({ error: "This workflow is switched off" }, { status: 409 });

  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let parsed: unknown = text;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    try {
      parsed = JSON.parse(text || "{}");
    } catch {
      /* keep text */
    }
  } else if (ct.includes("application/x-www-form-urlencoded")) {
    parsed = Object.fromEntries(new URLSearchParams(text));
  }
  const url = new URL(req.url);
  const input = {
    method: req.method,
    body: parsed,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries([...req.headers.entries()].filter(([k]) => !["cookie", "authorization"].includes(k))),
  };

  const wait = findTrigger(wf.graph)?.data?.config?.respond === "result";
  const { executionId, outcome } = await startRun(wf, "webhook", input, { wait });
  if (!wait) return NextResponse.json({ accepted: true, executionId }, { status: 202 });
  if (outcome?.respond) return NextResponse.json(outcome.respond.body ?? null, { status: outcome.respond.status });
  if (outcome?.status === "ERROR") return NextResponse.json({ error: outcome.error, executionId }, { status: 500 });
  return NextResponse.json(outcome?.output ?? { ok: true });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
