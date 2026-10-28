import { SiteFooter, SiteHeader } from "@/components/marketing/SiteHeader";
import { PricingTable } from "@/components/marketing/PricingTable";

export const metadata = { title: "Pricing" };

const FAQ = [
  { q: "What is a credit?", a: "One step running once. A workflow with a trigger and three steps uses three credits per run. AI steps use five, AI agents ten plus two per tool they call." },
  { q: "What happens when I run out?", a: "Runs pause with a clear message. Buy a credit pack or upgrade and they continue. Your workflows and history stay intact." },
  { q: "Can I pay with UPI?", a: "Yes. Rupee plans go through Razorpay, which takes UPI, cards and netbanking. Dollar plans go through Stripe." },
  { q: "Can I cancel any time?", a: "Yes, from the Billing page. You keep your plan until the end of the period you paid for, then move to Free." },
];

export default function Pricing() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="text-4xl font-bold">Pricing</h1>
        <p className="mb-10 mt-3 max-w-2xl text-lg text-ink-soft">Start free. Upgrade when your workflows start doing real work.</p>
        <PricingTable />
        <section className="mt-16 max-w-3xl">
          <h2 className="text-2xl font-bold">Questions</h2>
          <dl className="mt-6 space-y-6">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-1 text-ink-soft">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
