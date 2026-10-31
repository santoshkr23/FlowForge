"use client";

import { useState } from "react";
import { Pause, Play, Plus, RefreshCw, Trash2, UserRoundSearch, X as Close } from "lucide-react";
import { AppIcon } from "../AppIcon";
import { api } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import { CHANNELS, type Account, type Channel } from "@/lib/social/channels";

export type WatchRow = {
  id: string;
  name: string;
  profileUrl: string | null;
  feedUrl: string | null;
  targets: string[];
  mode: string;
  style: string;
  credit: boolean;
  signature: string | null;
  hashtags: string[];
  tagMode: string;
  maxTags: number;
  intervalMin: number;
  active: boolean;
  seeded: boolean;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  postsMade: number;
};

const ICON: Record<Channel, string> = { linkedin: "linkedin", facebook: "facebook", instagram: "instagram", x: "twitter", bluesky: "bluesky", mastodon: "mastodon", discord: "discord", slack: "slack" };
const EVERY: [number, string][] = [
  [30, "30 minutes"],
  [60, "hour"],
  [120, "2 hours"],
  [360, "6 hours"],
  [1440, "day"],
];

type Form = Omit<WatchRow, "id" | "seeded" | "lastCheckedAt" | "nextCheckAt" | "lastError" | "postsMade"> & { tagInput: string };

const blank = (accounts: Account[], sig: string): Form => ({
  name: "",
  profileUrl: "",
  feedUrl: "",
  targets: accounts.filter((a) => a.channel === "linkedin").map((a) => a.target),
  mode: "post",
  style: "clean",
  credit: true,
  signature: sig,
  hashtags: [],
  tagMode: "mix",
  maxTags: 5,
  intervalMin: 60,
  active: true,
  tagInput: "",
});

export function Watches({ accounts, canEdit, initial }: { accounts: Account[]; canEdit: boolean; initial: WatchRow[] }) {
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showFeed, setShowFeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, string>>({});

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const lastSig = rows.find((r) => r.signature)?.signature ?? "";

  function open(w?: WatchRow) {
    setError("");
    setEditing(w?.id ?? null);
    setShowFeed(!!w?.feedUrl);
    setForm(w ? { ...w, profileUrl: w.profileUrl ?? "", feedUrl: w.feedUrl ?? "", signature: w.signature ?? "", tagInput: "" } : blank(accounts, lastSig));
  }

  function addTags(raw: string) {
    if (!form) return;
    const tags = raw
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
      .filter(Boolean);
    const next = [...form.hashtags];
    for (const t of tags) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    set({ hashtags: next.slice(0, 30), tagInput: "" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.tagInput.trim()) addTags(form.tagInput);
    setBusy(true);
    setError("");
    try {
      const { tagInput, ...rest } = form;
      const extra = tagInput
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#+/, ""))
        .filter(Boolean);
      const payload = { ...rest, hashtags: [...rest.hashtags, ...extra], signature: rest.signature ?? "", profileUrl: rest.profileUrl ?? "", feedUrl: rest.feedUrl ?? "" };
      const w = editing ? await api<WatchRow>(`/api/watches/${editing}`, { method: "PATCH", body: payload }) : await api<WatchRow>("/api/watches", { body: payload });
      setRows(editing ? rows.map((r) => (r.id === w.id ? w : r)) : [w, ...rows]);
      setForm(null);
      if (!editing) checkNow(w.id, true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkNow(id: string, quiet = false) {
    setChecking(id);
    try {
      const r = await api<{ newPosts: number; error?: string; firstCheck: boolean; watch: WatchRow }>(`/api/watches/${id}/check`, { body: {} });
      setRows((rs) => rs.map((x) => (x.id === id ? r.watch : x)));
      setFlash((f) => ({
        ...f,
        [id]: r.error
          ? ""
          : r.firstCheck
            ? "Connected. Their existing posts were skipped — new posts from now on will be picked up."
            : r.newPosts
              ? `${r.newPosts} new post${r.newPosts > 1 ? "s" : ""} handled — see History or Drafts (refresh the page).`
              : quiet
                ? ""
                : "No new posts since the last check.",
      }));
    } catch (e) {
      setFlash((f) => ({ ...f, [id]: (e as Error).message }));
    } finally {
      setChecking(null);
    }
  }

  async function toggle(w: WatchRow) {
    const r = await api<WatchRow>(`/api/watches/${w.id}`, { method: "PATCH", body: { ...w, profileUrl: w.profileUrl ?? "", feedUrl: w.feedUrl ?? "", signature: w.signature ?? "", active: !w.active } });
    setRows(rows.map((x) => (x.id === w.id ? r : x)));
  }

  async function remove(w: WatchRow) {
    if (!confirm(`Stop watching ${w.name}? Posts already made stay on your profile.`)) return;
    await api(`/api/watches/${w.id}`, { method: "DELETE" });
    setRows(rows.filter((x) => x.id !== w.id));
  }

  const nameOf = (t: string) => accounts.find((a) => a.target === t);

  return (
    <section className="panel mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg">
            <UserRoundSearch size={18} /> Auto-repost from profiles
          </h2>
          <p className="text-sm text-ink-soft">Add people you follow. When they post, FlowForge fetches the text, all pictures or the PDF, cleans it, adds your hashtags and posts it to your accounts.</p>
        </div>
        {canEdit && !form && (
          <button className="btn-primary" onClick={() => open()}>
            <Plus size={15} /> Add profile
          </button>
        )}
      </div>

      {form && (
        <form onSubmit={save} className="space-y-4 border-b border-line bg-canvas/50 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{editing ? `Edit ${form.name}` : "Watch a new profile"}</h3>
            <button type="button" aria-label="Close" className="p-1 text-ink-faint" onClick={() => setForm(null)}>
              <Close size={18} />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="w-name">
                Name
              </label>
              <input id="w-name" className="input" placeholder="Priya Sharma" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="w-profile">
                LinkedIn profile link
              </label>
              <input id="w-profile" className="input" placeholder="https://www.linkedin.com/in/priya-sharma" value={form.profileUrl ?? ""} onChange={(e) => set({ profileUrl: e.target.value })} />
            </div>
          </div>
          {showFeed ? (
            <div>
              <label className="label" htmlFor="w-feed">
                Feed link <span className="font-normal text-ink-faint">(optional — used instead of the profile)</span>
              </label>
              <input id="w-feed" className="input" placeholder="https://…/feed.xml" value={form.feedUrl ?? ""} onChange={(e) => set({ feedUrl: e.target.value })} />
              <p className="mt-1 text-xs text-ink-faint">
                LinkedIn often hides profiles from servers. If checks fail, paste an RSS feed of this person's posts — their newsletter, blog, Substack or Medium feed, or a LinkedIn-to-RSS feed from a feed service.
              </p>
            </div>
          ) : (
            <button type="button" className="text-sm text-wire underline" onClick={() => setShowFeed(true)}>
              Use a feed link instead (advanced)
            </button>
          )}

          <div>
            <span className="label">Post to</span>
            {accounts.length === 0 ? (
              <p className="text-sm text-ink-soft">Connect LinkedIn first on the Connections page.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => {
                  const on = form.targets.includes(a.target);
                  return (
                    <button
                      type="button"
                      key={a.target}
                      aria-pressed={on}
                      onClick={() => set({ targets: on ? form.targets.filter((t) => t !== a.target) : [...form.targets, a.target] })}
                      className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm ${on ? "border-wire bg-wire/10" : "border-line text-ink-soft"}`}
                    >
                      <AppIcon app={ICON[a.channel]} color={CHANNELS[a.channel].color} size={12} />
                      {a.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="label" htmlFor="w-mode">
                When they post
              </label>
              <select id="w-mode" className="input" value={form.mode} onChange={(e) => set({ mode: e.target.value })}>
                <option value="post">Post automatically</option>
                <option value="draft">Save as draft for me to check</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="w-style">
                Text
              </label>
              <select id="w-style" className="input" value={form.style} onChange={(e) => set({ style: e.target.value })}>
                <option value="clean">Clean up only (keep wording)</option>
                <option value="rewrite">Rewrite in my own words (AI)</option>
                <option value="short">Make it short (AI)</option>
                <option value="hook">Strong hook + question (AI)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="w-every">
                Check every
              </label>
              <select id="w-every" className="input" value={form.intervalMin} onChange={(e) => set({ intervalMin: Number(e.target.value) })}>
                {EVERY.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* hashtags */}
          <div className="rounded-lg border border-line bg-paper p-3">
            <span className="label">Hashtags</span>
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <div>
                <div className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 focus-within:border-wire">
                  {form.hashtags.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded-full bg-wire/10 px-2 py-0.5 text-xs">
                      #{t}
                      <button type="button" aria-label={`Remove ${t}`} onClick={() => set({ hashtags: form.hashtags.filter((x) => x !== t) })}>
                        <Close size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
                    placeholder={form.hashtags.length ? "Add more…" : "Your hashtags: #DataAnalytics #PowerBI — press Enter"}
                    value={form.tagInput}
                    onChange={(e) => set({ tagInput: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addTags(form.tagInput);
                      }
                    }}
                    onBlur={() => form.tagInput.trim() && addTags(form.tagInput)}
                    aria-label="Your hashtags"
                  />
                </div>
              </div>
              <select className="input" value={form.tagMode} onChange={(e) => set({ tagMode: e.target.value })} aria-label="Which hashtags">
                <option value="mix">Mine + suggested for the post</option>
                <option value="mine">Only mine</option>
                <option value="original">Mine + the author's</option>
                <option value="suggested">Suggested only</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                Max
                <input type="number" min={0} max={30} className="input w-20" value={form.maxTags} onChange={(e) => set({ maxTags: Number(e.target.value) })} aria-label="Maximum hashtags" />
              </label>
            </div>
            <p className="mt-1 text-xs text-ink-faint">Your hashtags are always added first; suggestions fill up to the max. The author's old hashtags are removed unless you pick "Mine + the author's".</p>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div>
              <label className="label" htmlFor="w-sig">
                My sign-off <span className="font-normal text-ink-faint">(added to every post)</span>
              </label>
              <input id="w-sig" className="input" placeholder="Follow me for daily data tips → linkedin.com/in/your-name" value={form.signature ?? ""} onChange={(e) => set({ signature: e.target.value })} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={form.credit} onChange={(e) => set({ credit: e.target.checked })} /> Credit the original author
            </label>
          </div>
          {!form.credit && form.mode === "post" && (
            <p className="rounded-lg bg-spark-tint p-2 text-xs">
              Posting other people's text, pictures or PDFs as your own without credit can get the post reported and removed by LinkedIn for copyright, and can get your account restricted. Keeping the credit line is safer.
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Start watching"}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 && !form ? (
        <p className="px-5 py-6 text-sm text-ink-soft">No profiles yet. Click "Add profile" and paste someone's LinkedIn profile link.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((w) => (
            <li key={w.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{w.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${w.active ? "bg-ok-tint text-ok" : "bg-canvas text-ink-soft"}`}>{w.active ? "Watching" : "Paused"}</span>
                  <span className="text-xs text-ink-faint">
                    {w.mode === "post" ? "posts automatically" : "saves drafts"} · every {EVERY.find(([v]) => v === w.intervalMin)?.[1] ?? `${w.intervalMin} min`} · {w.postsMade} post{w.postsMade === 1 ? "" : "s"} made
                  </span>
                </div>
                <div className="truncate text-xs text-ink-faint">{w.feedUrl || w.profileUrl}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {w.targets.map((t) => {
                    const a = nameOf(t);
                    return a ? (
                      <span key={t} className="flex items-center gap-1">
                        <AppIcon app={ICON[a.channel]} color={CHANNELS[a.channel].color} size={9} /> {a.name}
                      </span>
                    ) : null;
                  })}
                  {w.hashtags.length > 0 && <span className="text-ink-faint">· {w.hashtags.map((t) => `#${t}`).join(" ")}</span>}
                </div>
                <div className="mt-1 text-xs text-ink-faint">{w.lastCheckedAt ? `Checked ${timeAgo(w.lastCheckedAt)}` : "Not checked yet"}</div>
                {w.lastError && <p className="mt-1 text-xs text-bad">{w.lastError}</p>}
                {flash[w.id] && <p className="mt-1 text-xs text-ok">{flash[w.id]}</p>}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <button className="btn-quiet px-2 py-1 text-xs" onClick={() => checkNow(w.id)} disabled={checking === w.id}>
                    <RefreshCw size={13} className={checking === w.id ? "animate-spin" : ""} /> Check now
                  </button>
                  <button className="btn-quiet px-2 py-1 text-xs" onClick={() => open(w)}>
                    Edit
                  </button>
                  <button className="p-1.5 text-ink-faint hover:text-ink" aria-label={w.active ? "Pause" : "Resume"} onClick={() => toggle(w)}>
                    {w.active ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button className="p-1.5 text-ink-faint hover:text-bad" aria-label="Delete" onClick={() => remove(w)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
