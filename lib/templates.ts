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
    id: "profile-to-linkedin",
    name: "Someone posts on LinkedIn → copy text, pictures & PDF → post on my LinkedIn",
    description: "Add a person's LinkedIn profile link. Every hour, their new posts are fetched with all pictures or the PDF, cleaned, given your hashtags and sign-off, and posted on your profile. (Easier: Social → Auto-repost from profiles.)",
    category: "Social media",
    apps: ["linkedin", "sparkles", "linkedin"],
    graph: {
      nodes: [
        n("trigger", "linkedin.profile_watch", 40, 200, "They post", { profileUrl: "https://www.linkedin.com/in/their-profile", feedUrl: "", intervalMin: 60 }),
        n("import", "social.import", 300, 200, "Fetch post + files", { url: "{{trigger.url}}", withFile: "true" }),
        n("clean", "social.rewrite", 560, 200, "Clean it", { text: "{{steps.import.text}}", style: "clean", author: "{{steps.import.author}}", url: "{{steps.import.url}}", credit: "true", maxTags: 5 }),
        n("post", "social.draft", 820, 200, "Post on my LinkedIn", { text: "{{steps.clean.text}}", mediaIds: "{{steps.import.mediaIds}}", mediaTitle: "{{steps.import.fileTitle}}", mode: "post", connectionId: "" }),
      ],
      edges: [e("trigger", "import"), e("import", "clean"), e("clean", "post")],
    },
  },
  {
    id: "post-link-to-linkedin",
    name: "Share a post link → fetch text & PDF → clean → post on my LinkedIn",
    description:
      "Send a LinkedIn post link to this workflow (from your phone's share menu, a bookmark or another app). FlowForge reads the post, downloads its PDF carousel or picture, cleans the text, adds credit and hashtags, and posts it on your LinkedIn with the file.",
    category: "Social media",
    apps: ["webhook", "linkedin", "sparkles", "linkedin"],
    graph: {
      nodes: [
        n("trigger", "trigger.webhook", 40, 200, "Post link received", { respond: "result" }),
        n("import", "social.import", 300, 200, "Fetch post + file", { url: "{{trigger.query.url || trigger.body.url || trigger.body}}", withFile: "true" }),
        n("clean", "social.rewrite", 560, 200, "Clean it", { text: "{{steps.import.text}}", style: "clean", author: "{{steps.import.author}}", url: "{{steps.import.url}}", credit: "true", maxTags: 5 }),
        n("post", "social.draft", 820, 200, "Post on LinkedIn", { text: "{{steps.clean.text}}", mediaIds: "{{steps.import.mediaIds}}", mediaTitle: "{{steps.import.fileTitle}}", mode: "post", connectionId: "" }),
      ],
      edges: [e("trigger", "import"), e("import", "clean"), e("clean", "post")],
    },
  },
  {
    id: "creator-reshare-review",
    name: "Creator you follow posts → clean & rewrite → your drafts",
    description:
      "Watch a creator's feed (their blog, newsletter, Substack, Medium or YouTube). Each new post is cleaned up, rewritten in fresh words with a credit line and hashtags, and waits in Social → Drafts for you to approve.",
    category: "Social media",
    apps: ["rss", "sparkles", "linkedin"],
    graph: {
      nodes: [
        n("trigger", "rss.watch", 40, 200, "Creator posts something", { url: "https://their-newsletter.substack.com/feed", intervalMin: 60 }),
        n("clean", "social.rewrite", 320, 200, "Clean & rewrite", { text: "{{trigger.title}}\n\n{{trigger.summary}}", style: "rewrite", author: "Creator name", url: "{{trigger.link}}", credit: "true", maxTags: 5 }),
        n("draft", "social.draft", 600, 200, "Save to my drafts", { text: "{{steps.clean.text}}", mode: "draft" }),
      ],
      edges: [e("trigger", "clean"), e("clean", "draft")],
    },
  },
  {
    id: "paste-post-to-linkedin",
    name: "Send a copied post → clean it → post on my LinkedIn",
    description:
      "Send any post's text to this workflow's webhook (from a phone shortcut, a form or another app) with the author's name and link. It removes the clutter, adds credit and hashtags, and posts it on your LinkedIn.",
    category: "Social media",
    apps: ["webhook", "sparkles", "linkedin"],
    graph: {
      nodes: [
        n("trigger", "trigger.webhook", 40, 200, "Post text received", { respond: "accepted" }),
        n("clean", "social.rewrite", 320, 200, "Clean it", { text: "{{trigger.body.text}}", style: "clean", author: "{{trigger.body.author}}", url: "{{trigger.body.url}}", credit: "true", maxTags: 5 }),
        n("post", "social.draft", 600, 200, "Post on LinkedIn", { text: "{{steps.clean.text}}", fileUrl: "{{trigger.body.fileUrl}}", mode: "post", connectionId: "" }),
      ],
      edges: [e("trigger", "clean"), e("clean", "post")],
    },
  },
  {
    id: "youtube-to-socials",
    name: "New YouTube video → X, LinkedIn, Facebook & Bluesky",
    description: "When your channel publishes a video, AI writes a short post and shares it everywhere at once.",
    category: "Social media",
    apps: ["youtube", "sparkles", "twitter", "linkedin", "facebook"],
    graph: {
      nodes: [
        n("trigger", "youtube.watch", 40, 220, "New video", { channelId: "", intervalMin: 15 }),
        n("write", "ai.prompt", 300, 220, "Write the post", {
          system: "You write upbeat, specific social posts. No hashtags spam: at most 2. Under 240 characters.",
          prompt: "Write a post announcing this new video. Title: {{trigger.title}}. Description: {{trigger.description}}",
        }),
        n("router", "flow.router", 560, 220, "Share everywhere"),
        n("x", "x.post", 800, 40, "Post on X", { text: "{{steps.write.text}} {{trigger.link}}" }),
        n("li", "linkedin.post", 800, 160, "Share on LinkedIn", { text: "{{steps.write.text}}", link: "{{trigger.link}}" }),
        n("fb", "facebook.post", 800, 280, "Post to Page", { message: "{{steps.write.text}}", link: "{{trigger.link}}" }),
        n("bsky", "bluesky.post", 800, 400, "Post on Bluesky", { text: "{{steps.write.text}}", link: "{{trigger.link}}" }),
      ],
      edges: [e("trigger", "write"), e("write", "router"), e("router", "x"), e("router", "li"), e("router", "fb"), e("router", "bsky")],
    },
  },
  {
    id: "blog-to-instagram",
    name: "New blog post → Instagram + LinkedIn",
    description: "Watch your blog's RSS feed; when a post goes live, share it on LinkedIn and post your cover image to Instagram.",
    category: "Social media",
    apps: ["rss", "sparkles", "instagram", "linkedin"],
    graph: {
      nodes: [
        n("trigger", "rss.watch", 40, 160, "New blog post", { url: "https://yourblog.com/feed", intervalMin: 30 }),
        n("caption", "ai.prompt", 300, 160, "Write caption", { prompt: "Write a friendly Instagram caption (max 3 short lines + 3 hashtags) for this article: {{trigger.title}} — {{trigger.summary}}" }),
        n("ig", "instagram.post", 560, 60, "Post to Instagram", { kind: "photo", mediaUrl: "https://yourblog.com/cover.jpg", caption: "{{steps.caption.text}}" }),
        n("li", "linkedin.post", 560, 260, "Share on LinkedIn", { text: "New on the blog: {{trigger.title}}", link: "{{trigger.link}}" }),
      ],
      edges: [e("trigger", "caption"), e("caption", "ig"), e("caption", "li")],
    },
  },
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
