import type { Scope } from "./template";

export type RunCtx = {
  orgId: string;
  executionId: string;
  workflowId: string;
  nodeId: string;
  scope: Scope;
  /** config with templates resolved (json fields still raw strings — use resolveJsonField on raw) */
  config: Record<string, unknown>;
  /** config exactly as saved */
  raw: Record<string, unknown>;
  depth: number;
  connection: <T = Record<string, string>>(id: unknown) => Promise<T>;
  /** access token for OAuth or token-paste connections (refreshed automatically) */
  token: (id: unknown) => Promise<{ accessToken: string; data: Record<string, unknown> }>;
  runWorkflow: (workflowId: string, input: unknown) => Promise<unknown>;
  log: (msg: string) => void;
};

export type ModuleResult = {
  output?: unknown;
  /** extra credits on top of the module's base cost (e.g. AI tool calls) */
  extraCredits?: number;
  /** stop this branch (filter didn't pass) */
  stop?: boolean;
  /** run downstream once per item (iterator) */
  iterate?: unknown[];
  /** response for a waiting webhook caller */
  respond?: { status: number; body: unknown };
};

export type ModuleRunner = (ctx: RunCtx) => Promise<ModuleResult>;

export class StepError extends Error {}
