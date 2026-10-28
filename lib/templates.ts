import type { Graph, GraphNode } from "@/db/schema";

export type Template = { id: string; name: string; description: string; category: string; apps: string[]; graph: Graph };

const n = (id: string, type: string, x: number, y: number, label: string, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  position: { x, y },
  data: { label, config },
});
const e = (s: string, t: string) => ({ id: `${s}->${t}`, source: s, target: t });

export const TEMPLATES: Template[] = [
  {
    id: "lead-to-sheet-slack",
    name: "New lead → Google Sheet + Slack alert",
    description: "Catch form submissions on a webhook, log them to a sheet and ping your sales channel.",
    category: "Sales",
    apps: ["webhook", "sheets", "slack"],
    graph: {
      nodes: [
        n("trigger", "trigger.webhook", 40, 160, "Form webhook", { respond: "accepted" }),
        n("sheet", "sheets.append", 320, 80, "Log lead", { range: "Leads!A1", values: '["{{now}}", "{{trigger.body.name}}", "{{trigger.body.email}}", "{{trigger.body.message}}"]' }),
        n("slack", "slack.message", 320, 260, "Alert sales", { text: "🔥 New lead: {{trigger.body.name}} ({{trigger.body.email}})\n> {{trigger.body.message}}" }),
      ],
      edges: [e("trigger", "sheet"), e("trigger", "slack")],
    },
  },
  {
    id: "ai-email-triage",
    name: "AI support triage",
    description: "Classify incoming messages with AI and route urgent ones to Telegram, the rest to email.",
    category: "Customer experience",
    apps: ["webhook", "sparkles", "telegram", "mail"],
    graph: {
      nodes: [
        n("trigger", "trigger.webhook", 40, 200, "Incoming message"),
        n("classify", "ai.prompt", 300, 200, "Classify", {
          system: "Classify customer messages. Reply as JSON: {\"urgency\": \"high\"|\"normal\", \"summary\": string}",
          prompt: "{{trigger.body.message}}",
          json: true,
        }),
        n("router", "flow.router", 560, 200, "Route"),
        n("urgent", "flow.filter", 780, 100, "Urgent?", { left: "{{steps.classify.data.urgency}}", op: "eq", right: "high" }),
        n("normal", "flow.filter", 780, 300, "Normal?", { left: "{{steps.classify.data.urgency}}", op: "neq", right: "high" }),
        n("tg", "telegram.message", 1020, 100, "Page on-call", { text: "🚨 {{steps.classify.data.summary}}" }),
        n("mail", "email.send", 1020, 300, "Queue for support", { to: "support@yourcompany.com", subject: "New ticket", body: "{{steps.classify.data.summary}}" }),
      ],
      edges: [e("trigger", "classify"), e("classify", "router"), e("router", "urgent"), e("router", "normal"), e("urgent", "tg"), e("normal", "mail")],
    },
  },
  {
    id: "daily-digest",
    name: "Daily API digest to Discord",
    description: "Every morning, fetch data from an API, summarise it with AI and post it to Discord.",
    category: "Productivity",
    apps: ["clock", "globe", "sparkles", "discord"],
    graph: {
      nodes: [
        n("trigger", "trigger.schedule", 40, 160, "Every morning", { mode: "cron", cron: "30 3 * * *" }),
        n("fetch", "http.request", 300, 160, "Fetch news", { method: "GET", url: "https://hacker-news.firebaseio.com/v0/topstories.json", headers: "{}", failOnError: true }),
        n("ai", "ai.prompt", 560, 160, "Summarise", { prompt: "Write a 3-bullet morning digest from these story IDs: {{json(steps.fetch.body)}}" }),
        n("post", "discord.message", 820, 160, "Post digest", { content: "☀️ **Morning digest**\n{{steps.ai.text}}" }),
      ],
      edges: [e("trigger", "fetch"), e("fetch", "ai"), e("ai", "post")],
    },
  },
  {
    id: "razorpay-invoice",
    name: "Send a Razorpay payment link by email",
    description: "Turn an order webhook into a Razorpay payment link and email it to the customer.",
    category: "Finance",
    apps: ["webhook", "razorpay", "mail"],
    graph: {
      nodes: [
        n("trigger", "trigger.webhook", 40, 160, "New order"),
        n("link", "razorpay.payment_link", 300, 160, "Create link", {
          amount: "{{trigger.body.amount}}",
          description: "Order {{trigger.body.orderId}}",
          customerName: "{{trigger.body.name}}",
          customerEmail: "{{trigger.body.email}}",
        }),
        n("mail", "email.send", 560, 160, "Email customer", {
          to: "{{trigger.body.email}}",
          subject: "Your payment link",
          body: "Hi {{trigger.body.name}},<br>Please complete your payment here: {{steps.link.short_url}}",
        }),
      ],
      edges: [e("trigger", "link"), e("link", "mail")],
    },
  },
  {
    id: "airtable-iterate-notify",
    name: "Nightly: notify for each new Airtable record",
    description: "Search Airtable for new records and send a Telegram message for each one.",
    category: "Operations",
    apps: ["clock", "airtable", "repeat", "telegram"],
    graph: {
      nodes: [
        n("trigger", "trigger.schedule", 40, 160, "Nightly", { mode: "cron", cron: "0 18 * * *" }),
        n("search", "airtable.list", 280, 160, "Find new", { table: "Tasks", formula: "{Status}='New'", max: 50 }),
        n("each", "flow.iterator", 520, 160, "For each record", { array: "{{steps.search.records}}", max: 50 }),
        n("notify", "telegram.message", 760, 160, "Notify", { text: "📝 New task: {{item.fields.Name}}" }),
      ],
      edges: [e("trigger", "search"), e("search", "each"), e("each", "notify")],
    },
  },
  {
    id: "ai-agent-research",
    name: "AI research agent",
    description: "Give the agent a company name; it researches the web and drafts an intro email saved to your data store.",
    category: "Marketing",
    apps: ["play", "bot", "database"],
    graph: {
      nodes: [
        n("trigger", "trigger.manual", 40, 160, "Run", { sample: '{ "company": "Example Corp", "website": "https://example.com" }' }),
        n("agent", "ai.agent", 300, 160, "Research & draft", {
          goal: "Visit {{trigger.website}}, learn what {{trigger.company}} does, then write a friendly 3-sentence intro email offering automation consulting. Save the draft with datastore_set (key: '{{trigger.company}}').",
          tools: "http_get,datastore_set",
          maxSteps: 5,
        }),
      ],
      edges: [e("trigger", "agent")],
    },
  },
  {
    id: "github-from-form",
    name: "Bug report form → GitHub issue",
    description: "Open a GitHub issue from a webhook and reply to the caller with the issue link.",
    category: "IT",
    apps: ["webhook", "github", "reply"],
    graph: {
      nodes: [
        n("trigger", "trigger.webhook", 40, 160, "Bug form", { respond: "result" }),
        n("issue", "github.issue", 300, 160, "Create issue", { repo: "owner/repo", title: "[Bug] {{trigger.body.title}}", body: "{{trigger.body.details}}\n\nReported by {{trigger.body.email}}" }),
        n("reply", "flow.respond", 560, 160, "Reply", { status: 200, body: '{ "issue": "{{steps.issue.html_url}}" }' }),
      ],
      edges: [e("trigger", "issue"), e("issue", "reply")],
    },
  },
];
