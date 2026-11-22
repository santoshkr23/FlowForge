"use client";

import { useState } from "react";
import { Check, Copy, Unplug } from "lucide-react";
import { api } from "@/lib/client";
import { timeAgo } from "@/lib/format";

type Conn = { id: string; clientName: string; userEmail: string; createdAt: string; lastUsedAt: string | null };

export function McpConnect({ url, connections, canManage }: { url: string; connections: Conn[]; canManage: boolean }) {
  const [rows, setRows] = useState(connections);
  const [copied, setCopied] = useState(false);

  async function disconnect(c: Conn) {
    if (!confirm(`Disconnect ${c.clientName}? It will need to sign in again.`)) return;
    await api(`/api/mcp-oauth/connections/${c.id}`, { method: "DELETE" });
    setRows(rows.filter((r) => r.id !== c.id));
  }

  return (
    <div className="panel p-5">
      <h2 className="text-lg">Connect to Claude (MCP)</h2>
      <p className="mt-1 text-sm text-ink-soft">Let Claude run your workflows and create, schedule and publish your social posts — just by asking.</p>
      <div className="mt-3 flex gap-2">
        <code className="input truncate font-mono text-xs">{url}</code>
        <button
          className="btn-quiet shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>
          In Claude, open <b className="font-medium">Settings → Connectors</b> and click <b className="font-medium">Add custom connector</b>.
        </li>
        <li>Name it FlowForge and paste the URL above. Leave the OAuth fields empty.</li>
        <li>
          Click <b className="font-medium">Add</b>, then <b className="font-medium">Connect</b>, sign in to FlowForge and click <b className="font-medium">Allow</b>.
        </li>
      </ol>
      <p className="mt-2 text-xs text-ink-faint">
        Claude Code: <code className="font-mono">claude mcp add --transport http flowforge {url}</code>. Other MCP clients can use the same URL with OAuth, or the header <code className="font-mono">Authorization: Bearer ff_your_key</code>.
      </p>

      <h3 className="mt-5 text-sm font-medium">Connected AI apps</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">None yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line text-sm">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.clientName}</div>
                <div className="text-xs text-ink-faint">
                  {c.userEmail} · connected {timeAgo(c.createdAt)}
                  {c.lastUsedAt ? ` · last used ${timeAgo(c.lastUsedAt)}` : ""}
                </div>
              </div>
              {canManage && (
                <button className="btn-quiet px-2 py-1 text-xs" onClick={() => disconnect(c)}>
                  <Unplug size={13} /> Disconnect
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
