import nodemailer from "nodemailer";
import { resolveJsonField } from "../template";
import { apiCall, httpRequest } from "../net";
import { StepError, type ModuleRunner } from "../types";
import { googleAccess } from "./google";

const s = (v: unknown) => (v == null ? "" : String(v));

export const apps: Record<string, ModuleRunner> = {
  "email.send": async ({ config, connection }) => {
    let transportOpts: nodemailer.TransportOptions | string;
    let from: string;
    if (config.connectionId) {
      const c = await connection<{ host: string; port: string; user: string; pass: string; from?: string }>(config.connectionId);
      const port = Number(c.port) || 465;
      transportOpts = { host: c.host, port, secure: port === 465, auth: { user: c.user, pass: c.pass } } as nodemailer.TransportOptions;
      from = c.from || c.user;
    } else {
      if (!process.env.SMTP_HOST) throw new StepError("No SMTP connection selected and platform SMTP is not configured");
      const port = Number(process.env.SMTP_PORT) || 587;
      transportOpts = {
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      } as nodemailer.TransportOptions;
      from = process.env.SMTP_FROM || "no-reply@example.com";
    }
    const info = await nodemailer.createTransport(transportOpts).sendMail({
      from,
      to: s(config.to),
      subject: s(config.subject),
      html: s(config.body),
    });
    return { output: { messageId: info.messageId, accepted: info.accepted } };
  },

  "slack.message": async ({ config, connection }) => {
    const c = await connection<{ webhookUrl: string }>(config.connectionId);
    const r = await httpRequest(c.webhookUrl, { method: "POST", body: { text: s(config.text) } });
    if (r.status >= 400) throw new StepError(`Slack: ${r.status} ${s(r.body)}`);
    return { output: { ok: true } };
  },

  "discord.message": async ({ config, connection }) => {
    const c = await connection<{ webhookUrl: string }>(config.connectionId);
    const r = await httpRequest(c.webhookUrl, { method: "POST", body: { content: s(config.content).slice(0, 2000) } });
    if (r.status >= 400) throw new StepError(`Discord: ${r.status} ${s(r.body)}`);
    return { output: { ok: true } };
  },

  "telegram.message": async ({ config, connection }) => {
    const c = await connection<{ botToken: string }>(config.connectionId);
    const r = await apiCall<{ result: unknown }>(`https://api.telegram.org/bot${c.botToken}/sendMessage`, {
      method: "POST",
      json: { chat_id: s(config.chatId), text: s(config.text) },
    });
    return { output: r.result };
  },

  "twilio.sms": async ({ config, connection }) => {
    const c = await connection<{ accountSid: string; authToken: string; from: string }>(config.connectionId);
    const to = s(config.to);
    const from = to.startsWith("whatsapp:") && !c.from.startsWith("whatsapp:") ? `whatsapp:${c.from}` : c.from;
    const r = await apiCall<{ sid: string; status: string }>(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: s(config.body) }).toString(),
    });
    return { output: { sid: r.sid, status: r.status } };
  },

  "sheets.append": async ({ config, raw, scope, connection, token: tok }) => {
    const token = await googleAccess({ connection, token: tok }, config.connectionId, "https://www.googleapis.com/auth/spreadsheets");
    const values = resolveJsonField(raw.values, scope);
    if (!Array.isArray(values)) throw new StepError("Row values must be a JSON array");
    const range = encodeURIComponent(s(config.range) || "Sheet1!A1");
    const r = await apiCall<{ updates: { updatedRange: string } }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${s(config.spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED`,
      { method: "POST", headers: { authorization: `Bearer ${token}` }, json: { values: [values] } },
    );
    return { output: { updatedRange: r.updates?.updatedRange } };
  },

  "sheets.read": async ({ config, connection, token: tok }) => {
    const token = await googleAccess({ connection, token: tok }, config.connectionId, "https://www.googleapis.com/auth/spreadsheets.readonly");
    const range = encodeURIComponent(s(config.range) || "Sheet1!A1:Z100");
    const r = await apiCall<{ values?: string[][] }>(`https://sheets.googleapis.com/v4/spreadsheets/${s(config.spreadsheetId)}/values/${range}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = r.values ?? [];
    const [header, ...rest] = rows;
    const objects = header ? rest.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""]))) : [];
    return { output: { rows, objects } };
  },

  "notion.create_page": async ({ config, raw, scope, connection }) => {
    const c = await connection<{ token: string }>(config.connectionId);
    const extra = (resolveJsonField(raw.properties, scope) ?? {}) as Record<string, unknown>;
    const r = await apiCall<{ id: string; url: string }>("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: { authorization: `Bearer ${c.token}`, "notion-version": "2022-06-28" },
      json: {
        parent: { database_id: s(config.databaseId) },
        properties: { [s(config.titleProperty) || "Name"]: { title: [{ text: { content: s(config.title) } }] }, ...extra },
      },
    });
    return { output: { id: r.id, url: r.url } };
  },

  "airtable.create": async ({ config, raw, scope, connection }) => {
    const c = await connection<{ token: string }>(config.connectionId);
    const fields = resolveJsonField(raw.fields, scope);
    const r = await apiCall<{ id: string; fields: unknown }>(`https://api.airtable.com/v0/${s(config.baseId)}/${encodeURIComponent(s(config.table))}`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.token}` },
      json: { fields, typecast: true },
    });
    return { output: r };
  },

  "airtable.list": async ({ config, connection }) => {
    const c = await connection<{ token: string }>(config.connectionId);
    const q = new URLSearchParams({ maxRecords: String(Math.min(Number(config.max) || 50, 100)) });
    if (config.formula) q.set("filterByFormula", s(config.formula));
    const r = await apiCall<{ records: unknown[] }>(`https://api.airtable.com/v0/${s(config.baseId)}/${encodeURIComponent(s(config.table))}?${q}`, {
      headers: { authorization: `Bearer ${c.token}` },
    });
    return { output: { records: r.records } };
  },

  "github.issue": async ({ config, connection }) => {
    const c = await connection<{ token: string }>(config.connectionId);
    const r = await apiCall<{ number: number; html_url: string }>(`https://api.github.com/repos/${s(config.repo)}/issues`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.token}`, accept: "application/vnd.github+json", "user-agent": "FlowForge" },
      json: { title: s(config.title), body: s(config.body) },
    });
    return { output: { number: r.number, html_url: r.html_url } };
  },

  "razorpay.payment_link": async ({ config, connection }) => {
    const c = await connection<{ keyId: string; keySecret: string }>(config.connectionId);
    const r = await apiCall<{ id: string; short_url: string; status: string }>("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64") },
      json: {
        amount: Math.round(Number(config.amount) * 100),
        currency: "INR",
        description: s(config.description) || undefined,
        customer: {
          name: s(config.customerName) || undefined,
          email: s(config.customerEmail) || undefined,
          contact: s(config.customerPhone) || undefined,
        },
        notify: { sms: !!config.customerPhone, email: !!config.customerEmail },
      },
    });
    return { output: r };
  },

  "stripe.payment_link": async ({ config, connection }) => {
    const c = await connection<{ secretKey: string }>(config.connectionId);
    const auth = { authorization: `Bearer ${c.secretKey}`, "content-type": "application/x-www-form-urlencoded" };
    const price = await apiCall<{ id: string }>("https://api.stripe.com/v1/prices", {
      method: "POST",
      headers: auth,
      body: new URLSearchParams({
        unit_amount: String(Math.round(Number(config.amount) * 100)),
        currency: s(config.currency) || "usd",
        "product_data[name]": s(config.productName),
      }).toString(),
    });
    const link = await apiCall<{ id: string; url: string }>("https://api.stripe.com/v1/payment_links", {
      method: "POST",
      headers: auth,
      body: new URLSearchParams({ "line_items[0][price]": price.id, "line_items[0][quantity]": "1" }).toString(),
    });
    return { output: { id: link.id, url: link.url } };
  },
};
