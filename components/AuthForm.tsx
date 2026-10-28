"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const sp = useSearchParams();
  const invite = sp.get("invite") ?? undefined;
  const plan = sp.get("plan");
  const [email, setEmail] = useState(sp.get("email") ?? "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/${mode}`, { body: mode === "signup" ? { name, email, password, invite } : { email, password, invite } });
      router.push(plan ? `/app/billing?plan=${plan}` : "/app");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const q = sp.toString() ? `?${sp.toString()}` : "";

  return (
    <form onSubmit={submit} className="panel w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-bold">{mode === "signup" ? "Create your account" : "Sign in"}</h1>
      {invite && <p className="rounded-lg bg-wire-tint px-3 py-2 text-sm">You're joining a team workspace.</p>}
      {mode === "signup" && (
        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === "signup" ? 8 : 1}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
        {mode === "signup" && <p className="mt-1 text-xs text-ink-faint">At least 8 characters.</p>}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-ink-soft">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link className="text-wire underline" href={`/login${q}`}>
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link className="text-wire underline" href={`/signup${q}`}>
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
