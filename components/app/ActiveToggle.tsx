"use client";

import { useState } from "react";
import { api } from "@/lib/client";

export function ActiveToggle({ id, active, disabled, onChange }: { id: string; active: boolean; disabled?: boolean; onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ active: boolean }>(`/api/workflows/${id}/activate`, { body: { active: !on } });
      setOn(r.active);
      onChange?.(r.active);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        role="switch"
        aria-checked={on}
        aria-label={on ? "Switch off" : "Switch on"}
        title={disabled ? "Manual workflows run when you start them" : undefined}
        disabled={disabled || busy}
        onClick={toggle}
        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-ok" : "bg-line"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
      {error && (
        <span role="alert" className="max-w-xs text-xs text-bad">
          {error}
        </span>
      )}
    </div>
  );
}
