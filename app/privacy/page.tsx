import { SiteFooter, SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-4xl font-bold">Privacy policy</h1>
        <p className="mt-6 rounded-lg border border-spark bg-spark-tint p-4 text-sm">
          Placeholder. Describe what you collect (account details, workflow data, run logs), where it is stored, how long you keep run history, which processors you use (hosting, Stripe, Razorpay, AI providers) and how users can delete their data.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
