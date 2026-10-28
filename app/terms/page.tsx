import { SiteFooter, SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = { title: "Terms" };

export default function Terms() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-4xl font-bold">Terms of service</h1>
        <p className="mt-6 rounded-lg border border-spark bg-spark-tint p-4 text-sm">
          Placeholder. Replace this page with terms written for your business (your legal entity, refund policy, acceptable use, governing law) before you take payments. Razorpay and Stripe both require published terms, a refund policy and a privacy policy.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
