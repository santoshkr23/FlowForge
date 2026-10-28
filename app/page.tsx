import Link from "next/link";
import { HeroFlow } from "@/components/marketing/HeroFlow";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteHeader";
import { PricingTable } from "@/components/marketing/PricingTable";
import { AppIcon } from "@/components/AppIcon";
import { CATALOG } from "@/lib/engine/catalog";

const APP_TILES = Array.from(
  new Map(
    CATALOG.filter((m) => !/^(trigger|flow|data|datastore|workflow|code|http)\./.test(m.type)).map((m) => [m.app, { ...m, label: m.name.split(":")[0].replace(" (Twitter)", "").replace(" Page", "").replace(" Business", "").replace("Microsoft ", "") }]),
  ).values(),
).sort((a, b) => a.label.localeCompare(b.label));

const USES = [
  {
    title: "Sell without the busywork",
    body: "An order comes in, the customer gets a Razorpay link on email, the row lands in your sheet, and your team hears about it on Slack.",
  },
  {
    title: "Let AI read the inbox first",
    body: "Messages are summarised and sorted by urgency. Urgent ones ping you on Telegram; the rest wait in the queue.",
  },
  {
    title: "Reports that write themselves",
    body: "Every morning, pull numbers from any API, have AI turn them into three lines, and post them where your team already looks.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-8 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <h1 className="text-[2.6rem] font-bold sm:text-[3.4rem]">Wire your apps together. Then stop thinking about them.</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-soft">
              FlowForge runs the repetitive parts of your business: draw the steps once, connect your tools, and it handles every order, lead and report from then on — with AI where it helps.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="btn-primary px-5 py-3 text-base">
                Build your first workflow
              </Link>
              <Link href="/pricing" className="btn-quiet px-5 py-3 text-base">
                See pricing
              </Link>
            </div>
            <p className="mt-4 text-sm text-ink-faint">Free forever plan with 1,000 credits a month. No card needed.</p>
          </div>
          <HeroFlow />
        </section>

        <section className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="max-w-2xl text-3xl font-bold">What people build first</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {USES.map((u) => (
              <div key={u.title} className="border-l-2 border-wire pl-5">
                <h3 className="text-lg">{u.title}</h3>
                <p className="mt-2 text-ink-soft">{u.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="apps" className="mx-auto max-w-6xl px-5 py-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 className="text-3xl font-bold">{APP_TILES.length}+ apps, already connected</h2>
              <p className="mt-4 text-ink-soft">
                Social media, messaging, email, CRMs, stores, sheets, databases, payments and AI work out of the box. Anything else with an API is one HTTP step away, and a JavaScript step covers the odd case.
              </p>
            </div>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {APP_TILES.map((m) => (
                <li key={m.app} className="flex items-center gap-2.5 rounded-lg border border-line bg-paper px-2.5 py-2 text-sm">
                  <AppIcon app={m.app} color={m.color} size={12} />
                  <span className="leading-tight">{m.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-12">
          <div className="grid gap-6 rounded-2xl bg-ink p-8 text-white md:grid-cols-2 md:p-12">
            <div>
              <h2 className="text-3xl font-bold">AI agents that show their work</h2>
              <p className="mt-4 text-white/75">
                Give an agent a goal and a short list of tools it may use. Every run records each thought and tool call, so you can see exactly why it did what it did.
              </p>
            </div>
            <div>
              <h2 className="text-3xl font-bold">Run workflows from your AI chat</h2>
              <p className="mt-4 text-white/75">
                Add FlowForge to Claude or ChatGPT as an MCP server. Ask in plain words, and your own workflows do the work — on your data, with your rules.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="mb-2 text-3xl font-bold">Pay for what runs</h2>
          <p className="mb-8 max-w-2xl text-ink-soft">Each step that runs uses a credit. Triggers, filters and routers are free. Pay in rupees with UPI or card, or in dollars.</p>
          <PricingTable />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
