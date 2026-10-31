/** Commerce, CRM, marketing, support, project tools, payments and data apps. */
import { createHash } from "node:crypto";
import postgres from "postgres";
import { apiCall, apiRaw, assertPublicHost, downloadFile, httpRequest } from "../net";
import { resolveJsonField } from "../template";
import { readFeed } from "../rss";
import { normalizePgUrl } from "../../pg-url";
import { StepError, type ModuleRunner } from "../types";

const s = (v: unknown) => (v == null ? "" : String(v)).trim();
const list = (v: unknown) =>
  s(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const siteBase = (u: string) => {
  const url = s(u).replace(/\/+$/, "");
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
};
const mustMatch = (value: string, re: RegExp, what: string) => {
  if (!re.test(value)) throw new StepError(`${what} looks wrong: “${value}”`);
  return value;
};

// ── Shopify / WooCommerce (shared with the "new order" triggers) ───────────
export type ShopifyConn = { shop: string; accessToken: string };
export async function shopify<T>(c: ShopifyConn, path: string, init: RequestInit & { json?: unknown } = {}) {
  const shop = mustMatch(s(c.shop).replace(/^https?:\/\//, "").replace(/\/.*$/, ""), /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i, "Store domain");
  const version = process.env.SHOPIFY_API_VERSION ?? "2026-07";
  return apiCall<T>(`https://${shop}/admin/api/${version}${path}`, { ...init, headers: { "x-shopify-access-token": c.accessToken, ...(init.headers ?? {}) } });
}

export type WooConn = { siteUrl: string; consumerKey: string; consumerSecret: string };
export async function woo<T>(c: WooConn, path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await httpRequest(`${siteBase(c.siteUrl)}/wp-json/wc/v3${path}`, {
    method,
    headers: { authorization: basic(c.consumerKey, c.consumerSecret) },
    body,
  });
  if (r.status >= 400) throw new StepError(`WooCommerce: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body as T;
}

export const business: Record<string, ModuleRunner> = {
  // ── Messaging ──
  "whatsapp.send": async ({ config, connection }) => {
    const c = await connection<{ accessToken: string; phoneNumberId: string }>(config.connectionId);
    const to = s(config.to).replace(/[^\d]/g, "");
    const body =
      config.mode === "template"
        ? {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
              name: s(config.template),
              language: { code: s(config.language) || "en" },
              ...(list(config.params).length ? { components: [{ type: "body", parameters: list(config.params).map((text) => ({ type: "text", text })) }] } : {}),
            },
          }
        : { messaging_product: "whatsapp", to, type: "text", text: { body: s(config.text), preview_url: true } };
    const v = process.env.META_GRAPH_VERSION ?? "v23.0";
    const r = await apiCall<{ messages: { id: string }[] }>(`https://graph.facebook.com/${v}/${s(c.phoneNumberId)}/messages`, {
      method: "POST",
      headers: bearer(c.accessToken),
      json: body,
    });
    return { output: { messageId: r.messages?.[0]?.id } };
  },

  // ── Commerce ──
  "shopify.order": async ({ config, connection }) => {
    const c = await connection<ShopifyConn>(config.connectionId);
    const r = await shopify<{ order: unknown }>(c, `/orders/${encodeURIComponent(s(config.orderId))}.json`);
    return { output: r.order };
  },
  "shopify.product": async ({ config, connection }) => {
    const c = await connection<ShopifyConn>(config.connectionId);
    const r = await shopify<{ product: { id: number; handle: string } }>(c, "/products.json", {
      method: "POST",
      json: {
        product: {
          title: s(config.title),
          body_html: s(config.description),
          status: s(config.status) || "draft",
          variants: [{ price: String(Number(config.price) || 0) }],
          ...(s(config.imageUrl) ? { images: [{ src: s(config.imageUrl) }] } : {}),
        },
      },
    });
    return { output: r.product };
  },
  "woocommerce.order_status": async ({ config, connection }) => {
    const c = await connection<WooConn>(config.connectionId);
    const r = await woo<{ id: number; status: string }>(c, `/orders/${encodeURIComponent(s(config.orderId))}`, "PUT", { status: s(config.status) });
    return { output: { id: r.id, status: r.status } };
  },
  "wordpress.post": async ({ config, connection }) => {
    const c = await connection<{ siteUrl: string; username: string; appPassword: string }>(config.connectionId);
    const r = await httpRequest(`${siteBase(c.siteUrl)}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { authorization: basic(c.username, c.appPassword.replace(/\s+/g, "")) },
      body: { title: s(config.title), content: s(config.content), status: s(config.status) || "draft" },
    });
    if (r.status >= 400) throw new StepError(`WordPress: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const b = r.body as { id: number; link: string };
    return { output: { id: b.id, link: b.link } };
  },

  // ── Email & marketing ──
  "mailchimp.subscribe": async ({ config, connection }) => {
    const c = await connection<{ apiKey: string }>(config.connectionId);
    const dc = c.apiKey.split("-").pop();
    if (!dc || dc === c.apiKey) throw new StepError("Mailchimp API key should end with the data center, like -us21");
    const email = s(config.email).toLowerCase();
    const hash = createHash("md5").update(email).digest("hex");
    const base = `https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(s(config.listId))}/members/${hash}`;
    const auth = { authorization: basic("flowforge", c.apiKey) };
    const r = await apiCall<{ id: string; status: string }>(base, {
      method: "PUT",
      headers: auth,
      json: { email_address: email, status_if_new: "subscribed", merge_fields: { FNAME: s(config.firstName), LNAME: s(config.lastName) } },
    });
    const tags = list(config.tags);
    if (tags.length) await apiRaw(`${base}/tags`, { method: "POST", headers: auth, json: { tags: tags.map((name) => ({ name, status: "active" })) } });
    return { output: r };
  },
  "brevo.contact": async ({ config, raw, scope, connection }) => {
    const c = await connection<{ apiKey: string }>(config.connectionId);
    await apiRaw("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "api-key": c.apiKey },
      json: { email: s(config.email), attributes: resolveJsonField(raw.attributes, scope) ?? {}, listIds: list(config.listIds).map(Number), updateEnabled: true },
    });
    return { output: { email: s(config.email) } };
  },
  "brevo.email": async ({ config, connection }) => {
    const c = await connection<{ apiKey: string }>(config.connectionId);
    const r = await apiCall<{ messageId: string }>("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": c.apiKey },
      json: { sender: { email: s(config.from), name: s(config.fromName) || undefined }, to: list(config.to).map((email) => ({ email })), subject: s(config.subject), htmlContent: s(config.html) },
    });
    return { output: r };
  },
  "sendgrid.send": async ({ config, connection }) => {
    const c = await connection<{ apiKey: string; from: string }>(config.connectionId);
    await apiRaw("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: bearer(c.apiKey),
      json: {
        personalizations: [{ to: list(config.to).map((email) => ({ email })) }],
        from: { email: c.from },
        subject: s(config.subject),
        content: [{ type: "text/html", value: s(config.html) }],
      },
    });
    return { output: { sent: true } };
  },

  // ── CRM & support ──
  "hubspot.contact": async ({ config, raw, scope, connection }) => {
    const c = await connection<{ accessToken: string }>(config.connectionId);
    const properties = {
      email: s(config.email),
      ...(s(config.firstname) ? { firstname: s(config.firstname) } : {}),
      ...(s(config.lastname) ? { lastname: s(config.lastname) } : {}),
      ...(s(config.phone) ? { phone: s(config.phone) } : {}),
      ...((resolveJsonField(raw.extra, scope) as object) ?? {}),
    };
    const headers = bearer(c.accessToken);
    try {
      return { output: await apiCall("https://api.hubapi.com/crm/v3/objects/contacts", { method: "POST", headers, json: { properties } }) };
    } catch (e) {
      if (!/409|already exists|CONFLICT/i.test((e as Error).message)) throw e;
      const r = await apiCall(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(s(config.email))}?idProperty=email`, { method: "PATCH", headers, json: { properties } });
      return { output: r };
    }
  },
  "hubspot.deal": async ({ config, connection }) => {
    const c = await connection<{ accessToken: string }>(config.connectionId);
    const r = await apiCall<{ id: string }>("https://api.hubapi.com/crm/v3/objects/deals", {
      method: "POST",
      headers: bearer(c.accessToken),
      json: { properties: { dealname: s(config.name), amount: s(config.amount) || undefined, dealstage: s(config.stage) || "appointmentscheduled", pipeline: s(config.pipeline) || "default" } },
    });
    return { output: r };
  },
  "zoho.record": async ({ config, raw, scope, token }) => {
    const { accessToken, data } = await token(config.connectionId);
    const api = String(data.apiDomain ?? "https://www.zohoapis.in");
    const fields = resolveJsonField(raw.fields, scope);
    const r = await apiCall<{ data: { code: string; details: { id: string }; message: string }[] }>(`${api}/crm/v7/${encodeURIComponent(s(config.module) || "Leads")}`, {
      method: "POST",
      headers: { authorization: `Zoho-oauthtoken ${accessToken}` },
      json: { data: [fields] },
    });
    const row = r.data?.[0];
    if (row?.code !== "SUCCESS") throw new StepError(`Zoho: ${row?.message ?? "record not created"}`);
    return { output: { id: row.details.id } };
  },
  "pipedrive.person": async ({ config, connection }) => {
    const c = await connection<{ apiToken: string }>(config.connectionId);
    const r = await apiCall<{ data: { id: number } }>(`https://api.pipedrive.com/v1/persons?api_token=${encodeURIComponent(c.apiToken)}`, {
      method: "POST",
      json: { name: s(config.name), ...(s(config.email) ? { email: [s(config.email)] } : {}), ...(s(config.phone) ? { phone: [s(config.phone)] } : {}) },
    });
    return { output: r.data };
  },
  "pipedrive.deal": async ({ config, connection }) => {
    const c = await connection<{ apiToken: string }>(config.connectionId);
    const r = await apiCall<{ data: { id: number } }>(`https://api.pipedrive.com/v1/deals?api_token=${encodeURIComponent(c.apiToken)}`, {
      method: "POST",
      json: { title: s(config.title), value: Number(config.value) || undefined, currency: s(config.currency) || undefined, person_id: Number(config.personId) || undefined },
    });
    return { output: r.data };
  },
  "freshdesk.ticket": async ({ config, connection }) => {
    const c = await connection<{ domain: string; apiKey: string }>(config.connectionId);
    const domain = mustMatch(s(c.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, ""), /^[a-z0-9-]+\.freshdesk\.com$/i, "Helpdesk domain");
    const r = await apiCall<{ id: number }>(`https://${domain}/api/v2/tickets`, {
      method: "POST",
      headers: { authorization: basic(c.apiKey, "X") },
      json: { email: s(config.email), subject: s(config.subject), description: s(config.description), priority: Number(config.priority) || 1, status: 2 },
    });
    return { output: r };
  },
  "zendesk.ticket": async ({ config, connection }) => {
    const c = await connection<{ subdomain: string; email: string; apiToken: string }>(config.connectionId);
    const sub = mustMatch(s(c.subdomain).replace(/\.zendesk\.com.*$/, "").replace(/^https?:\/\//, ""), /^[a-z0-9-]+$/i, "Subdomain");
    const r = await apiCall<{ ticket: { id: number } }>(`https://${sub}.zendesk.com/api/v2/tickets`, {
      method: "POST",
      headers: { authorization: basic(`${c.email}/token`, c.apiToken) },
      json: { ticket: { subject: s(config.subject), comment: { body: s(config.body) }, requester: { email: s(config.email), name: s(config.name) || s(config.email) } } },
    });
    return { output: r.ticket };
  },

  // ── Productivity ──
  "zoom.meeting": async ({ config, connection }) => {
    const c = await connection<{ accountId: string; clientId: string; clientSecret: string }>(config.connectionId);
    const tok = await apiCall<{ access_token: string }>(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(c.accountId)}`, {
      method: "POST",
      headers: { authorization: basic(c.clientId, c.clientSecret) },
    });
    const start = new Date(s(config.start));
    if (isNaN(start.getTime())) throw new StepError("Start time isn't a valid date");
    const r = await apiCall<{ id: number; join_url: string; start_url: string; password: string }>("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: bearer(tok.access_token),
      json: { topic: s(config.topic), type: 2, start_time: start.toISOString(), duration: Number(config.duration) || 30 },
    });
    return { output: { id: r.id, join_url: r.join_url, start_url: r.start_url, password: r.password } };
  },
  "dropbox.upload": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const file = await downloadFile(s(config.fileUrl), 150 * 1024 * 1024);
    let path = s(config.path);
    if (!path.startsWith("/")) path = `/${path}`;
    const r = await apiCall<{ id: string; path_display: string }>("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        ...bearer(accessToken),
        "content-type": "application/octet-stream",
        // non-ASCII must be escaped in this header
        "dropbox-api-arg": JSON.stringify({ path, mode: "add", autorename: true }).replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`),
      },
      body: new Uint8Array(file.data),
    });
    return { output: r };
  },
  "trello.card": async ({ config, connection }) => {
    const c = await connection<{ key: string; token: string }>(config.connectionId);
    const q = new URLSearchParams({ key: c.key, token: c.token, idList: s(config.listId), name: s(config.name), desc: s(config.description) });
    if (s(config.due)) q.set("due", s(config.due));
    const r = await apiCall<{ id: string; url: string }>(`https://api.trello.com/1/cards?${q}`, { method: "POST" });
    return { output: { id: r.id, url: r.url } };
  },
  "asana.task": async ({ config, connection }) => {
    const c = await connection<{ token: string }>(config.connectionId);
    const r = await apiCall<{ data: { gid: string; permalink_url: string } }>("https://app.asana.com/api/1.0/tasks?opt_fields=permalink_url", {
      method: "POST",
      headers: bearer(c.token),
      json: { data: { name: s(config.name), notes: s(config.notes), projects: [s(config.projectId)], ...(s(config.due) ? { due_on: s(config.due) } : {}) } },
    });
    return { output: r.data };
  },
  "clickup.task": async ({ config, connection }) => {
    const c = await connection<{ token: string }>(config.connectionId);
    const r = await apiCall<{ id: string; url: string }>(`https://api.clickup.com/api/v2/list/${encodeURIComponent(s(config.listId))}/task`, {
      method: "POST",
      headers: { authorization: c.token },
      json: { name: s(config.name), description: s(config.description) },
    });
    return { output: { id: r.id, url: r.url } };
  },
  "todoist.task": async ({ config, connection }) => {
    const c = await connection<{ token: string }>(config.connectionId);
    const r = await apiCall<{ id: string; url?: string }>("https://api.todoist.com/api/v1/tasks", {
      method: "POST",
      headers: bearer(c.token),
      json: { content: s(config.content), description: s(config.description) || undefined, due_string: s(config.due) || undefined },
    });
    return { output: { id: r.id, url: r.url ?? `https://app.todoist.com/app/task/${r.id}` } };
  },

  // ── Developer ──
  "jira.issue": async ({ config, connection }) => {
    const c = await connection<{ site: string; email: string; apiToken: string }>(config.connectionId);
    const site = mustMatch(s(c.site).replace(/^https?:\/\//, "").replace(/\/.*$/, ""), /^[a-z0-9-]+\.atlassian\.net$/i, "Jira site");
    const desc = s(config.description);
    const r = await apiCall<{ id: string; key: string }>(`https://${site}/rest/api/3/issue`, {
      method: "POST",
      headers: { authorization: basic(c.email, c.apiToken) },
      json: {
        fields: {
          project: { key: s(config.project) },
          issuetype: { name: s(config.type) || "Task" },
          summary: s(config.summary),
          ...(desc ? { description: { type: "doc", version: 1, content: desc.split(/\n{2,}/).map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) } } : {}),
        },
      },
    });
    return { output: { ...r, url: `https://${site}/browse/${r.key}` } };
  },
  "linear.issue": async ({ config, connection }) => {
    const c = await connection<{ apiKey: string }>(config.connectionId);
    const r = await apiCall<{ data?: { issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } } }; errors?: { message: string }[] }>(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: { authorization: c.apiKey },
        json: {
          query: "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }",
          variables: { input: { teamId: s(config.teamId), title: s(config.title), description: s(config.description) || undefined } },
        },
      },
    );
    if (r.errors?.length) throw new StepError(`Linear: ${r.errors[0].message}`);
    return { output: r.data!.issueCreate.issue };
  },
  "supabase.insert": async ({ config, raw, scope, connection }) => {
    const c = await connection<{ url: string; serviceKey: string }>(config.connectionId);
    const base = mustMatch(siteBase(c.url), /^https:\/\/[a-z0-9-]+\.supabase\.co$/i, "Project URL");
    const r = await apiCall<unknown[]>(`${base}/rest/v1/${encodeURIComponent(s(config.table))}`, {
      method: "POST",
      headers: { apikey: c.serviceKey, ...bearer(c.serviceKey), prefer: "return=representation" },
      json: resolveJsonField(raw.row, scope),
    });
    return { output: { rows: r } };
  },
  "supabase.select": async ({ config, connection }) => {
    const c = await connection<{ url: string; serviceKey: string }>(config.connectionId);
    const base = mustMatch(siteBase(c.url), /^https:\/\/[a-z0-9-]+\.supabase\.co$/i, "Project URL");
    const q = new URLSearchParams(s(config.filter));
    q.set("limit", String(Math.min(Number(config.limit) || 50, 1000)));
    const r = await apiCall<unknown[]>(`${base}/rest/v1/${encodeURIComponent(s(config.table))}?${q}`, { headers: { apikey: c.serviceKey, ...bearer(c.serviceKey) } });
    return { output: { rows: r, count: r.length } };
  },
  "postgres.query": async ({ config, raw, scope, connection }) => {
    const c = await connection<{ connectionString: string }>(config.connectionId);
    let connStr: string;
    try {
      connStr = normalizePgUrl(c.connectionString);
    } catch (e) {
      throw new StepError((e as Error).message);
    }
    const host = new URL(connStr).hostname;
    await assertPublicHost(host);
    const params = (resolveJsonField(raw.params, scope) ?? []) as unknown[];
    if (!Array.isArray(params)) throw new StepError("Values must be a JSON array");
    const sql = postgres(connStr, { max: 1, connect_timeout: 10, idle_timeout: 2, prepare: false, connection: { statement_timeout: 30_000 } as never });
    try {
      const rows = await sql.unsafe(String(raw.sql ?? ""), params as never[]);
      const out = Array.from(rows).slice(0, 1000);
      return { output: { rows: out, count: rows.count ?? out.length } };
    } catch (e) {
      throw new StepError(`Database: ${(e as Error).message}`);
    } finally {
      await sql.end({ timeout: 2 });
    }
  },

  // ── Data ──
  "rss.read": async ({ config }) => {
    const items = await readFeed(s(config.url));
    return { output: { items: items.slice(0, Math.min(Number(config.max) || 10, 100)) } };
  },
  "bitly.shorten": async ({ config, connection }) => {
    const c = await connection<{ token: string }>(config.connectionId);
    const r = await apiCall<{ link: string; id: string }>("https://api-ssl.bitly.com/v4/shorten", { method: "POST", headers: bearer(c.token), json: { long_url: s(config.url) } });
    return { output: { link: r.link, id: r.id } };
  },

  // ── Payments ──
  "cashfree.link": async ({ config, connection }) => {
    const c = await connection<{ clientId: string; clientSecret: string; env?: string }>(config.connectionId);
    const host = s(c.env).toLowerCase().startsWith("sand") ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
    const r = await apiCall<{ link_id: string; link_url: string; link_status: string }>(`${host}/pg/links`, {
      method: "POST",
      headers: { "x-client-id": c.clientId, "x-client-secret": c.clientSecret, "x-api-version": "2023-08-01" },
      json: {
        link_id: `ff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        link_amount: Number(config.amount),
        link_currency: "INR",
        link_purpose: s(config.purpose),
        customer_details: { customer_phone: s(config.phone), customer_email: s(config.email) || undefined, customer_name: s(config.name) || undefined },
        link_notify: { send_sms: !!s(config.phone), send_email: !!s(config.email) },
      },
    });
    return { output: r };
  },
  "instamojo.request": async ({ config, connection }) => {
    const c = await connection<{ clientId: string; clientSecret: string }>(config.connectionId);
    const tok = await apiCall<{ access_token: string }>("https://api.instamojo.com/oauth2/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret }).toString(),
    });
    const r = await apiCall<{ id: string; longurl: string; status: string }>("https://api.instamojo.com/v2/payment_requests/", {
      method: "POST",
      headers: { ...bearer(tok.access_token), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        purpose: s(config.purpose),
        amount: String(Number(config.amount)),
        ...(s(config.name) ? { buyer_name: s(config.name) } : {}),
        ...(s(config.email) ? { email: s(config.email), send_email: "true" } : {}),
        ...(s(config.phone) ? { phone: s(config.phone), send_sms: "true" } : {}),
        allow_repeated_payments: "false",
      }).toString(),
    });
    return { output: r };
  },
};
