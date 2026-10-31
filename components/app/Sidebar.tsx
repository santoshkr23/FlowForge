"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, CreditCard, KeyRound, LayoutGrid, LayoutTemplate, Megaphone, Plug, Shield, Users, Workflow } from "lucide-react";
import { Logo } from "../Logo";
import { api } from "@/lib/client";

const NAV = [
  { href: "/app", label: "Overview", icon: LayoutGrid },
  { href: "/app/workflows", label: "Workflows", icon: Workflow },
  { href: "/app/executions", label: "Run history", icon: Activity },
  { href: "/app/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/app/social", label: "Social", icon: Megaphone },
  { href: "/app/connections", label: "Connections", icon: Plug },
  { href: "/app/team", label: "Team", icon: Users },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/settings", label: "API & MCP", icon: KeyRound },
];

type Props = {
  user: { name: string | null; email: string };
  org: { id: string; name: string; plan: string };
  orgs: { id: string; name: string }[];
  credits: { left: number; total: number };
  isSuperAdmin: boolean;
};

export function Sidebar({ user, org, orgs, credits, isSuperAdmin }: Props) {
  const path = usePathname();
  const router = useRouter();
  const pct = credits.total ? Math.min(100, Math.round(((credits.total - Math.min(credits.left, credits.total)) / credits.total) * 100)) : 0;

  async function switchOrg(id: string) {
    await api("/api/auth/switch", { body: { orgId: id } });
    router.push("/app");
    router.refresh();
  }

  // The builder needs the room: show a slim icon rail there instead of the full sidebar.
  if (/^\/app\/workflows\/[^/]+$/.test(path)) {
    return (
      <nav aria-label="Main" className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-paper py-3 md:flex">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} title={label} aria-label={label} className={`rounded-lg p-2.5 ${href === "/app/workflows" ? "bg-wire-tint text-wire-dark" : "text-ink-soft hover:bg-canvas"}`}>
            <Icon size={18} aria-hidden />
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <aside className="flex w-full flex-col border-b border-line bg-paper md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
      <div className="px-5 py-4">
        <Logo href="/app" />
      </div>
      <div className="px-3">
        {orgs.length > 1 ? (
          <select aria-label="Workspace" className="input" value={org.id} onChange={(e) => switchOrg(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="truncate px-2 text-sm font-medium">{org.name}</p>
        )}
      </div>
      <nav className="mt-3 flex gap-1 overflow-x-auto px-3 md:flex-col" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = href === "/app" ? path === "/app" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${on ? "bg-wire-tint font-medium text-wire-dark" : "text-ink-soft hover:bg-canvas hover:text-ink"}`}
            >
              <Icon size={17} aria-hidden />
              {label}
            </Link>
          );
        })}
        {isSuperAdmin && (
          <Link href="/admin" className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-canvas">
            <Shield size={17} aria-hidden />
            Admin
          </Link>
        )}
      </nav>
      <div className="mt-auto hidden space-y-4 p-4 md:block">
        <Link href="/app/billing" className="block rounded-lg border border-line p-3 text-sm hover:border-ink-faint">
          <div className="flex justify-between">
            <span className="font-medium">{org.plan.charAt(0) + org.plan.slice(1).toLowerCase()} plan</span>
            <span className="text-ink-soft">{credits.left.toLocaleString()} left</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Credits used this month">
            <div className={`h-full ${pct > 85 ? "bg-bad" : "bg-wire"}`} style={{ width: `${pct}%` }} />
          </div>
        </Link>
        <div className="flex items-center justify-between text-sm">
          <span className="truncate text-ink-soft" title={user.email}>
            {user.name ?? user.email}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="text-ink-soft underline hover:text-ink">Sign out</button>
          </form>
        </div>
      </div>
    </aside>
  );
}
