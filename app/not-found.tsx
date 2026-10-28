import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid-bg flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-4xl font-bold">This page isn't wired up</h1>
      <p className="text-ink-soft">The link may be old, or the item was deleted.</p>
      <Link href="/app" className="btn-primary">
        Go to your workflows
      </Link>
    </main>
  );
}
