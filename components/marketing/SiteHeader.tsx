import Link from "next/link";
import { Logo } from "../Logo";

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
      <Logo />
      <nav className="flex items-center gap-1 text-sm sm:gap-4">
        <Link href="/#apps" className="hidden px-2 py-1 text-ink-soft hover:text-ink sm:inline">
          Apps
        </Link>
        <Link href="/pricing" className="hidden px-2 py-1 text-ink-soft hover:text-ink sm:inline">
          Pricing
        </Link>
        <Link href="/login" className="whitespace-nowrap px-2 py-1 text-ink-soft hover:text-ink">
          Sign in
        </Link>
        <Link href="/signup" className="btn-primary whitespace-nowrap">
          Start free
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <div className="flex flex-wrap gap-5">
          <Link href="/pricing">Pricing</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="mailto:hello@example.com">Contact</a>
        </div>
        <p>© {new Date().getFullYear()} FlowForge</p>
      </div>
    </footer>
  );
}
