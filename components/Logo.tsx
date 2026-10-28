import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-display text-lg font-bold text-ink">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <circle cx="5" cy="13" r="4" fill="#2B59C3" />
        <circle cx="21" cy="6" r="4" fill="#14213D" />
        <circle cx="21" cy="20" r="4" fill="#F2B705" />
        <path d="M9 13 C14 13 13 6 17 6 M9 13 C14 13 13 20 17 20" stroke="#2B59C3" strokeWidth="2" fill="none" />
      </svg>
      FlowForge
    </Link>
  );
}
