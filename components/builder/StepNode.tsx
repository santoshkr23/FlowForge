"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AppIcon } from "../AppIcon";
import { CATALOG_BY_TYPE } from "@/lib/engine/catalog";

export type StepData = {
  moduleType: string;
  label?: string;
  config: Record<string, unknown>;
  runStatus?: "success" | "error" | "skipped";
  runCount?: number;
};
export type StepNodeT = Node<StepData, "step">;

const RING: Record<string, string> = { success: "ring-ok", error: "ring-bad", skipped: "ring-ink-faint" };

export function StepNode({ data, selected }: NodeProps<StepNodeT>) {
  const meta = CATALOG_BY_TYPE[data.moduleType];
  const isTrigger = !!meta?.trigger;
  const ring = selected ? "border-wire ring-2 ring-wire/30" : data.runStatus ? `border-line ring-2 ${RING[data.runStatus]}` : "border-line";
  return (
    <div className={`w-[220px] rounded-node border bg-paper px-3 py-2.5 shadow-[0_1px_0_#D5DCE8] ${ring}`}>
      {!isTrigger && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2.5">
        <AppIcon app={meta?.app ?? "flow"} color={meta?.color} size={16} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{data.label || meta?.name || "Unknown step"}</div>
          <div className="truncate text-xs text-ink-faint">{isTrigger ? `Trigger · ${meta?.name}` : meta?.name}</div>
        </div>
        {data.runCount && data.runCount > 1 ? (
          <span className="rounded-full bg-canvas px-1.5 text-[11px] text-ink-soft" title={`Ran ${data.runCount} times`}>
            ×{data.runCount}
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
