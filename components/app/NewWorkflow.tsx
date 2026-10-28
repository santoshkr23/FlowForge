"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/client";
import type { Graph } from "@/db/schema";

export function NewWorkflow({ autoOpen }: { autoOpen?: boolean }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"" | "blank" | "ai">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (autoOpen) dlg.current?.showModal();
  }, [autoOpen]);

  async function blank() {
    setBusy("blank");
    const r = await api<{ id: string }>("/api/workflows", { body: { name: "Untitled workflow" } });
    router.push(`/app/workflows/${r.id}`);
  }

  async function fromPrompt(e: React.FormEvent) {
    e.preventDefault();
    setBusy("ai");
    setError("");
    try {
      const draft = await api<{ name: string; graph: Graph }>("/api/ai/build", { body: { prompt } });
      const r = await api<{ id: string }>("/api/workflows", { body: { name: draft.name } });
      await api(`/api/workflows/${r.id}`, { method: "PUT", body: { graph: draft.graph } });
      router.push(`/app/workflows/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  }

  return (
    <>
      <button className="btn-primary" onClick={() => dlg.current?.showModal()}>
        New workflow
      </button>
      <dialog ref={dlg} className="w-full max-w-lg rounded-xl border border-line p-0 backdrop:bg-ink/40">
        <div className="space-y-5 p-6">
          <h2 className="text-xl font-bold">New workflow</h2>
          <form onSubmit={fromPrompt} className="space-y-3">
            <label htmlFor="prompt" className="label flex items-center gap-2">
              <Sparkles size={16} className="text-wire" aria-hidden /> Describe it and let AI draft the steps
            </label>
            <textarea
              id="prompt"
              rows={4}
              className="input"
              placeholder="When someone fills my website form, add them to my Google Sheet and send me a Telegram message"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-bad">
                {error}
              </p>
            )}
            <button className="btn-primary w-full" disabled={!!busy || prompt.trim().length < 5}>
              {busy === "ai" ? "Drafting your workflow…" : "Draft with AI (5 credits)"}
            </button>
          </form>
          <div className="flex items-center gap-3 text-sm text-ink-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="flex gap-2">
            <button className="btn-quiet flex-1" onClick={blank} disabled={!!busy}>
              {busy === "blank" ? "Creating…" : "Start blank"}
            </button>
            <button className="btn-quiet flex-1" onClick={() => router.push("/app/templates")} disabled={!!busy}>
              Use a template
            </button>
          </div>
        </div>
        <form method="dialog" className="border-t border-line px-6 py-3 text-right">
          <button className="text-sm text-ink-soft underline">Close</button>
        </form>
      </dialog>
    </>
  );
}
