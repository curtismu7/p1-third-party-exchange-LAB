// Decode a JWT from the string that is on screen. No verification (the browser has no key); this only reads header and payload.
const part = (p) => {
  const b64 = p.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(p.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};
/** { header, payload, signature } or { error } */
export function decodeJwt(raw) {
  const t = String(raw).trim();
  if (t.length > 8192) return { error: "longer than 8192 characters" };
  const parts = t.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) return { error: "a JWT has three base64url parts separated by dots" };
  try { return { header: part(parts[0]), payload: part(parts[1]), signature: parts[2] }; } catch { return { error: "the header or payload is not base64url JSON" }; }
}
