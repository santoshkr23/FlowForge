"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { AppIcon } from "../AppIcon";
import { CATALOG_BY_TYPE } from "@/lib/engine/catalog";
import { duration } from "@/lib/format";
import type { StepLog as Step } from "@/db/schema";

const DOT: Record<Step["status"], string> = { success: "bg-ok", error: "bg-bad", skipped: "bg-ink-faint" };
const WORD: Record<Step["status"], string> = { success: "done", error: "failed", skipped: "stopped by filter" };

export function StepLog({ steps, onSelect }: { steps: Step[]; onSelect?: (nodeId: string) => void }) {
  const [open, setOpen] = useState<number | null>(steps.findIndex((s) => s.status === "error"));
  if (!steps.length) return <p className="text-sm text-ink-soft">No steps ran.</p>;
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const meta = CATALOG_BY_TYPE[s.type];
        const isOpen = open === i;
        return (
          <li key={i} className="rounded-lg border border-line bg-paper">
            <button
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              aria-expanded={isOpen}
              onClick={() => {
                setOpen(isOpen ? null : i);
                onSelect?.(s.nodeId);
              }}
            >
              <ChevronRight size={16} className={`shrink-0 text-ink-faint transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
              <AppIcon app={meta?.app ?? "flow"} color={meta?.color} size={12} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label || meta?.name || s.type}</span>
              <span className="flex items-center gap-1.5 text-xs text-ink-soft">
                <span className={`h-2 w-2 rounded-full ${DOT[s.status]}`} aria-hidden />
                {WORD[s.status]}
              </span>
              <span className="w-14 text-right text-xs text-ink-faint">{duration(s.durationMs)}</span>
              {s.credits > 0 && <span className="text-xs text-ink-faint">{s.credits} cr</span>}
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-line p-3 text-xs">
                {s.error && <p className="rounded-md bg-bad-tint p-2 text-sm text-bad">{s.error}</p>}
                {s.input !== undefined && Object.keys(s.input as object).length > 0 && <Data title="Input" value={s.input} />}
                {s.output !== undefined && <Data title="Output" value={s.output} />}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Data({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 font-medium text-ink-soft">{title}</div>
      <pre className="max-h-72 overflow-auto rounded-md bg-canvas p-2 font-mono text-[12px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
