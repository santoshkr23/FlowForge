import { randomBytes } from "node:crypto";

const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short, sortable-ish, URL-safe id (time prefix + random). */
export function createId() {
  const t = Date.now().toString(36);
  const r = Array.from(randomBytes(12), (b) => ALPHA[b % 36]).join("");
  return `${t}${r}`;
}
