/** LinkedIn actions that work with "Share on LinkedIn" (w_member_social): comment on a post, delete your own post. */
import { apiCall, apiRaw } from "../engine/net";
import { StepError } from "../engine/types";
import type { Helpers } from "../engine/connections";

const headers = (token: string) => ({ authorization: `Bearer ${token}`, "linkedin-version": process.env.LINKEDIN_VERSION ?? "202608", "x-restli-protocol-version": "2.0.0" });

/** Post link or URN → urn:li:activity|share|ugcPost:… */
export function urnFromUrl(raw: string): string {
  const s = decodeURIComponent(raw.trim());
  const urn = s.match(/urn:li:(activity|share|ugcPost):\d+/);
  if (urn) return urn[0];
  const act = s.match(/activity[-:](\d{10,})/);
  if (act) return `urn:li:activity:${act[1]}`;
  const ugc = s.match(/ugcPost[-:](\d{10,})/i);
  if (ugc) return `urn:li:ugcPost:${ugc[1]}`;
  throw new StepError("Couldn't find the post ID in that link. Open the post, click ⋯ → Copy link to post, and paste that (linkedin.com/posts/…activity-… or /feed/update/urn:li:activity:…).");
}

export async function personUrn(h: Helpers, connectionId: string) {
  const { accessToken, data } = await h.token(connectionId);
  let urn = data.personUrn as string | undefined;
  if (!urn) {
    const u = await apiCall<{ sub: string }>("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
    urn = `urn:li:person:${u.sub}`;
  }
  return { accessToken, urn };
}

/** Comment on any post (yours or someone else's) as yourself. */
export async function linkedinComment(h: Helpers, connectionId: string, postUrl: string, text: string) {
  if (!text.trim()) throw new StepError("Write the comment first");
  const object = urnFromUrl(postUrl);
  const { accessToken, urn } = await personUrn(h, connectionId);
  const r = await apiRaw(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(object)}/comments`, {
    method: "POST",
    headers: headers(accessToken),
    json: { actor: urn, object, message: { text: text.trim() } },
  });
  return { id: r.headers.get("x-restli-id") ?? (r.data as { id?: string } | null)?.id ?? "", post: object, url: `https://www.linkedin.com/feed/update/${object}` };
}

/** Delete one of your own posts. */
export async function linkedinDelete(h: Helpers, connectionId: string, postUrl: string) {
  const urn = decodeURIComponent(postUrl).match(/urn:li:(share|ugcPost|activity):\d+/)?.[0];
  if (!urn) throw new StepError("Couldn't find the post ID");
  const { accessToken } = await h.token(connectionId);
  await apiRaw(`https://api.linkedin.com/rest/posts/${encodeURIComponent(urn)}`, { method: "DELETE", headers: headers(accessToken) });
}
