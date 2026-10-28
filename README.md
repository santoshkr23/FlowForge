# FlowForge

A visual workflow-automation SaaS you can sell: customers sign up, draw workflows on a canvas, connect their apps, run them on schedules or webhooks, and pay you monthly in **₹ (Razorpay: UPI/cards)** or **$ (Stripe)**. Usage is metered in credits.

## What's included

| Area | What it does |
|---|---|
| Marketing site | Landing page, pricing (₹/$ toggle), terms & privacy placeholders |
| Accounts | Email + password sign-up/sign-in, workspaces, switch between workspaces |
| Builder | Drag-and-drop canvas, step palette, settings panel, click-to-insert data mapping, "Run once" with per-step input/output |
| Engine | Branching (router + filters), iterator (loop over lists), sub-workflows, delays, variables, per-step "continue on error", 5-min step timeout, credit metering |
| Triggers | Manual / API / MCP, schedule (interval or cron), webhook (instant 202 or wait and return a custom response) |
| Apps (30 steps) | HTTP, JavaScript code, AI text (OpenAI or Claude), AI agent with tools, Email (SMTP), Slack, Discord, Telegram, Twilio SMS/WhatsApp, Google Sheets, Notion, Airtable, GitHub, Razorpay & Stripe payment links, data stores |
| AI | "Describe it" → AI drafts the workflow; agent step records every thought and tool call |
| Observability | Dashboard, run history with filters and full-text search, step-by-step run logs |
| Teams | Invites, roles (Owner / Admin / Builder / Viewer), seat limits per plan, activity (audit) log |
| Billing | Plans + credit packs via Razorpay subscriptions/orders and Stripe Checkout/Portal, signed webhooks, idempotent, monthly credit refill |
| API | REST (`/api/v1`) and an **MCP server** (`/api/mcp`) so customers can run their workflows from Claude/ChatGPT |
| Admin | `/admin` for you: revenue, workspaces, change any plan, gift credits, disable users |
| Security | Credentials AES-256-GCM encrypted, API keys stored hashed, SSRF protection on HTTP steps, plan gates enforced server-side |

Plans, prices and limits live in **`lib/plans.ts`** — edit them there.

## Run it locally (no Docker needed)

```bash
npm install
cp .env.example .env.local
# in .env.local set:
#   DATABASE_URL=pglite://./.pglite        ← embedded Postgres in a folder, zero setup
#   AUTH_SECRET=<openssl rand -hex 32>
#   ENCRYPTION_KEY=<openssl rand -hex 32>
#   ADMIN_EMAILS=you@yourmail.com
npm run db:migrate
npm run dev
```

Open http://localhost:3000, sign up with your `ADMIN_EMAILS` address, and you'll see **Admin** in the sidebar.

Without `REDIS_URL`, the web server runs workflows and schedules itself — fine for development and small launches.

## Deploy in 10 minutes (Railway)

1. railway.com → **New project → Deploy from GitHub repo** → pick this repo.
2. In the project, **+ New → Database → PostgreSQL**.
3. On the app service → **Variables**, add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `AUTH_SECRET`, `ENCRYPTION_KEY` = two different outputs of `openssl rand -hex 32`
   - `ADMIN_EMAILS` = your email
   - `APP_URL` = the public URL from step 4
4. App service → **Settings → Networking → Generate domain**.

`railway.json` already sets the build and start commands; the database is migrated on every start, and scheduled workflows run inside the web server until you add Redis + the worker.

**Keep `ENCRYPTION_KEY` safe and never change it** — it decrypts your customers' saved app logins.

## Production

1. **Postgres** — Neon, Supabase, Railway or RDS. Set `DATABASE_URL=postgresql://…` and run `npm run db:migrate`.
2. **Redis** (recommended) — Upstash or Railway. Set `REDIS_URL`.
3. **Web app** — `npm run build && npm start` (Vercel, Railway, Render, a VPS…).
4. **Worker** — on any always-on host: `npm run worker`. It runs queued workflows and fires schedules. Run more copies to scale; scheduling is double-fire safe.
5. Set `APP_URL` to your real domain (used for webhook URLs, payment redirects and invites).

> Vercel note: serverless functions can't run the always-on worker. Host the worker on Railway/Render/a VPS and point both at the same Postgres + Redis.

## Setting up payments

### Razorpay (India — UPI, cards, netbanking)
1. Dashboard → **Subscriptions → Plans**: create monthly plans matching `lib/plans.ts` (₹799 Starter, ₹1,399 Pro, ₹2,499 Teams). Put their ids in `RAZORPAY_PLAN_STARTER/PRO/TEAMS`.
2. **Settings → API Keys** → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
3. **Settings → Webhooks** → URL `https://YOUR_DOMAIN/api/billing/razorpay/webhook`, a secret (`RAZORPAY_WEBHOOK_SECRET`), events: `subscription.*` and `payment.captured`.

### Stripe (international — USD)
1. Create a product with three monthly prices ($9 / $16 / $29) → `STRIPE_PRICE_STARTER/PRO/TEAMS`. Optional one-time price for credit packs → `STRIPE_PRICE_CREDITS_10K`.
2. `STRIPE_SECRET_KEY` from Developers → API keys.
3. Webhook endpoint `https://YOUR_DOMAIN/api/billing/stripe/webhook` with events `checkout.session.completed`, `customer.subscription.*`, `invoice.paid` → `STRIPE_WEBHOOK_SECRET`.
4. Turn on the **Customer portal** (Settings → Billing → Customer portal) so customers can change/cancel.

Use test keys first; both providers have test cards/UPI. Webhooks are the source of truth — plans activate even if the customer closes the tab.

Before going live, both providers require real **Terms, Privacy and Refund** pages — replace the placeholders in `app/terms` and `app/privacy`.

## AI features
Set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` (choose with `AI_PROVIDER`). This powers the AI text step, AI agents and "Draft with AI". AI usage is billed to **your** key, so the credit costs in `lib/engine/catalog.ts` (5 per AI step, 10 + 2/tool per agent) are what protect your margin — adjust them to your token prices.

## Customers connecting from Claude / ChatGPT (MCP)
On Pro and above, customers create an API key under **API & MCP**, then add a remote MCP server:
- URL: `https://YOUR_DOMAIN/api/mcp`
- Header: `Authorization: Bearer ff_…`

Tools exposed: `list_workflows`, `run_workflow`, `get_execution`.

## Adding a new app
1. Add its metadata and fields to `CATALOG` in `lib/engine/catalog.ts` (and credentials shape to `APPS` if it needs a login).
2. Add the runtime function in `lib/engine/modules/apps.ts` (same key as `type`).

That's it — it appears in the builder palette, the landing page and the AI drafter automatically.

## Before a public launch — read this
- **Code steps**: `code.javascript` uses Node's `vm` with a timeout. That is *not* a security boundary against a determined attacker. Before letting the public run code, swap it for [`isolated-vm`](https://github.com/laverdet/isolated-vm) or run code steps in a separate container — or keep it disabled by raising its `minPlan` to `ENTERPRISE`.
- **Rate limiting**: login has a basic in-memory throttle; put a real limiter (Upstash, Cloudflare) in front of `/api/auth/*` and `/api/hooks/*`.
- **Email**: set `SMTP_*` so invites are emailed (otherwise the invite link is shown to the admin to share).
- **Backups**: enable daily backups on your Postgres.

## Project map
```
app/                 pages (marketing, /app, /admin) and API routes
  api/hooks/[token]  public webhook trigger
  api/v1, api/mcp    public API + MCP server
  api/billing/*      Stripe + Razorpay checkout and webhooks
components/builder   the canvas editor
db/schema.ts         database tables (Drizzle) → db/migrations
lib/engine           catalog, runner, modules, scheduler, queue
lib/billing          stripe.ts, razorpay.ts
lib/plans.ts         prices and limits
worker/index.ts      background worker
tests/               engine tests (npm test)
```

Schema change? Edit `db/schema.ts`, then `npm run db:generate && npm run db:migrate`.
