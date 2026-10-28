"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnBeforeDelete,
} from "@xyflow/react";
import { ArrowLeft, Play, Plus, Save } from "lucide-react";
import { StepNode, type StepData, type StepNodeT } from "./StepNode";
import { Palette } from "./Palette";
import { ConfigPanel } from "./ConfigPanel";
import { StepLog } from "../app/StepLog";
import { ActiveToggle } from "../app/ActiveToggle";
import { StatusPill } from "../app/PageHead";
import { api } from "@/lib/client";
import { CATALOG_BY_TYPE, type ModuleMeta } from "@/lib/engine/catalog";
import type { ExecStatus, Graph, PlanId, StepLog as Step } from "@/db/schema";

type Props = {
  workflow: { id: string; name: string; graph: Graph; active: boolean; triggerType: string };
  webhookUrl: string | null;
  connections: { id: string; app: string; name: string }[];
  plan: PlanId;
  readOnly: boolean;
  lastRun: { id: string; status: ExecStatus; steps: Step[] } | null;
};

type Run = { executionId?: string; status: string; steps: Step[]; error?: string };
type Side = { mode: "config" } | { mode: "add" } | { mode: "run" } | { mode: "none" };

const nodeTypes = { step: StepNode };

const toFlow = (g: Graph): StepNodeT[] =>
  g.nodes.map((n) => ({ id: n.id, type: "step", position: n.position, data: { moduleType: n.type, label: n.data?.label, config: n.data?.config ?? {} } }));
const toGraph = (nodes: StepNodeT[], edges: Edge[]): Graph => ({
  nodes: nodes.map((n) => ({
    id: n.id,
    type: n.data.moduleType,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data: { label: n.data.label, config: n.data.config },
  })),
  edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
});

function newId(moduleType: string, taken: Set<string>) {
  const base = moduleType.split(".").pop()!.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  let i = 1;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

function Inner({ workflow, webhookUrl, connections, plan, readOnly, lastRun }: Props) {
  const rf = useReactFlow();
  const [nodes, setNodes] = useState<StepNodeT[]>(() => toFlow(workflow.graph));
  const [edges, setEdges] = useState<Edge[]>(() => workflow.graph.edges.map((e) => ({ ...e })));
  const [name, setName] = useState(workflow.name);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [side, setSide] = useState<Side>({ mode: "none" });
  const [run, setRun] = useState<Run | null>(lastRun ? { executionId: lastRun.id, status: lastRun.status, steps: lastRun.steps } : null);
  const trigger = nodes.find((n) => CATALOG_BY_TYPE[n.data.moduleType]?.trigger);
  const [testInput, setTestInput] = useState(() => {
    const t = workflow.graph.nodes.find((n) => n.type.startsWith("trigger."));
    if (t?.type === "trigger.webhook") return '{\n  "body": { "name": "Test", "email": "test@example.com" }\n}';
    return String(t?.data?.config?.sample ?? "{}");
  });

  // show last-run status on each node
  const decorated = useMemo(() => {
    const stat = new Map<string, { status: Step["status"]; count: number }>();
    for (const s of run?.steps ?? []) {
      const cur = stat.get(s.nodeId);
      const rank = { error: 3, success: 2, skipped: 1 } as const;
      stat.set(s.nodeId, { status: !cur || rank[s.status] > rank[cur.status] ? s.status : cur.status, count: (cur?.count ?? 0) + 1 });
    }
    return nodes.map((n) => ({ ...n, data: { ...n.data, runStatus: stat.get(n.id)?.status, runCount: stat.get(n.id)?.count } }));
  }, [nodes, run]);

  const markDirty = () => setDirty(true);

  const onNodesChange = useCallback((c: NodeChange<StepNodeT>[]) => {
    setNodes((ns) => applyNodeChanges(c, ns));
    if (c.some((x) => x.type === "position" || x.type === "remove")) setDirty(true);
  }, []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(c, es));
    if (c.some((x) => x.type === "remove")) setDirty(true);
  }, []);
  const onConnect = useCallback((c: Connection) => {
    setEdges((es) => addEdge({ ...c, id: `${c.source}->${c.target}` }, es));
    setDirty(true);
  }, []);
  const onBeforeDelete: OnBeforeDelete<StepNodeT> = async ({ nodes: del, edges: delEdges }) => {
    if (readOnly) return false;
    const keep = del.filter((n) => !CATALOG_BY_TYPE[n.data.moduleType]?.trigger);
    if (selected && keep.some((n) => n.id === selected)) {
      setSelected(null);
      setSide({ mode: "none" });
    }
    return { nodes: keep, edges: delEdges };
  };

  const updateNode = (id: string, patch: Partial<StepData>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    markDirty();
  };

  function addStep(m: ModuleMeta) {
    const taken = new Set(nodes.map((n) => n.id));
    const from = nodes.find((n) => n.id === selected) ?? [...nodes].reverse().find((n) => !edges.some((e) => e.source === n.id)) ?? trigger;
    const siblings = from ? edges.filter((e) => e.source === from.id).length : 0;
    const id = newId(m.type, taken);
    const config = Object.fromEntries(m.fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));
    const pos = from ? { x: from.position.x + 280, y: from.position.y + siblings * 130 } : { x: 80, y: 160 };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: "step", position: pos, selected: true, data: { moduleType: m.type, label: "", config } }]);
    if (from) setEdges((es) => [...es, { id: `${from.id}->${id}`, source: from.id, target: id }]);
    setSelected(id);
    setSide({ mode: "config" });
    markDirty();
    setTimeout(() => rf.fitView({ padding: 0.3, duration: 250 }), 50);
  }

  function changeTrigger(moduleType: string) {
    if (!trigger) return;
    const m = CATALOG_BY_TYPE[moduleType];
    const config = Object.fromEntries(m.fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));
    updateNode(trigger.id, { moduleType, config, label: "" });
    if (moduleType === "trigger.webhook") setTestInput('{\n  "body": {}\n}');
  }

  const save = useCallback(async () => {
    if (readOnly) return true;
    setSaving(true);
    setNotice(null);
    try {
      const r = await api<{ problems: string[] }>(`/api/workflows/${workflow.id}`, { method: "PUT", body: { name, graph: toGraph(nodes, edges) } });
      setProblems(r.problems);
      setDirty(false);
      return true;
    } catch (e) {
      setNotice({ kind: "bad", text: (e as Error).message });
      return false;
    } finally {
      setSaving(false);
    }
  }, [name, nodes, edges, readOnly, workflow.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // keep the whole workflow in view when the side panel opens or closes
  const panelOpen = side.mode !== "none";
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.25, maxZoom: 1.1, duration: 200 }), 60);
    return () => clearTimeout(t);
  }, [panelOpen, rf]);

  useEffect(() => {
    const warn =(e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function runOnce() {
    let input: unknown = {};
    try {
      input = JSON.parse(testInput || "{}");
    } catch {
      setNotice({ kind: "bad", text: "Test input isn't valid JSON" });
      setSide({ mode: "run" });
      return;
    }
    if (dirty && !(await save())) return;
    setRunning(true);
    setNotice(null);
    setSide({ mode: "run" });
    try {
      const r = await api<Run>(`/api/workflows/${workflow.id}/run`, { body: { input } });
      setRun(r);
      setNotice(r.status === "SUCCESS" ? { kind: "ok", text: "Run finished. Click a step to see its data." } : { kind: "bad", text: r.error ?? "Run failed" });
    } catch (e) {
      setNotice({ kind: "bad", text: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  // upstream of the selected node (for the mapping picker)
  const upstream = useMemo(() => {
    if (!selected) return [];
    const seen = new Set<string>();
    const order: string[] = [];
    const walk = (id: string) => {
      for (const e of edges.filter((x) => x.target === id)) {
        if (seen.has(e.source)) continue;
        seen.add(e.source);
        walk(e.source);
        order.push(e.source);
      }
    };
    walk(selected);
    return order.map((id) => nodes.find((n) => n.id === id)!).filter(Boolean).map((n) => ({ id: n.id, label: n.data.label ?? "", moduleType: n.data.moduleType }));
  }, [selected, edges, nodes]);

  const selNode = nodes.find((n) => n.id === selected);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-2.5">
        <Link href="/app/workflows" className="rounded-lg p-1.5 text-ink-soft hover:bg-canvas" aria-label="Back to workflows">
          <ArrowLeft size={18} />
        </Link>
        <input
          aria-label="Workflow name"
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 font-display text-lg font-bold focus:bg-canvas focus:outline-none"
          value={name}
          disabled={readOnly}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
        />
        <span className="text-xs text-ink-faint" aria-live="polite">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
        </span>
        {!readOnly && (
          <>
            <button className="btn-quiet" onClick={() => setSide({ mode: "add" })}>
              <Plus size={16} aria-hidden /> Add step
            </button>
            <button className="btn-quiet" onClick={save} disabled={saving || !dirty}>
              <Save size={16} aria-hidden /> Save
            </button>
            <button className="btn-primary" onClick={runOnce} disabled={running}>
              <Play size={16} aria-hidden /> {running ? "Running…" : "Run once"}
            </button>
          </>
        )}
        {trigger && trigger.data.moduleType !== "trigger.manual" && (
          <div className="flex items-center gap-2 border-l border-line pl-3 text-sm">
            <ActiveToggle id={workflow.id} active={workflow.active} disabled={readOnly || dirty} />
            <span className="text-ink-soft">{dirty ? "Save to switch on" : "On"}</span>
          </div>
        )}
      </header>

      {(problems.length > 0 || notice) && (
        <div className="space-y-1 border-b border-line bg-paper px-4 py-2 text-sm">
          {notice && (
            <p role="status" className={notice.kind === "ok" ? "text-ok" : "text-bad"}>
              {notice.text}
            </p>
          )}
          {problems.map((p) => (
            <p key={p} className="text-ink">
              To finish: {p}
            </p>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="grid-bg relative min-w-0 flex-1">
          <ReactFlow<StepNodeT, Edge>
            nodes={decorated}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onBeforeDelete={onBeforeDelete}
            onNodeClick={(_, n) => {
              setSelected(n.id);
              setSide({ mode: "config" });
            }}
            onPaneClick={() => {
              setSelected(null);
              if (side.mode === "config") setSide({ mode: "none" });
            }}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1} color="#C7D0E0" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {nodes.length === 1 && !readOnly && (
            <button onClick={() => setSide({ mode: "add" })} className="btn-primary absolute bottom-6 left-1/2 -translate-x-1/2 shadow-lg">
              <Plus size={16} aria-hidden /> Add your first step
            </button>
          )}
        </div>

        {side.mode !== "none" && (
          <aside className="flex w-full max-w-[400px] shrink-0 flex-col border-l border-line bg-paper">
            <div className="flex border-b border-line text-sm" role="tablist">
              {(
                [
                  ["config", "Step settings"],
                  ["add", "Add step"],
                  ["run", "Test run"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={side.mode === k}
                  disabled={k === "config" && !selNode}
                  onClick={() => setSide({ mode: k })}
                  className={`flex-1 px-3 py-2.5 disabled:opacity-40 ${side.mode === k ? "border-b-2 border-wire font-medium" : "text-ink-soft"}`}
                >
                  {label}
                </button>
              ))}
              <button className="px-3 text-ink-soft" onClick={() => setSide({ mode: "none" })} aria-label="Close panel">
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {side.mode === "add" && <Palette plan={plan} onPick={addStep} />}
              {side.mode === "config" && selNode && (
                <ConfigPanel
                  key={selNode.id}
                  nodeId={selNode.id}
                  data={selNode.data}
                  plan={plan}
                  connections={connections}
                  upstream={upstream}
                  insideIterator={upstream.some((u) => u.moduleType === "flow.iterator")}
                  lastSteps={run?.steps ?? []}
                  webhookUrl={webhookUrl}
                  readOnly={readOnly}
                  onChange={(p) => updateNode(selNode.id, p)}
                  onChangeType={changeTrigger}
                  onDelete={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== selNode.id));
                    setEdges((es) => es.filter((e) => e.source !== selNode.id && e.target !== selNode.id));
                    setSelected(null);
                    setSide({ mode: "none" });
                    markDirty();
                  }}
                />
              )}
              {side.mode === "run" && (
                <div className="h-full space-y-4 overflow-y-auto p-4">
                  <div>
                    <label className="label" htmlFor="test-input">
                      Test input (JSON)
                    </label>
                    <textarea id="test-input" rows={5} className="input font-mono text-[13px]" value={testInput} onChange={(e) => setTestInput(e.target.value)} />
                    <p className="mt-1 text-xs text-ink-faint">Becomes the trigger data for this test. Test runs use real credits and really send messages.</p>
                  </div>
                  {!readOnly && (
                    <button className="btn-primary w-full" onClick={runOnce} disabled={running}>
                      {running ? "Running…" : "Run once"}
                    </button>
                  )}
                  {run && (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <StatusPill status={run.status} />
                        {run.executionId && (
                          <Link href={`/app/executions/${run.executionId}`} className="text-sm text-wire underline">
                            Full run details
                          </Link>
                        )}
                      </div>
                      {run.error && <p className="mb-2 text-sm text-bad">{run.error}</p>}
                      <StepLog
                        steps={run.steps ?? []}
                        onSelect={(id) => {
                          setSelected(id);
                          setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export function Builder(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
