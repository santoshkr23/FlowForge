"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { AppIcon } from "../AppIcon";
import { CATALOG, CATEGORIES, type ModuleMeta } from "@/lib/engine/catalog";
import { planAllows, PLANS } from "@/lib/plans";
import type { PlanId } from "@/db/schema";

export function Palette({ plan, onPick, triggers }: { plan: PlanId; onPick: (m: ModuleMeta) => void; triggers?: boolean }) {
  const [q, setQ] = useState("");
  const list = CATALOG.filter((m) => !!m.trigger === !!triggers).filter((m) => !q || `${m.name} ${m.description} ${m.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <input className="input" placeholder={triggers ? "Search triggers" : "Search apps and steps"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search steps" autoFocus />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {CATEGORIES.map((cat) => {
          const items = list.filter((m) => m.category === cat);
          if (!items.length) return null;
          return (
            <section key={cat} className="mb-4">
              <h3 className="mb-1.5 px-1 font-sans text-xs font-semibold text-ink-faint">{cat}</h3>
              <ul className="space-y-1">
                {items.map((m) => {
                  const locked = m.minPlan && !planAllows(plan, m.minPlan);
                  return (
                    <li key={m.type}>
                      <button
                        onClick={() => onPick(m)}
                        className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left hover:bg-canvas"
                        title={locked ? `Needs the ${PLANS[m.minPlan!].name} plan to run` : m.description}
                      >
                        <AppIcon app={m.app} color={m.color} size={14} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 text-sm font-medium">
                            {m.name}
                            {locked && <Lock size={12} className="text-ink-faint" aria-label={`${PLANS[m.minPlan!].name} plan`} />}
                          </span>
                          <span className="line-clamp-2 text-xs text-ink-soft">{m.description}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!list.length && <p className="px-1 text-sm text-ink-soft">Nothing matches. Use the HTTP request step to reach any app with an API.</p>}
      </div>
    </div>
  );
}
