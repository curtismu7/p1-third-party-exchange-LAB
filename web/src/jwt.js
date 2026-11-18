// Decode a JWT from the string that is on screen. No verification (the browser has no key); this only reads header and payload.
// Rule 24b: the segment decoding is the shared pane's (components/JsonPane, meta #396); this wrapper keeps the lab's error-shape and 8192 cap.
import { decodeSegment } from "./components/JsonPane";
const part = (p) => {
  const v = decodeSegment(p);
  if (!v) throw new Error("not base64url JSON");
  return v;
};
/** { header, payload, signature } or { error } */
export function decodeJwt(raw) {
  const t = String(raw).trim();
  if (t.length > 8192) return { error: "longer than 8192 characters" };
  const parts = t.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) return { error: "a JWT has three base64url parts separated by dots" };
  try {
    const header = part(parts[0]); const payload = part(parts[1]);
    const plain = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
    if (!plain(header) || !plain(payload)) return { error: "the header and payload must be JSON objects" };
    return { header, payload, signature: parts[2] };
  } catch { return { error: "the header or payload is not base64url JSON" }; }
}
