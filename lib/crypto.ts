import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !raw.trim()) throw new Error("ENCRYPTION_KEY is not set on the server. Add it in your host's environment settings and redeploy.");
  // tolerate stray spaces, line breaks and quotes from copy-paste
  const hex = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    const bad = hex.replace(/[0-9a-f]/gi, "").length;
    throw new Error(
      `ENCRYPTION_KEY must be exactly 64 characters using only 0-9 and a-f (it has ${hex.length}${bad ? `, including ${bad} other character${bad > 1 ? "s" : ""}` : ""}). Generate one with: openssl rand -hex 32`,
    );
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM encrypt a JSON-serialisable value. Output: iv.tag.ciphertext (base64url). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptJson<T = Record<string, string>>(payload: string): T {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}
