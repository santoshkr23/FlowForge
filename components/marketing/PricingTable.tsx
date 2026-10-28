"use client";

import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { PLANS, CREDIT_PACK } from "@/lib/plans";
import type { PlanId } from "@/db/schema";

const ORDER: PlanId[] = ["FREE", "STARTER", "PRO", "TEAMS", "ENTERPRISE"];

export function PricingTable({ defaultCurrency = "INR" }: { defaultCurrency?: "INR" | "USD" }) {
  const [cur, setCur] = useState<"INR" | "USD">(defaultCurrency);
  const price = (id: PlanId) => {
    const p = PLANS[id];
    const v = cur === "INR" ? p.inr : p.usd;
    if (v < 0) return "Let's talk";
    if (v === 0) return cur === "INR" ? "₹0" : "$0";
    return cur === "INR" ? `₹${v.toLocaleString("en-IN")}` : `$${v}`;
  };

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <span className="text-sm text-ink-soft">Show prices in</span>
        <div className="inline-flex rounded-lg border border-line bg-paper p-1" role="radiogroup" aria-label="Currency">
          {(["INR", "USD"] as const).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={cur === c}
              onClick={() => setCur(c)}
              className={`rounded-md px-3 py-1 text-sm ${cur === c ? "bg-ink text-white" : "text-ink-soft"}`}
            >
              {c === "INR" ? "₹ Rupees" : "$ Dollars"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {ORDER.map((id) => {
          const p = PLANS[id];
          return (
            <div key={id} className={`flex flex-col rounded-xl border bg-paper p-5 ${p.highlight ? "border-wire ring-2 ring-wire/15" : "border-line"}`}>
              <h3 className="text-lg">{p.name}</h3>
              <p className="text-sm text-ink-soft">{p.tagline}</p>
              <p className="mt-4 font-display text-3xl font-bold">
                {price(id)}
                {p.usd > 0 && <span className="ml-1 font-sans text-sm font-normal text-ink-soft">/ month</span>}
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              {id === "ENTERPRISE" ? (
                <a href="mailto:sales@example.com" className="btn-quiet mt-6">
                  Contact sales
                </a>
              ) : (
                <Link href={id === "FREE" ? "/signup" : `/signup?plan=${id}`} className={`${p.highlight ? "btn-primary" : "btn-quiet"} mt-6`}>
                  {id === "FREE" ? "Start free" : `Choose ${p.name}`}
                </Link>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Need more? Add {CREDIT_PACK.credits.toLocaleString()} credits any time for {cur === "INR" ? `₹${CREDIT_PACK.inr}` : `$${CREDIT_PACK.usd}`}. Extra credits never expire.
      </p>
    </div>
  );
}
