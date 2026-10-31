"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CalendarClock, Download, FilePen, FileText, Hash, ImageIcon, Paperclip, Repeat2, Send, Sparkles, Trash2, X as Close } from "lucide-react";
import { AppIcon } from "../AppIcon";
import { api } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import { CHANNELS, xLength, type Account, type Channel } from "@/lib/social/channels";

type Result = { target: string; app: string; account?: string; ok: boolean; url?: string; error?: string; note?: string };
type PostRow = {
  id: string;
  text: string;
  link: string | null;
  mediaId: string | null;
  mediaTitle: string | null;
  targets: string[];
  status: string;
  scheduledAt: string | null;
  postedAt: string | null;
  results: Result[] | null;
  createdAt: string;
};
type Upload = { id: string; name: string; mime: string; size: number; url: string };

const ICON: Record<Channel, string> = { linkedin: "linkedin", facebook: "facebook", instagram: "instagram", x: "twitter", bluesky: "bluesky", mastodon: "mastodon", discord: "discord", slack: "slack" };
const STATUS: Record<string, [string, string]> = {
  scheduled: ["Scheduled", "bg-spark-tint text-ink"],
  posting: ["Posting…", "bg-spark-tint text-ink"],
  posted: ["Posted", "bg-ok-tint text-ok"],
  partial: ["Partly posted", "bg-spark-tint text-ink"],
  failed: ["Failed", "bg-bad-tint text-bad"],
  deleted: ["Deleted", "bg-canvas text-ink-soft"],
};

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export function Social({ accounts, canEdit, initialPosts }: { accounts: Account[]; canEdit: boolean; initialPosts: PostRow[] }) {
  const [posts, setPosts] = useState(initialPosts);
  const [selected, setSelected] = useState<string[]>(() => accounts.filter((a) => a.channel === "linkedin").map((a) => a.target));
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<Upload | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagSource, setTagSource] = useState<"ai" | "keywords" | null>(null);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [repost, setRepost] = useState(false);
  const [srcUrl, setSrcUrl] = useState("");
  const [srcName, setSrcName] = useState("");
  const [srcText, setSrcText] = useState("");
  const [style, setStyle] = useState<"clean" | "rewrite" | "short" | "hook">("clean");
  const [credit, setCredit] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const liAccounts = accounts.filter((a) => a.channel === "linkedin");
  const [cAcc, setCAcc] = useState(liAccounts[0]?.connectionId ?? "");
  const [cUrl, setCUrl] = useState("");
  const [cText, setCText] = useState("");
  const [cMsg, setCMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [cBusy, setCBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = accounts.filter((a) => selected.includes(a.target));
  const fullText = [text, link].filter((s) => s.trim()).join("\n\n");
  const used = useMemo(() => new Set([...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase())), [text]);
  const warnings = chosen.flatMap((a) => {
    const c = CHANNELS[a.channel];
    const out: string[] = [];
    if (a.channel === "instagram" && (!file || file.mime === "application/pdf")) out.push(`${a.name}: Instagram needs a picture`);
    if (a.channel === "x" && xLength(fullText) > 280) out.push(`${a.name}: ${xLength(fullText)}/280 characters`);
    else if (a.channel === "bluesky" && [...fullText].length > 300) out.push(`${a.name}: ${[...fullText].length}/300 characters`);
    else if (c.limit && a.channel !== "x" && [...text].length > c.limit) out.push(`${a.name}: over ${c.limit} characters`);
    if (file?.mime === "application/pdf" && c.media !== "image+pdf" && a.channel !== "instagram") out.push(`${a.name}: PDF will be shared as a download link`);
    return out;
  });
  const blocking = warnings.filter((w) => !w.includes("download link"));

  function toggle(t: string) {
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  }

  async function upload(f: File) {
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      setFile(data as Upload);
      setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
      if (f.type === "application/pdf" && !title) setTitle(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function suggest() {
    setTagBusy(true);
    try {
      const r = await api<{ tags: string[]; source: "ai" | "keywords" }>("/api/posts/hashtags", { body: { text: [text, title, srcName].join("\n") } });
      setTags(r.tags);
      setTagSource(r.source);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setTagBusy(false);
    }
  }

  function addTags(list: string[]) {
    const fresh = list.filter((t) => !used.has(t.toLowerCase()));
    if (!fresh.length) return;
    const line = fresh.map((t) => `#${t}`).join(" ");
    setText((s) => {
      const body = s.replace(/\s+$/, "");
      // keep hashtags together on the last line
      return /(^|\n)(#[\p{L}\p{N}_]+\s*)+$/u.test(body) ? `${body} ${line}` : `${body}${body ? "\n\n" : ""}${line}`;
    });
  }

  async function cleanIt() {
    if (!srcText.trim()) return;
    setCleaning(true);
    setMsg(null);
    try {
      const r = await api<{ text: string; hashtags: string[]; source: "ai" | "clean" }>("/api/posts/rewrite", {
        body: { text: srcText, style, author: srcName || undefined, url: srcUrl || undefined, credit },
      });
      setText(r.text);
      setTags(r.hashtags);
      setTagSource(null);
      setRepost(false);
      setMsg({
        ok: true,
        text:
          r.source === "ai"
            ? "Rewritten and cleaned — check it reads right, then post or save as a draft."
            : style === "clean"
              ? "Cleaned — clutter, follow/repost asks and old hashtags removed. Check it, then post or save as a draft."
              : "Cleaned. AI rewriting needs an OpenAI or Anthropic key on the server, so the original wording was kept.",
      });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setCleaning(false);
    }
  }

  async function importLink() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setMsg(null);
    try {
      const r = await api<{ text: string; hashtags: string[]; source: string; media: Upload | null; title: string; notes: string[]; post: { author?: string; document?: unknown; images: string[] } }>(
        "/api/posts/import",
        { body: { url: importUrl, style, credit } },
      );
      setText(r.text);
      setTags(r.hashtags);
      setTagSource(null);
      setFile(r.media);
      setPreview(r.media?.mime.startsWith("image/") ? r.media.url : null);
      setTitle(r.title || "");
      setSrcName(r.post.author ?? "");
      if (!selected.length) setSelected(accounts.filter((a) => a.channel === "linkedin").map((a) => a.target));
      const got = [r.media ? (r.media.mime === "application/pdf" ? "the PDF" : "the picture") : null, "the text"].filter(Boolean).join(" and ");
      setMsg({ ok: true, text: [`Fetched ${got}${r.post.author ? ` from ${r.post.author}'s post` : ""} and cleaned it. Check it, then post.`, ...r.notes].join(" ") });
      setImportUrl("");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setImporting(false);
    }
  }

  async function sendComment(e: React.FormEvent) {
    e.preventDefault();
    setCBusy(true);
    setCMsg(null);
    try {
      const r = await api<{ url: string }>("/api/social/comment", { body: { connectionId: cAcc, postUrl: cUrl, text: cText } });
      setCMsg({ ok: true, text: "Comment posted.", url: r.url });
      setCText("");
    } catch (err) {
      setCMsg({ ok: false, text: (err as Error).message });
    } finally {
      setCBusy(false);
    }
  }

  async function unpublish(id: string) {
    if (!confirm("Delete this post from LinkedIn / X? This can't be undone.")) return;
    try {
      const r = await api<{ post: PostRow; out: { account?: string; ok: boolean; error?: string }[] }>(`/api/posts/${id}/unpublish`, { body: {} });
      setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, ...r.post, createdAt: p.createdAt } : p)));
      const bad = r.out.filter((o) => !o.ok);
      if (bad.length) alert(bad.map((o) => `${o.account}: ${o.error}`).join("\n"));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function editDraft(p: PostRow) {
    setDraftId(p.id);
    setText(p.text);
    setLink(p.link ?? "");
    setTitle(p.mediaTitle ?? "");
    setFile(p.mediaId ? { id: p.mediaId, name: p.mediaTitle || "Attached file", mime: "application/octet-stream", size: 0, url: "" } : null);
    setPreview(null);
    if (p.targets.length) setSelected(p.targets.filter((t) => accounts.some((a) => a.target === t)));
    setMsg({ ok: true, text: "Draft loaded — edit it, pick accounts and post or schedule." });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: React.FormEvent, asDraft = false) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const p = await api<PostRow>("/api/posts", {
        body: {
          text,
          link: link.trim() || undefined,
          mediaId: file?.id,
          mediaTitle: title.trim() || undefined,
          targets: selected,
          scheduledAt: mode === "later" ? new Date(when).toISOString() : undefined,
          draft: asDraft,
          fromDraft: draftId ?? undefined,
        },
      });
      setPosts([p, ...posts.filter((x) => asDraft || x.id !== draftId)]);
      if (!asDraft) setDraftId(null);
      const res = p.results ?? [];
      if (p.status === "draft") setMsg({ ok: true, text: "Saved to Drafts." });
      else if (p.status === "scheduled") setMsg({ ok: true, text: `Scheduled for ${new Date(p.scheduledAt!).toLocaleString()}.` });
      else if (p.status === "posted") setMsg({ ok: true, text: `Posted to ${res.length} account${res.length > 1 ? "s" : ""}.` });
      else setMsg({ ok: false, text: res.filter((r) => !r.ok).map((r) => `${r.account ?? r.app}: ${r.error}`).join(" · ") || "Posting failed" });
      if (p.status !== "failed") {
        setText("");
        setLink("");
        setFile(null);
        setPreview(null);
        setTitle("");
        setTags([]);
        setSrcName("");
        setSrcUrl("");
        setSrcText("");
        setDraftId(null);
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const p = posts.find((x) => x.id === id);
    if (!confirm(p?.status === "scheduled" ? "Cancel this scheduled post?" : p?.status === "draft" ? "Delete this draft?" : "Remove this from history? (It stays on the platforms.)")) return;
    try {
      await api(`/api/posts/${id}`, { method: "DELETE" });
      setPosts(posts.filter((x) => x.id !== id));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const drafts = posts.filter((p) => p.status === "draft");
  const scheduled = posts.filter((p) => p.status === "scheduled" || p.status === "posting");
  const history = posts.filter((p) => !["draft", "scheduled", "posting"].includes(p.status));
  const nameOf = (t: string) => accounts.find((a) => a.target === t);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      {/* ── Composer ───────────────────────────────────── */}
      <form onSubmit={submit} className="panel space-y-5 p-5">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg">Post to</h2>
            <Link href="/app/connections" className="text-sm text-wire underline">
              Connect more apps
            </Link>
          </div>
          {accounts.length === 0 ? (
            <p className="mt-2 rounded-lg bg-canvas p-4 text-sm text-ink-soft">
              No social accounts connected yet. Go to{" "}
              <Link href="/app/connections?add=linkedin" className="text-wire underline">
                Connections
              </Link>{" "}
              and connect LinkedIn, Facebook & Instagram, X, Bluesky, Mastodon, Discord or Slack — they'll show up here.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {accounts.map((a) => {
                const on = selected.includes(a.target);
                return (
                  <button
                    type="button"
                    key={a.target}
                    onClick={() => toggle(a.target)}
                    aria-pressed={on}
                    className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors ${on ? "border-wire bg-wire/10 text-ink" : "border-line text-ink-soft hover:border-ink-faint"}`}
                  >
                    <AppIcon app={ICON[a.channel]} color={CHANNELS[a.channel].color} size={12} />
                    <span className="max-w-[16rem] truncate">{a.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-wire/30 bg-wire/5 p-3">
          <label className="label flex items-center gap-1.5" htmlFor="s-import">
            <Download size={14} /> Import a post from its link
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="s-import"
              className="input min-w-0 flex-1 bg-paper"
              placeholder="Paste a LinkedIn post link (linkedin.com/posts/… or lnkd.in/…)"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  importLink();
                }
              }}
            />
            <button type="button" className="btn-primary" onClick={importLink} disabled={importing || !importUrl.trim()}>
              {importing ? "Fetching…" : "Fetch & clean"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">
            Gets the text and downloads the PDF carousel or picture, removes clutter, adds credit and hashtags. Public posts only. To do it without opening FlowForge, use the{" "}
            <Link href="/app/templates" className="text-wire underline">
              “Share a post link → … → post on my LinkedIn”
            </Link>{" "}
            template.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="s-text">
              Post
            </label>
            <button type="button" className="mb-1 flex items-center gap-1 text-sm text-wire" onClick={() => setRepost((v) => !v)}>
              <Repeat2 size={14} /> Copy & clean someone's post
            </button>
          </div>
          {repost && (
            <div className="mb-3 space-y-3 rounded-lg border border-line bg-canvas p-3 text-sm">
              <p className="text-ink-soft">
                Open their post on LinkedIn, copy the text (and download the PDF or picture if there is one), and paste it here. FlowForge removes the clutter — "…see more", reaction counts, "follow me / repost ♻️" lines and old hashtags — adds a credit line and fresh hashtags. Only reshare content you have permission to use.
              </p>
              <textarea className="input bg-paper" rows={5} placeholder="Paste their post here" value={srcText} onChange={(e) => setSrcText(e.target.value)} aria-label="Their post" />
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input bg-paper" placeholder="Their name (e.g. Priya Sharma)" value={srcName} onChange={(e) => setSrcName(e.target.value)} aria-label="Their name" />
                <input className="input bg-paper" placeholder="Link to their post or profile" value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} aria-label="Their post link" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select className="input w-auto bg-paper" value={style} onChange={(e) => setStyle(e.target.value as typeof style)} aria-label="Style">
                  <option value="clean">Clean up only (keep wording)</option>
                  <option value="rewrite">Rewrite in my own words (AI)</option>
                  <option value="short">Make it short (AI)</option>
                  <option value="hook">Strong hook + question (AI)</option>
                </select>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} /> Add credit line
                </label>
                <button type="button" className="btn-primary ml-auto px-3 py-1.5" onClick={cleanIt} disabled={cleaning || !srcText.trim()}>
                  <Sparkles size={14} /> {cleaning ? "Cleaning…" : "Clean it"}
                </button>
              </div>
              <p className="text-xs text-ink-faint">
                Want this to happen automatically? Use the{" "}
                <Link href="/app/templates" className="text-wire underline">
                  “Creator you follow posts → clean & rewrite → your drafts”
                </Link>{" "}
                template.
              </p>
            </div>
          )}
          <textarea
            id="s-text"
            rows={8}
            className="input leading-relaxed"
            placeholder="What do you want to share? Tip: start with a hook line, then 3–5 short lines, then hashtags."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
            <span>{[...text].length} characters</span>
            {chosen.some((a) => a.channel === "x") && <span className={xLength(fullText) > 280 ? "text-bad" : ""}>X {xLength(fullText)}/280</span>}
            {chosen.some((a) => a.channel === "bluesky") && <span className={[...fullText].length > 300 ? "text-bad" : ""}>Bluesky {[...fullText].length}/300</span>}
            {chosen.some((a) => a.channel === "linkedin") && <span className={[...text].length > 3000 ? "text-bad" : ""}>LinkedIn {[...text].length}/3000</span>}
          </div>
        </div>

        {/* hashtags */}
        <div className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Hash size={14} /> Hashtags
            </span>
            <div className="flex gap-2">
              {tags.length > 0 && (
                <button type="button" className="text-sm text-wire underline" onClick={() => addTags(tags.slice(0, 5))}>
                  Add top 5
                </button>
              )}
              <button type="button" className="btn-quiet px-3 py-1 text-xs" onClick={suggest} disabled={tagBusy}>
                {tagBusy ? "Thinking…" : tags.length ? "Refresh" : "Suggest hashtags"}
              </button>
            </div>
          </div>
          {tags.length > 0 ? (
            <>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const on = used.has(t.toLowerCase());
                  return (
                    <button
                      type="button"
                      key={t}
                      disabled={on}
                      onClick={() => addTags([t])}
                      className={`rounded-full px-2.5 py-0.5 text-xs ${on ? "bg-ok-tint text-ok" : "bg-canvas text-ink hover:bg-wire/10"}`}
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-ink-faint">
                {tagSource === "ai" ? "Picked by AI for this post." : "Based on the words in your post and popular tags for those topics."} LinkedIn suggests 3–5 hashtags per post.
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-ink-faint">Write your post first, then get hashtags that fit it. Click one to add it.</p>
          )}
        </div>

        {/* attachment + link */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <span className="label">Picture or PDF</span>
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border border-line p-2">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded bg-bad-tint text-bad">
                    <FileText size={22} />
                  </div>
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{file.name}</div>
                  <div className="text-xs text-ink-faint">
                    {file.mime === "application/pdf" ? "PDF · shows as a swipeable carousel on LinkedIn" : file.mime.startsWith("image/") ? "Picture" : "From draft"}{file.size ? ` · ${kb(file.size)}` : ""}
                  </div>
                </div>
                <button type="button" aria-label="Remove file" className="p-1 text-ink-faint hover:text-bad" onClick={() => (setFile(null), setPreview(null))}>
                  <Close size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) upload(f);
                }}
                disabled={uploading}
                className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-line p-4 text-sm text-ink-soft hover:border-wire"
              >
                <span className="flex gap-2">
                  <ImageIcon size={18} />
                  <FileText size={18} />
                </span>
                {uploading ? "Uploading…" : "Drop a file or click — JPG, PNG, PDF up to 20 MB"}
              </button>
            )}
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            {file && (
              <input
                className="input mt-2"
                placeholder={file.mime === "application/pdf" ? "Document title (shown on LinkedIn)" : "Describe the picture (alt text)"}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </div>
          <div>
            <label className="label" htmlFor="s-link">
              Link <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <div className="relative">
              <Paperclip size={14} className="absolute left-3 top-3 text-ink-faint" />
              <input id="s-link" className="input pl-8" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
            <p className="mt-1 text-xs text-ink-faint">Without a file, LinkedIn and Facebook show it as a link preview.</p>
          </div>
        </div>

        {/* when */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex overflow-hidden rounded-lg border border-line text-sm">
            <button type="button" className={`px-3 py-2 ${mode === "now" ? "bg-wire text-white" : ""}`} onClick={() => setMode("now")}>
              Post now
            </button>
            <button type="button" className={`flex items-center gap-1 px-3 py-2 ${mode === "later" ? "bg-wire text-white" : ""}`} onClick={() => setMode("later")}>
              <CalendarClock size={14} /> Schedule
            </button>
          </div>
          {mode === "later" && <input type="datetime-local" className="input w-auto" value={when} min={localInput(new Date())} onChange={(e) => setWhen(e.target.value)} aria-label="Post at" />}
        </div>

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-spark-tint p-3 text-sm">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {msg && (
          <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-ok-tint text-ok" : "bg-bad-tint text-bad"}`}>
            {msg.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-ink-faint">{draftId ? "Editing a draft · " : ""}Uses 1 credit per account.</span>
          <span className="ml-auto" />
          <button type="button" className="btn-quiet" disabled={!canEdit || busy || uploading || (!text.trim() && !file && !link.trim())} onClick={(e) => submit(e as unknown as React.FormEvent, true)}>
            <FilePen size={15} /> Save draft
          </button>
          <button className="btn-primary" disabled={!canEdit || busy || uploading || !selected.length || blocking.length > 0 || (!text.trim() && !file && !link.trim())}>
            <Send size={15} />
            {busy ? (mode === "now" ? "Posting…" : "Scheduling…") : !selected.length ? "Pick an account above" : mode === "now" ? `Post to ${selected.length} account${selected.length === 1 ? "" : "s"}` : "Schedule post"}
          </button>
        </div>
      </form>

      {/* ── Queue + history ─────────────────────────────── */}
      <aside className="space-y-6">
        {drafts.length > 0 && (
          <section className="panel">
            <h2 className="border-b border-line px-5 py-3 text-lg">Drafts to review</h2>
            <ul className="divide-y divide-line">
              {drafts.map((p) => (
                <li key={p.id} className="space-y-2 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-ink-soft">Draft</span>
                    <span className="text-xs text-ink-faint">{timeAgo(p.createdAt)}</span>
                    {p.mediaId && <FileText size={13} className="text-ink-faint" aria-label="Has attachment" />}
                    {canEdit && (
                      <button className="ml-auto p-1 text-ink-faint hover:text-bad" aria-label="Delete draft" onClick={() => remove(p.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <p className="line-clamp-4 whitespace-pre-line text-sm">{p.text || p.link}</p>
                  {canEdit && (
                    <button className="text-sm font-medium text-wire underline" onClick={() => editDraft(p)}>
                      Edit &amp; post
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {liAccounts.length > 0 && canEdit && (
          <form onSubmit={sendComment} className="panel space-y-2 p-5">
            <h2 className="text-lg">Comment / reply on LinkedIn</h2>
            <p className="text-xs text-ink-faint">Paste any post's link (⋯ → Copy link to post) and comment on it as yourself.</p>
            {liAccounts.length > 1 && (
              <select className="input" value={cAcc} onChange={(e) => setCAcc(e.target.value)} aria-label="LinkedIn account">
                {liAccounts.map((a) => (
                  <option key={a.connectionId} value={a.connectionId}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            <input className="input" placeholder="https://www.linkedin.com/posts/…" value={cUrl} onChange={(e) => setCUrl(e.target.value)} aria-label="Post link" />
            <textarea className="input" rows={3} placeholder="Great insight — thanks for sharing!" value={cText} onChange={(e) => setCText(e.target.value)} aria-label="Comment" />
            {cMsg && (
              <p className={`text-sm ${cMsg.ok ? "text-ok" : "text-bad"}`}>
                {cMsg.text}{" "}
                {cMsg.url && (
                  <a className="underline" href={cMsg.url} target="_blank" rel="noreferrer">
                    Open post
                  </a>
                )}
              </p>
            )}
            <button className="btn-primary w-full" disabled={cBusy || !cAcc || !cUrl.trim() || !cText.trim()}>
              {cBusy ? "Posting…" : "Post comment"}
            </button>
          </form>
        )}
        <section className="panel">
          <h2 className="border-b border-line px-5 py-3 text-lg">Scheduled</h2>
          {scheduled.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-soft">Nothing scheduled.</p>
          ) : (
            <ul className="divide-y divide-line">
              {scheduled.map((p) => (
                <PostItem key={p.id} p={p} nameOf={nameOf} onRemove={canEdit ? remove : undefined} />
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2 className="border-b border-line px-5 py-3 text-lg">History</h2>
          {history.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-soft">Your posts will appear here with links to each one.</p>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((p) => (
                <PostItem key={p.id} p={p} nameOf={nameOf} onRemove={canEdit ? remove : undefined} onUnpublish={canEdit ? unpublish : undefined} />
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

function PostItem({ p, nameOf, onRemove, onUnpublish }: { p: PostRow; nameOf: (t: string) => Account | undefined; onRemove?: (id: string) => void; onUnpublish?: (id: string) => void }) {
  const canUnpublish = !!onUnpublish && (p.results ?? []).some((r) => r.ok && r.url && (r.app === "linkedin" || r.app === "x"));
  const [label, cls] = STATUS[p.status] ?? [p.status, "bg-canvas text-ink-soft"];
  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
        <span className="text-xs text-ink-faint">
          {p.status === "scheduled" && p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : timeAgo(p.postedAt ?? p.createdAt)}
        </span>
        {p.mediaId && <FileText size={13} className="text-ink-faint" aria-label="Has attachment" />}
        {onRemove && p.status !== "posting" && (
          <button className="ml-auto p-1 text-ink-faint hover:text-bad" aria-label="Delete" onClick={() => onRemove(p.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <p className="line-clamp-3 whitespace-pre-line text-sm">{p.text || p.mediaTitle || p.link}</p>
      {canUnpublish && (
        <button className="text-xs text-bad underline" onClick={() => onUnpublish!(p.id)}>
          Delete from LinkedIn / X
        </button>
      )}
      <ul className="space-y-1">
        {(p.results ?? p.targets.map((t) => ({ target: t, app: nameOf(t)?.channel ?? "", account: nameOf(t)?.name, ok: true, pending: true }) as Result & { pending?: boolean })).map((r) => {
          const ch = (r.app as Channel) in CHANNELS ? (r.app as Channel) : null;
          const pending = "pending" in r;
          return (
            <li key={r.target} className="flex items-start gap-2 text-xs">
              {ch && <AppIcon app={ICON[ch]} color={CHANNELS[ch].color} size={10} />}
              <div className="min-w-0 flex-1">
                <span className="font-medium">{r.account ?? r.app}</span>{" "}
                {pending ? (
                  <span className="text-ink-faint">waiting</span>
                ) : r.ok ? (
                  r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-wire underline">
                      view post
                    </a>
                  ) : (
                    <span className="text-ok">sent</span>
                  )
                ) : (
                  <span className="text-bad">{r.error}</span>
                )}
                {r.note && <div className="text-ink-faint">{r.note}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
