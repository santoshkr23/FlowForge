import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createId } from "../lib/id";

export const roleEnum = pgEnum("role", ["OWNER", "ADMIN", "BUILDER", "VIEWER"]);
export const planEnum = pgEnum("plan_id", ["FREE", "STARTER", "PRO", "TEAMS", "ENTERPRISE"]);
export const execStatusEnum = pgEnum("exec_status", ["QUEUED", "RUNNING", "SUCCESS", "ERROR", "STOPPED"]);
export const providerEnum = pgEnum("billing_provider", ["NONE", "STRIPE", "RAZORPAY", "MANUAL"]);

export type Role = (typeof roleEnum.enumValues)[number];
export type PlanId = (typeof planEnum.enumValues)[number];
export type ExecStatus = (typeof execStatusEnum.enumValues)[number];
export type BillingProvider = (typeof providerEnum.enumValues)[number];

const id = () => text("id").primaryKey().$defaultFn(createId);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  disabled: boolean("disabled").notNull().default(false),
});

export const orgs = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  plan: planEnum("plan").notNull().default("FREE"),
  billingProvider: providerEnum("billing_provider").notNull().default("NONE"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubId: text("stripe_sub_id").unique(),
  razorpaySubId: text("razorpay_sub_id").unique(),
  subStatus: text("sub_status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  creditsMonthly: integer("credits_monthly").notNull().default(1000),
  creditsUsed: integer("credits_used").notNull().default(0),
  extraCredits: integer("extra_credits").notNull().default(0),
  creditsResetAt: timestamp("credits_reset_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("BUILDER"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_org").on(t.userId, t.orgId)],
);

export const invites = pgTable("invites", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: roleEnum("role").notNull().default("BUILDER"),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export type GraphNode = { id: string; type: string; position: { x: number; y: number }; data: { label?: string; config: Record<string, unknown> } };
export type GraphEdge = { id: string; source: string; target: string; data?: { label?: string } };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    folder: text("folder"),
    graph: jsonb("graph").$type<Graph>().notNull(),
    active: boolean("active").notNull().default(false),
    triggerType: text("trigger_type").notNull().default("manual"), // manual | schedule | webhook
    intervalMin: integer("interval_min"),
    cron: text("cron"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    webhookToken: text("webhook_token").unique(),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflows_org").on(t.orgId), index("workflows_due").on(t.active, t.nextRunAt)],
);

export type StepLog = {
  nodeId: string;
  type: string;
  label?: string;
  status: "success" | "error" | "skipped";
  startedAt: string;
  durationMs: number;
  credits: number;
  input?: unknown;
  output?: unknown;
  error?: string;
};

export const executions = pgTable(
  "executions",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    status: execStatusEnum("status").notNull().default("QUEUED"),
    trigger: text("trigger").notNull(), // manual | schedule | webhook | api | mcp
    input: jsonb("input"),
    output: jsonb("output"),
    steps: jsonb("steps").$type<StepLog[]>(),
    error: text("error"),
    creditsUsed: integer("credits_used").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("executions_org_time").on(t.orgId, t.startedAt), index("executions_wf_time").on(t.workflowId, t.startedAt)],
);

export const connections = pgTable(
  "connections",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    name: text("name").notNull(),
    secret: text("secret").notNull(), // AES-256-GCM encrypted JSON
    createdAt: createdAt(),
  },
  (t) => [index("connections_org").on(t.orgId)],
);

export const dataStores = pgTable(
  "data_stores",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    records: jsonb("records").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("data_stores_org_name").on(t.orgId, t.name)],
);

export const apiKeys = pgTable("api_keys", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_time").on(t.orgId, t.createdAt)],
);

export const payments = pgTable("payments", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  provider: providerEnum("provider").notNull(),
  externalId: text("external_id").notNull().unique(),
  amount: integer("amount").notNull(), // smallest currency unit
  currency: text("currency").notNull(),
  description: text("description"),
  createdAt: createdAt(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), // provider event id → idempotency
  provider: text("provider").notNull(),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type Execution = typeof executions.$inferSelect;
export type Connection = typeof connections.$inferSelect;
