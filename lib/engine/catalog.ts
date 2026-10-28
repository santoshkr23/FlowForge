/**
 * Client-safe module catalog: metadata + config fields for every step type.
 * Runtime implementations live in lib/engine/modules/*.ts (server only).
 */
import type { PlanId } from "@/db/schema";

export type FieldType = "text" | "textarea" | "number" | "select" | "boolean" | "code" | "json" | "connection";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: unknown;
  /** connection fields: which app's credentials */
  app?: string;
  /** hide unless another field equals a value */
  showIf?: { key: string; equals: unknown };
};

export type Category = "Triggers" | "Flow control" | "Data" | "AI" | "Messaging" | "Productivity" | "Developer" | "Payments";

export type ModuleMeta = {
  type: string;
  name: string;
  description: string;
  category: Category;
  app: string; // icon / brand key
  color: string;
  trigger?: boolean;
  credits: number; // base credits per run
  minPlan?: PlanId;
  fields: Field[];
  /** sample output keys, used by the mapping picker */
  outputs?: string[];
};

const conn = (app: string, label = "Connection"): Field => ({ key: "connectionId", label, type: "connection", app, required: true });

export const CATALOG: ModuleMeta[] = [
  // ───────── Triggers ─────────
  {
    type: "trigger.manual",
    name: "Run manually",
    description: "Start the workflow with the Run button, the API, or from an AI chat via MCP.",
    category: "Triggers",
    app: "play",
    color: "#14213D",
    trigger: true,
    credits: 0,
    fields: [{ key: "sample", label: "Sample input (JSON)", type: "json", default: "{}", help: "Used when you press Run in the builder." }],
    outputs: ["input"],
  },
  {
    type: "trigger.schedule",
    name: "Schedule",
    description: "Run every N minutes or on a cron expression.",
    category: "Triggers",
    app: "clock",
    color: "#14213D",
    trigger: true,
    credits: 0,
    fields: [
      { key: "mode", label: "Mode", type: "select", default: "interval", options: [{ value: "interval", label: "Every N minutes" }, { value: "cron", label: "Cron expression" }] },
      { key: "intervalMin", label: "Every (minutes)", type: "number", default: 15, showIf: { key: "mode", equals: "interval" } },
      { key: "cron", label: "Cron", type: "text", placeholder: "0 9 * * 1-5", help: "Minute hour day month weekday (UTC)", showIf: { key: "mode", equals: "cron" } },
    ],
    outputs: ["firedAt"],
  },
  {
    type: "trigger.webhook",
    name: "Webhook",
    description: "Start when any app sends an HTTP request to your unique URL.",
    category: "Triggers",
    app: "webhook",
    color: "#14213D",
    trigger: true,
    credits: 0,
    fields: [
      {
        key: "respond",
        label: "Response",
        type: "select",
        default: "accepted",
        options: [
          { value: "accepted", label: "Respond immediately (202)" },
          { value: "result", label: "Wait and return workflow output" },
        ],
      },
    ],
    outputs: ["body", "query", "headers", "method"],
  },

  // ───────── Flow control ─────────
  {
    type: "flow.filter",
    name: "Filter",
    description: "Continue only when a condition is true.",
    category: "Flow control",
    app: "filter",
    color: "#8b5cf6",
    credits: 0,
    fields: [
      { key: "left", label: "Value", type: "text", required: true, placeholder: "{{trigger.body.amount}}" },
      {
        key: "op",
        label: "Operator",
        type: "select",
        default: "eq",
        options: [
          { value: "eq", label: "equals" },
          { value: "neq", label: "does not equal" },
          { value: "contains", label: "contains" },
          { value: "not_contains", label: "does not contain" },
          { value: "gt", label: "greater than" },
          { value: "lt", label: "less than" },
          { value: "exists", label: "exists" },
          { value: "not_exists", label: "does not exist" },
          { value: "regex", label: "matches regex" },
        ],
      },
      { key: "right", label: "Compare to", type: "text", help: "Not needed for exists / does not exist." },
    ],
    outputs: ["passed"],
  },
  {
    type: "flow.router",
    name: "Router",
    description: "Split into several branches. Put a Filter at the start of each branch.",
    category: "Flow control",
    app: "router",
    color: "#8b5cf6",
    credits: 0,
    fields: [],
  },
  {
    type: "flow.iterator",
    name: "Iterator",
    description: "Run the following steps once for every item in a list.",
    category: "Flow control",
    app: "repeat",
    color: "#8b5cf6",
    credits: 1,
    fields: [
      { key: "array", label: "List", type: "text", required: true, placeholder: "{{steps.http_1.body.items}}" },
      { key: "max", label: "Max items", type: "number", default: 100 },
    ],
    outputs: ["item", "index"],
  },
  {
    type: "flow.delay",
    name: "Delay",
    description: "Pause before continuing (max 5 minutes).",
    category: "Flow control",
    app: "hourglass",
    color: "#8b5cf6",
    credits: 1,
    fields: [{ key: "seconds", label: "Seconds", type: "number", default: 5 }],
  },
  {
    type: "flow.set",
    name: "Set variables",
    description: "Create named values to reuse later as {{vars.name}}.",
    category: "Flow control",
    app: "variable",
    color: "#8b5cf6",
    credits: 1,
    fields: [{ key: "values", label: "Variables (JSON)", type: "json", default: '{\n  "customer": "{{trigger.body.name}}"\n}' }],
  },
  {
    type: "flow.respond",
    name: "Webhook response",
    description: "Set what a waiting webhook caller receives.",
    category: "Flow control",
    app: "reply",
    color: "#8b5cf6",
    credits: 0,
    fields: [
      { key: "status", label: "Status", type: "number", default: 200 },
      { key: "body", label: "Body (JSON)", type: "json", default: '{ "ok": true }' },
    ],
  },

  // ───────── Data ─────────
  {
    type: "data.compose",
    name: "Compose text",
    description: "Build a piece of text from earlier values.",
    category: "Data",
    app: "text",
    color: "#0ea5e9",
    credits: 1,
    fields: [{ key: "template", label: "Text", type: "textarea", required: true, placeholder: "Hi {{trigger.body.name}}, thanks for your order!" }],
    outputs: ["text"],
  },
  {
    type: "data.parse_json",
    name: "Parse JSON",
    description: "Turn a JSON string into structured data.",
    category: "Data",
    app: "braces",
    color: "#0ea5e9",
    credits: 1,
    fields: [{ key: "text", label: "JSON string", type: "text", required: true }],
    outputs: ["data"],
  },
  {
    type: "datastore.set",
    name: "Data store: save",
    description: "Save a value under a key in a workspace data store.",
    category: "Data",
    app: "database",
    color: "#0ea5e9",
    credits: 1,
    fields: [
      { key: "store", label: "Store name", type: "text", default: "default" },
      { key: "key", label: "Key", type: "text", required: true },
      { key: "value", label: "Value", type: "text", required: true },
    ],
  },
  {
    type: "datastore.get",
    name: "Data store: get",
    description: "Read a value by key from a workspace data store.",
    category: "Data",
    app: "database",
    color: "#0ea5e9",
    credits: 1,
    fields: [
      { key: "store", label: "Store name", type: "text", default: "default" },
      { key: "key", label: "Key", type: "text", required: true },
    ],
    outputs: ["value", "found"],
  },

  // ───────── AI ─────────
  {
    type: "ai.prompt",
    name: "AI: generate text",
    description: "Ask an LLM (OpenAI or Claude) to write, summarise, classify or extract.",
    category: "AI",
    app: "sparkles",
    color: "#ec4899",
    credits: 5,
    fields: [
      { key: "system", label: "Instructions", type: "textarea", placeholder: "You are a helpful assistant that…" },
      { key: "prompt", label: "Prompt", type: "textarea", required: true },
      { key: "json", label: "Return JSON", type: "boolean", default: false },
      { key: "model", label: "Model (optional)", type: "text", placeholder: "default" },
    ],
    outputs: ["text", "data"],
  },
  {
    type: "ai.agent",
    name: "AI agent",
    description: "Give a goal and tools; the agent reasons, calls tools and reports back.",
    category: "AI",
    app: "bot",
    color: "#ec4899",
    credits: 10,
    minPlan: "PRO",
    fields: [
      { key: "goal", label: "Goal", type: "textarea", required: true, placeholder: "Research {{trigger.body.company}} and draft a 3-line intro email." },
      { key: "tools", label: "Allowed tools", type: "text", default: "http_get,datastore_get,datastore_set", help: "Comma-separated: http_get, http_post, datastore_get, datastore_set, run_workflow" },
      { key: "maxSteps", label: "Max tool calls", type: "number", default: 6 },
    ],
    outputs: ["answer", "reasoning"],
  },

  // ───────── Messaging ─────────
  {
    type: "email.send",
    name: "Email: send",
    description: "Send an email over SMTP (Gmail, Zoho, SES…).",
    category: "Messaging",
    app: "mail",
    color: "#ef4444",
    credits: 1,
    fields: [
      { ...conn("smtp", "SMTP connection"), required: false, help: "Leave empty to use the platform mailer." },
      { key: "to", label: "To", type: "text", required: true },
      { key: "subject", label: "Subject", type: "text", required: true },
      { key: "body", label: "Body (HTML allowed)", type: "textarea", required: true },
    ],
    outputs: ["messageId"],
  },
  {
    type: "slack.message",
    name: "Slack: post message",
    description: "Post to a Slack channel via an incoming-webhook URL.",
    category: "Messaging",
    app: "slack",
    color: "#4a154b",
    credits: 1,
    fields: [conn("slack"), { key: "text", label: "Message", type: "textarea", required: true }],
  },
  {
    type: "discord.message",
    name: "Discord: post message",
    description: "Post to a Discord channel via webhook.",
    category: "Messaging",
    app: "discord",
    color: "#5865f2",
    credits: 1,
    fields: [conn("discord"), { key: "content", label: "Message", type: "textarea", required: true }],
  },
  {
    type: "telegram.message",
    name: "Telegram: send message",
    description: "Send a message from your Telegram bot.",
    category: "Messaging",
    app: "telegram",
    color: "#229ed9",
    credits: 1,
    fields: [conn("telegram"), { key: "chatId", label: "Chat ID", type: "text", required: true }, { key: "text", label: "Message", type: "textarea", required: true }],
    outputs: ["message_id"],
  },
  {
    type: "twilio.sms",
    name: "Twilio: send SMS / WhatsApp",
    description: "Send an SMS or WhatsApp message through Twilio.",
    category: "Messaging",
    app: "twilio",
    color: "#f22f46",
    credits: 1,
    fields: [
      conn("twilio"),
      { key: "to", label: "To", type: "text", required: true, placeholder: "+9198xxxxxxx or whatsapp:+91…" },
      { key: "body", label: "Message", type: "textarea", required: true },
    ],
    outputs: ["sid"],
  },

  // ───────── Productivity ─────────
  {
    type: "sheets.append",
    name: "Google Sheets: add row",
    description: "Append a row to a sheet (service-account connection).",
    category: "Productivity",
    app: "sheets",
    color: "#0f9d58",
    credits: 1,
    fields: [
      conn("google"),
      { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", required: true },
      { key: "range", label: "Sheet / range", type: "text", default: "Sheet1!A1" },
      { key: "values", label: "Row values (JSON array)", type: "json", default: '["{{trigger.body.name}}", "{{trigger.body.email}}"]' },
    ],
    outputs: ["updatedRange"],
  },
  {
    type: "sheets.read",
    name: "Google Sheets: read rows",
    description: "Read rows from a range.",
    category: "Productivity",
    app: "sheets",
    color: "#0f9d58",
    credits: 1,
    fields: [conn("google"), { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", required: true }, { key: "range", label: "Range", type: "text", default: "Sheet1!A1:Z100" }],
    outputs: ["rows"],
  },
  {
    type: "notion.create_page",
    name: "Notion: create page",
    description: "Add a page to a Notion database.",
    category: "Productivity",
    app: "notion",
    color: "#111111",
    credits: 1,
    fields: [
      conn("notion"),
      { key: "databaseId", label: "Database ID", type: "text", required: true },
      { key: "title", label: "Title", type: "text", required: true },
      { key: "titleProperty", label: "Title property name", type: "text", default: "Name" },
      { key: "properties", label: "Extra properties (Notion JSON)", type: "json", default: "{}" },
    ],
    outputs: ["id", "url"],
  },
  {
    type: "airtable.create",
    name: "Airtable: create record",
    description: "Create a record in an Airtable table.",
    category: "Productivity",
    app: "airtable",
    color: "#fcb400",
    credits: 1,
    fields: [
      conn("airtable"),
      { key: "baseId", label: "Base ID", type: "text", required: true },
      { key: "table", label: "Table", type: "text", required: true },
      { key: "fields", label: "Fields (JSON)", type: "json", default: '{ "Name": "{{trigger.body.name}}" }' },
    ],
    outputs: ["id", "fields"],
  },
  {
    type: "airtable.list",
    name: "Airtable: search records",
    description: "List records, optionally with a formula filter.",
    category: "Productivity",
    app: "airtable",
    color: "#fcb400",
    credits: 1,
    fields: [
      conn("airtable"),
      { key: "baseId", label: "Base ID", type: "text", required: true },
      { key: "table", label: "Table", type: "text", required: true },
      { key: "formula", label: "Filter formula", type: "text", placeholder: "{Status}='New'" },
      { key: "max", label: "Max records", type: "number", default: 50 },
    ],
    outputs: ["records"],
  },
  {
    type: "github.issue",
    name: "GitHub: create issue",
    description: "Open an issue in a repository.",
    category: "Developer",
    app: "github",
    color: "#24292f",
    credits: 1,
    fields: [
      conn("github"),
      { key: "repo", label: "Repository (owner/name)", type: "text", required: true },
      { key: "title", label: "Title", type: "text", required: true },
      { key: "body", label: "Body", type: "textarea" },
    ],
    outputs: ["number", "html_url"],
  },

  // ───────── Developer ─────────
  {
    type: "http.request",
    name: "HTTP request",
    description: "Call any API. Supports JSON, headers and auth.",
    category: "Developer",
    app: "globe",
    color: "#64748b",
    credits: 1,
    fields: [
      { key: "method", label: "Method", type: "select", default: "GET", options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m })) },
      { key: "url", label: "URL", type: "text", required: true, placeholder: "https://api.example.com/items" },
      { key: "headers", label: "Headers (JSON)", type: "json", default: "{}" },
      { key: "body", label: "Body (JSON or text)", type: "textarea" },
      { ...conn("http_auth", "Auth (optional)"), required: false },
      { key: "failOnError", label: "Fail on 4xx/5xx", type: "boolean", default: true },
    ],
    outputs: ["status", "body", "headers"],
  },
  {
    type: "code.javascript",
    name: "Code (JavaScript)",
    description: "Run a snippet. `input` holds earlier data; `return` the result.",
    category: "Developer",
    app: "code",
    color: "#64748b",
    credits: 2,
    minPlan: "PRO",
    fields: [
      {
        key: "code",
        label: "Code",
        type: "code",
        default: "// input.trigger, input.steps, input.vars are available\nconst items = input.trigger?.body?.items ?? [];\nreturn { count: items.length };",
      },
    ],
    outputs: ["result"],
  },
  {
    type: "workflow.run",
    name: "Run another workflow",
    description: "Call a sub-workflow and use its output.",
    category: "Developer",
    app: "flow",
    color: "#64748b",
    credits: 1,
    fields: [
      { key: "workflowId", label: "Workflow ID", type: "text", required: true },
      { key: "input", label: "Input (JSON)", type: "json", default: "{}" },
    ],
    outputs: ["output"],
  },

  // ───────── Payments ─────────
  {
    type: "razorpay.payment_link",
    name: "Razorpay: payment link",
    description: "Create a payment link and send it to your customer.",
    category: "Payments",
    app: "razorpay",
    color: "#0c2451",
    credits: 1,
    fields: [
      conn("razorpay"),
      { key: "amount", label: "Amount (₹)", type: "number", required: true },
      { key: "description", label: "Description", type: "text" },
      { key: "customerName", label: "Customer name", type: "text" },
      { key: "customerEmail", label: "Customer email", type: "text" },
      { key: "customerPhone", label: "Customer phone", type: "text" },
    ],
    outputs: ["id", "short_url"],
  },
  {
    type: "stripe.payment_link",
    name: "Stripe: payment link",
    description: "Create a one-off Stripe payment link.",
    category: "Payments",
    app: "stripe",
    color: "#635bff",
    credits: 1,
    fields: [
      conn("stripe"),
      { key: "amount", label: "Amount", type: "number", required: true },
      { key: "currency", label: "Currency", type: "text", default: "usd" },
      { key: "productName", label: "Product name", type: "text", required: true },
    ],
    outputs: ["id", "url"],
  },
];

export const CATALOG_BY_TYPE: Record<string, ModuleMeta> = Object.fromEntries(CATALOG.map((m) => [m.type, m]));

/** Credential shapes for each connectable app (used by the Connections page). */
export const APPS: Record<string, { name: string; fields: { key: string; label: string; secret?: boolean; textarea?: boolean; placeholder?: string }[]; help: string }> = {
  slack: { name: "Slack", help: "Slack → Apps → Incoming Webhooks → Add to channel → copy the webhook URL.", fields: [{ key: "webhookUrl", label: "Webhook URL", secret: true }] },
  discord: { name: "Discord", help: "Channel settings → Integrations → Webhooks → New webhook → Copy URL.", fields: [{ key: "webhookUrl", label: "Webhook URL", secret: true }] },
  telegram: { name: "Telegram", help: "Create a bot with @BotFather and paste its token.", fields: [{ key: "botToken", label: "Bot token", secret: true }] },
  twilio: {
    name: "Twilio",
    help: "Console → Account info.",
    fields: [
      { key: "accountSid", label: "Account SID" },
      { key: "authToken", label: "Auth token", secret: true },
      { key: "from", label: "From number", placeholder: "+1… or whatsapp:+1…" },
    ],
  },
  smtp: {
    name: "SMTP email",
    help: "For Gmail use smtp.gmail.com, port 465 and an App Password.",
    fields: [
      { key: "host", label: "Host" },
      { key: "port", label: "Port", placeholder: "465" },
      { key: "user", label: "Username" },
      { key: "pass", label: "Password", secret: true },
      { key: "from", label: "From address" },
    ],
  },
  google: {
    name: "Google (service account)",
    help: "Google Cloud → IAM → Service accounts → Keys → JSON. Share your sheet with the service account email.",
    fields: [{ key: "serviceAccountJson", label: "Service account JSON", secret: true, textarea: true }],
  },
  notion: { name: "Notion", help: "notion.so/my-integrations → New integration → copy the secret, then share the database with it.", fields: [{ key: "token", label: "Integration secret", secret: true }] },
  airtable: { name: "Airtable", help: "airtable.com/create/tokens → personal access token with data.records scopes.", fields: [{ key: "token", label: "Personal access token", secret: true }] },
  github: { name: "GitHub", help: "Settings → Developer settings → Fine-grained token with Issues: read & write.", fields: [{ key: "token", label: "Token", secret: true }] },
  razorpay: {
    name: "Razorpay",
    help: "Dashboard → Settings → API Keys.",
    fields: [
      { key: "keyId", label: "Key ID" },
      { key: "keySecret", label: "Key secret", secret: true },
    ],
  },
  stripe: { name: "Stripe", help: "Developers → API keys → Secret key.", fields: [{ key: "secretKey", label: "Secret key", secret: true }] },
  http_auth: {
    name: "HTTP auth",
    help: "Adds an Authorization header to HTTP requests.",
    fields: [
      { key: "header", label: "Header name", placeholder: "Authorization" },
      { key: "value", label: "Header value", secret: true, placeholder: "Bearer sk-…" },
    ],
  },
};

export const CATEGORIES: Category[] = ["Triggers", "Flow control", "Data", "AI", "Messaging", "Productivity", "Developer", "Payments"];
