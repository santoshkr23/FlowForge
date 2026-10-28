/** Google (Gmail, Drive, Calendar, YouTube, Sheets via sign-in) and Microsoft (Outlook, Teams). */
import { SignJWT, importPKCS8 } from "jose";
import { apiCall, apiRaw, downloadFile } from "../net";
import { StepError, type ModuleRunner } from "../types";
import type { Helpers } from "../connections";

const s = (v: unknown) => (v == null ? "" : String(v)).trim();

async function serviceAccountToken(serviceAccountJson: string, scope: string) {
  let sa: { client_email: string; private_key: string };
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch {
    throw new StepError("Google connection: service account JSON is invalid");
  }
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const r = await apiCall<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  return r.access_token;
}

/** Works with either a Google sign-in connection or a service-account connection. */
export async function googleAccess(h: Pick<Helpers, "connection" | "token">, connectionId: unknown, scope: string) {
  const data = await h.connection<Record<string, unknown>>(connectionId);
  if (data.oauth) return (await h.token(connectionId)).accessToken;
  return serviceAccountToken(String(data.serviceAccountJson ?? ""), scope);
}

const encodeHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);
const graph = "https://graph.microsoft.com/v1.0";
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

export const google: Record<string, ModuleRunner> = {
  "gmail.send": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const lines = [
      `To: ${s(config.to)}`,
      ...(s(config.cc) ? [`Cc: ${s(config.cc)}`] : []),
      `Subject: ${encodeHeader(s(config.subject))}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(s(config.body), "utf8").toString("base64"),
    ];
    const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
    const r = await apiCall<{ id: string; threadId: string }>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: bearer(accessToken),
      json: { raw },
    });
    return { output: r };
  },

  "drive.upload": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const file = await downloadFile(s(config.fileUrl), 100 * 1024 * 1024);
    const boundary = `ff${Date.now()}`;
    const meta = { name: s(config.name) || file.name, ...(s(config.folderId) ? { parents: [s(config.folderId)] } : {}) };
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${file.contentType}\r\n\r\n`),
      file.data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await apiCall<{ id: string; name: string; webViewLink: string }>(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      { method: "POST", headers: { ...bearer(accessToken), "content-type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) },
    );
    return { output: r };
  },

  "calendar.event": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const start = new Date(s(config.start));
    if (isNaN(start.getTime())) throw new StepError("Start time isn't a valid date. Use a format like 2026-11-02T15:30:00+05:30.");
    const end = new Date(start.getTime() + (Number(config.durationMin) || 30) * 60_000);
    const attendees = s(config.attendees)
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((email) => ({ email }));
    const meet = config.meet === true || config.meet === "true";
    const cal = encodeURIComponent(s(config.calendarId) || "primary");
    const r = await apiCall<{ id: string; htmlLink: string; hangoutLink?: string }>(
      `https://www.googleapis.com/calendar/v3/calendars/${cal}/events?sendUpdates=all${meet ? "&conferenceDataVersion=1" : ""}`,
      {
        method: "POST",
        headers: bearer(accessToken),
        json: {
          summary: s(config.title),
          description: s(config.description) || undefined,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
          attendees,
          ...(meet ? { conferenceData: { createRequest: { requestId: `ff-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
        },
      },
    );
    return { output: { id: r.id, htmlLink: r.htmlLink, hangoutLink: r.hangoutLink } };
  },

  "youtube.upload": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const file = await downloadFile(s(config.videoUrl));
    const meta = {
      snippet: {
        title: s(config.title).slice(0, 100),
        description: s(config.description).slice(0, 5000),
        tags: s(config.tags)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      },
      status: { privacyStatus: s(config.privacy) || "private", selfDeclaredMadeForKids: false },
    };
    const init = await apiRaw("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { ...bearer(accessToken), "x-upload-content-type": file.contentType.startsWith("video/") ? file.contentType : "video/*", "x-upload-content-length": String(file.data.length) },
      json: meta,
    });
    const location = init.headers.get("location");
    if (!location) throw new StepError("YouTube didn't accept the upload");
    const up = await apiRaw(location, { method: "PUT", headers: { ...bearer(accessToken), "content-type": file.contentType }, body: new Uint8Array(file.data), signal: AbortSignal.timeout(600_000) });
    const v = up.data as { id: string; status?: { privacyStatus?: string } };
    return { output: { id: v.id, url: `https://youtu.be/${v.id}`, privacy: v.status?.privacyStatus } };
  },

  "youtube.video": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const r = await apiCall<{ items: { snippet: { title: string; publishedAt: string; channelTitle: string }; statistics: { viewCount: string; likeCount?: string; commentCount?: string } }[] }>(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${encodeURIComponent(s(config.videoId))}`,
      { headers: bearer(accessToken) },
    );
    const v = r.items[0];
    if (!v) throw new StepError("Video not found");
    return {
      output: {
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
        views: Number(v.statistics.viewCount),
        likes: Number(v.statistics.likeCount ?? 0),
        comments: Number(v.statistics.commentCount ?? 0),
      },
    };
  },

  "outlook.send": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const to = s(config.to)
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address } }));
    await apiRaw(`${graph}/me/sendMail`, {
      method: "POST",
      headers: bearer(accessToken),
      json: { message: { subject: s(config.subject), body: { contentType: "HTML", content: s(config.body) }, toRecipients: to }, saveToSentItems: true },
    });
    return { output: { sent: true } };
  },

  "teams.message": async ({ config, token }) => {
    const { accessToken } = await token(config.connectionId);
    const r = await apiCall<{ id: string; webUrl?: string }>(`${graph}/teams/${encodeURIComponent(s(config.teamId))}/channels/${encodeURIComponent(s(config.channelId))}/messages`, {
      method: "POST",
      headers: bearer(accessToken),
      json: { body: { contentType: "html", content: s(config.text).replace(/\n/g, "<br>") } },
    });
    return { output: r };
  },
};
