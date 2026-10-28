"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export function UseTemplate({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="text-right">
      <button
        className="btn-quiet"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ id: string }>("/api/workflows", { body: { templateId: id } });
            router.push(`/app/workflows/${r.id}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Copying…" : "Use template"}
      </button>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
