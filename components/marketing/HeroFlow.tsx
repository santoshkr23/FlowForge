"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcon } from "../AppIcon";

/** The hero: a real-looking workflow with a signal travelling down its wires. Drawn on a fixed stage and scaled to fit. */
const NODES = [
  { id: "a", x: 20, y: 150, app: "webhook", color: "#14213D", title: "New order", sub: "Webhook" },
  { id: "b", x: 250, y: 150, app: "sparkles", color: "#2B59C3", title: "Thank-you note", sub: "AI: generate text" },
  { id: "c", x: 480, y: 50, app: "razorpay", color: "#0c2451", title: "Payment link", sub: "Razorpay" },
  { id: "d", x: 480, y: 250, app: "sheets", color: "#1F9D6B", title: "Log the order", sub: "Google Sheets" },
];
const STAGE_W = 700;
const STAGE_H = 370;
const W = 196;
const H = 64;

const wire = (from: (typeof NODES)[number], to: (typeof NODES)[number]) => {
  const x1 = from.x + W;
  const y1 = from.y + H / 2;
  const x2 = to.x;
  const y2 = to.y + H / 2;
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
};

export function HeroFlow() {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / STAGE_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [a, b, c, d] = NODES;
  const paths = [wire(a, b), wire(b, c), wire(b, d)];
  return (
    <div
      ref={box}
      className="grid-bg relative overflow-hidden rounded-2xl border border-line"
      style={{ height: STAGE_H * scale }}
      role="img"
      aria-label="Example workflow: a new order webhook goes to an AI step, which sends a Razorpay payment link and logs the order to Google Sheets."
    >
      <div className="absolute left-1/2 top-0" style={{ width: STAGE_W, height: STAGE_H, transform: `translateX(-50%) scale(${scale})`, transformOrigin: "top center" }}>
        <svg width={STAGE_W} height={STAGE_H} className="absolute inset-0" aria-hidden>
          {paths.map((p, i) => (
            <g key={i}>
              <path d={p} stroke="#2B59C3" strokeWidth="2" fill="none" opacity="0.45" />
              <path d={p} stroke="#F2B705" strokeWidth="4" strokeLinecap="round" fill="none" className="wire-live" style={{ animationDelay: `${i === 0 ? 0 : 1.1}s` }} />
            </g>
          ))}
        </svg>
        {NODES.map((n) => (
          <div key={n.id} className="absolute flex items-center gap-3 rounded-node border border-line bg-paper px-3 shadow-[0_1px_0_#D5DCE8]" style={{ left: n.x, top: n.y, width: W, height: H }}>
            <AppIcon app={n.app} color={n.color} size={16} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{n.title}</div>
              <div className="truncate text-xs text-ink-faint">{n.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
