# FlowForge

A visual workflow-automation SaaS you can sell: customers sign up, draw workflows on a canvas, connect their apps, run them on schedules or webhooks, and pay you monthly in **₹ (Razorpay: UPI/cards)** or **$ (Stripe)**. Usage is metered in credits.

## What's included

| Area | What it does |
|---|---|
| Marketing site | Landing page, pricing (₹/$ toggle), terms & privacy placeholders |
| Accounts | Email + password sign-up/sign-in, workspaces, switch between workspaces |
| Builder | Drag-and-drop canvas, step palette, settings panel, click-to-insert data mapping, "Run once" with per-step input/output |
| Engine | Branching (router + filters), iterator (loop over lists), sub-workflows, delays, variables, per-step "continue on error", 5-min step timeout, credit metering |
| Triggers | Manual / API / MCP, schedule (interval or cron), webhook (instant 202 or wait and return a custom response), and **watch triggers**: new Gmail email, new YouTube video, new RSS item, new Google Sheets row, new Shopify / WooCommerce / Squarespace order, Twitch channel goes live |
| Apps (60+) | **Social:** Instagram, Facebook Pages, X, LinkedIn, YouTube, Pinterest, Bluesky, Mastodon, Tumblr, Reddit, Twitch, VK, Discourse, Manychat · **Messaging:** WhatsApp Business, Slack, Discord, Telegram, Twilio, Teams · **Email:** Gmail, Outlook, SMTP, Mailchimp, Brevo, SendGrid · **CRM & support:** HubSpot, Zoho CRM, Pipedrive, Freshdesk, Zendesk · **Commerce:** Shopify, WooCommerce, Squarespace, WordPress · **Productivity:** Google Sheets/Drive/Calendar, Notion, Airtable, Trello, Asana, ClickUp, Todoist, Zoom, Dropbox · **Dev & data:** HTTP, JavaScript, GitHub, Jira, Linear, Supabase, PostgreSQL, RSS, Bitly · **Payments:** Razorpay, Stripe, Cashfree, Instamojo · **AI:** OpenAI/Claude text + agents |
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

## Deploy free (Render + Neon)

1. **Database** — neon.tech → sign up → create a project → copy the connection string (`postgresql://…?sslmode=require`).
2. **App** — render.com → sign up with GitHub → **New → Blueprint** → pick this repo. Render reads `render.yaml` and asks for:
   `DATABASE_URL` (from Neon), `AUTH_SECRET` and `ENCRYPTION_KEY` (two outputs of `openssl rand -hex 32`), `ADMIN_EMAILS`, and `APP_URL` (`https://<service-name>.onrender.com`).
3. Wait for the first deploy (~5 min). Tables are created automatically on start.

Free Render services sleep after 15 minutes without visitors and take ~1 minute to wake, so schedules don't fire while asleep. Before selling, switch the service to the Starter plan in `render.yaml` or the dashboard.

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

## Social publisher (/app/social)

Write one post and send it to every connected social account, now or at a set time.

- **Accounts**: anything connected on the Connections page — LinkedIn (your profile), Facebook Page + its linked Instagram, X, Bluesky, Mastodon, Discord and Slack webhooks.
- **Attachments**: a picture (JPG/PNG/GIF/WebP) or a PDF, up to 20 MB. On LinkedIn a PDF becomes a swipeable document carousel (Documents API); pictures use the Images API. Where a platform can't take the file (PDF on Facebook/X/Slack) a download link is added instead. Instagram needs a picture.
- **Hashtags**: "Suggest hashtags" uses your AI key if set (OPENAI_API_KEY / ANTHROPIC_API_KEY), otherwise keywords from the post plus popular tags for its topics. LinkedIn hashtags are sent in LinkedIn's clickable format.
- **Scheduling**: the built-in scheduler (or the worker) checks every 30 s. 1 credit per account per post.
- **Copy & clean someone's post**: paste a post you copied from LinkedIn; FlowForge strips the clutter ("…see more", reaction counts, the name/time header, "follow me / repost ♻️" lines, old hashtags), optionally rewrites it with AI, adds a credit line and hashtags. Save it to **Drafts** or post it. LinkedIn's API doesn't let apps read other people's posts or profiles, so watching a person automatically works only through a feed they publish (blog, newsletter, Substack, Medium, YouTube) — see the templates "Creator you follow posts → clean & rewrite → your drafts" and "Send a copied post → clean it → post on my LinkedIn" (webhook). Workflow steps: `social.rewrite`, `social.draft`.
- **LinkedIn company pages** need LinkedIn's Community Management API (scope `w_organization_social`), which LinkedIn approves separately; personal profiles work with "Share on LinkedIn".
- Files are stored in the database and served at an unguessable public link so Facebook/Instagram can fetch them — set APP_URL to your public address.

### Auto-repost from profiles (Social page, bottom)

Add a person's LinkedIn profile link. Every 30 min–1 day FlowForge checks for new posts; the first check only remembers existing posts. Each new post is fetched with all its pictures (up to 20, posted as a LinkedIn multi-image post) or its PDF, cleaned, given your hashtags (only mine / mine + suggested / mine + author's) and sign-off, then posted or saved as a draft. LinkedIn often hides profiles from servers — if a check reports that, add a feed link for the person instead. Workflow trigger: "LinkedIn: someone posts" (`linkedin.profile_watch`).

## One-click app sign-in ("Connect with Google / Facebook / X …")

Customers connect most apps by pasting a key. For the big platforms they expect a **Connect with …** button, and that button only works after **you** (the platform owner) register a free developer app with each provider. Until you do, the button is hidden and the app shows a short note instead.

For every provider:
- Set the redirect / callback URL to **`https://YOUR_DOMAIN/api/oauth/callback`** (exactly; one URL for all providers).
- Put the keys in your host's environment as `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_CLIENT_SECRET`, then redeploy.

| Provider | Env prefix | Covers | Where to register | Review before the public can use it |
|---|---|---|---|---|
| Google | `GOOGLE_` | Gmail, Drive, Calendar, Sheets, YouTube | console.cloud.google.com → APIs & Services → enable Gmail, Drive, Calendar, Sheets, YouTube Data APIs → OAuth consent screen → Credentials → OAuth client (Web) | Yes. Gmail read access is a "restricted" scope (needs a security assessment); YouTube uploads stay *private* until Google audits the app. Up to 100 test users work immediately. |
| Facebook / Instagram | `FACEBOOK_` | Facebook Pages, Instagram | developers.facebook.com → Create app (Business) → add Facebook Login for Business + Instagram Graph API | Yes, App Review for `pages_manage_posts`, `instagram_content_publish`, etc. Works for your own accounts (app roles) before review. |
| X (Twitter) | `TWITTER_` | X posts | developer.x.com → Project → App → User authentication settings → OAuth 2.0, type "Web App", read+write | Free tier allows a limited number of posts per month; paid tiers raise it. |
| LinkedIn | `LINKEDIN_` | LinkedIn posts | linkedin.com/developers → Create app → Products: "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" | Self-serve for personal posting. Company-page posting needs the Community Management API (application). Optional `LINKEDIN_VERSION` (YYYYMM). |
| Microsoft | `MICROSOFT_` | Outlook, Teams | portal.azure.com → App registrations → New (any org + personal accounts) → Web redirect → Certificates & secrets | Publisher verification recommended; some organisations require admin consent. |
| Pinterest | `PINTEREST_` | Pins | developers.pinterest.com → My apps → Connect app | Trial access first; request Standard access for public use. |
| Zoho | `ZOHO_` | Zoho CRM | api-console.zoho.in → Server-based application. Set `ZOHO_ACCOUNTS_URL` for your data centre (default `https://accounts.zoho.in`). | No. |
| Dropbox | `DROPBOX_` | Dropbox uploads | dropbox.com/developers → Create app (scoped, files.content.write) | Production approval after 50 users. |
| Tumblr | `TUMBLR_` | Tumblr posts | tumblr.com/oauth/apps → Register application (OAuth2 redirect) | No. |

Meta API version can be pinned with `META_GRAPH_VERSION` (default `v23.0`); Shopify with `SHOPIFY_API_VERSION` (default `2026-07`).

### Apps that are not included (yet) and why
- **TikTok** — posting needs TikTok's Content Posting API audit and a verified domain; unaudited apps can only post privately.
- **Buffer, Metricool, Blotato, SocialBee, Vista Social, WoopSocial, ContentStudio** — no open public API for new developers, or only for partners. If a customer has API access, the HTTP request step can call it.
- **Foursquare** — the Places API is changing hosts/versions; use the HTTP step with a key.
- **Threads** — separate Meta OAuth app; planned.

### Adding more apps
Each app is a catalog entry in `lib/engine/catalog-apps.ts` plus a short function in `lib/engine/modules/*.ts` (watch triggers: `lib/engine/pollers.ts`). `tests/apps.test.ts` shows how to test one against a simulated API.

## Before a public launch — read this
- **Code checks**: ESLint was removed (its dependencies carry unfixed `minimatch`/`glob` advisories). TypeScript type-checks every build; run `npm run check` for types + tests.
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
