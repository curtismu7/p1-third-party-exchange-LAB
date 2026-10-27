// Inline token decoding for the wire views. Safe by construction: no eval, input and JSON depth are bounded, malformed tokens are reported
// (never thrown), base64url works with or without padding (see jwt.js). Nothing here changes what is copied: copies always use the raw text.
import { decodeJwt } from "./jwt";

export const MAX_TOKEN = 8192;
const LOOSE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const STRICT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
export const isJwtLike = (s) => typeof s === "string" && s.length <= MAX_TOKEN && STRICT.test(s);

/** Every JWT in a wire item: JSON body fields, urlencoded form fields, header values, then any stray three-part eyJ string. [{ where, token }] */
export function findTokens(item) {
  const found = []; const seen = new Set();
  const add = (where, token) => { const k = `${where}|${token}`; if (token.length <= MAX_TOKEN && !seen.has(k)) { seen.add(k); found.push({ where, token }); } };
  const scanJson = (text, prefix) => {
    let v; try { v = JSON.parse(text); } catch { return false; }
    const stack = [{ v, path: "" }]; let n = 0;
    while (stack.length && n < 500) {
      const { v: cur, path } = stack.pop(); n += 1;
      if (typeof cur === "string") { if (isJwtLike(cur)) add(`${prefix}.${path || "(body)"}`, cur); continue; }
      if (cur && typeof cur === "object" && path.split(".").length <= 6) for (const [k, x] of Object.entries(cur)) stack.push({ v: x, path: path ? `${path}.${k}` : k });
    }
    return true;
  };
  const scanForm = (text, prefix) => { try { for (const [k, v] of new URLSearchParams(text)) if (isJwtLike(v)) add(`${prefix}.${k}`, v); } catch { /* not a form */ } };
  for (const h of item.requestHeaders || []) for (const m of String(h.value).match(LOOSE) || []) add(`request header ${h.name}`, m);
  if (item.requestBody && !scanJson(item.requestBody, "request")) scanForm(item.requestBody, "request");
  if (item.responseBody) scanJson(item.responseBody, "response");
  for (const [prefix, text] of [["request", item.requestBody], ["response", item.responseBody]]) for (const m of String(text || "").match(LOOSE) || []) if (!found.some((f) => f.token === m)) add(`${prefix} body`, m);
  return found;
}

const unit = (s) => { const a = Math.abs(s); if (a < 60) return `${Math.round(a)} s`; if (a < 3600) return `${Math.round(a / 60)} min`; if (a < 172800) return `${Math.round(a / 3600)} h`; return `${Math.round(a / 86400)} days`; };
/** "2026-10-27T18:19:42.000Z (in 59 min)" or "(expired 2 min ago)" for exp, "(2 min ago)" / "(in 5 s)" for the others. */
export function timeNote(claim, sec, now) {
  if (typeof sec !== "number" || !Number.isFinite(sec) || Math.abs(sec) > 8.64e12) return "not a valid time";
  const iso = new Date(sec * 1000).toISOString();
  const d = sec - now;
  const rel = claim === "exp" ? (d > 0 ? `in ${unit(d)}` : `expired ${unit(d)} ago`) : d > 0 ? `in ${unit(d)}` : `${unit(d)} ago`;
  return `${iso} (${rel})`;
}
export const TIME_CLAIMS = ["exp", "iat", "nbf", "auth_time"];
export const HIGHLIGHT = ["iss", "sub", "aud", "scope", "act"];

/** Rows for the claims table, highlighted claims first. */
export function claimRows(payload, now) {
  const keys = Object.keys(payload);
  const order = [...HIGHLIGHT.filter((k) => keys.includes(k)), ...keys.filter((k) => !HIGHLIGHT.includes(k))];
  return order.map((k) => {
    const v = payload[k];
    const value = typeof v === "string" ? v : JSON.stringify(v);
    return { claim: k, value, note: TIME_CLAIMS.includes(k) ? timeNote(k, v, now) : "", highlight: HIGHLIGHT.includes(k) };
  });
}

/** { state: 'valid'|'expired'|'none', text } for the exp badge. */
export function expBadge(payload, now) {
  if (typeof payload.exp !== "number") return { state: "none", text: "no exp claim" };
  const d = payload.exp - now;
  return d > 0 ? { state: "valid", text: `valid, expires in ${unit(d)}` } : { state: "expired", text: `expired ${unit(d)} ago` };
}

/** Decode one token for display: { ok, header, payload, rows, badge } or { ok: false, error }. */
export function describeToken(token, now = Math.floor(Date.now() / 1000)) {
  const d = decodeJwt(token);
  if (d.error) return { ok: false, error: "not a valid JWT" };
  return { ok: true, header: d.header, payload: d.payload, rows: claimRows(d.payload, now), badge: expBadge(d.payload, now) };
}

/** Real signature check with WebCrypto against a JWKS ({ keys }). Never throws. */
export async function verifyAgainstJwks(token, jwks, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  const d = decodeJwt(token);
  if (d.error || !jwks || !Array.isArray(jwks.keys)) return { state: "unchecked", text: "signature not checked here" };
  if (!subtle) return { state: "unchecked", text: "signature not checked here (this browser has no WebCrypto)" };
  if (d.header.alg !== "RS256") return { state: "unchecked", text: `signature not checked here (alg ${String(d.header.alg).slice(0, 10)})` };
  const jwk = jwks.keys.find((k) => k && k.kty === "RSA" && k.kid === d.header.kid);
  if (!jwk) return { state: "other-key", text: "signed by a key that is not in the JWKS of the trusted-issuer call (for example a mock PingOne key)" };
  try {
    const [h, p, s] = token.split(".");
    const key = await subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const pad = (x) => x.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(x.length / 4) * 4, "=");
    const sig = Uint8Array.from(atob(pad(s)), (c) => c.charCodeAt(0));
    const ok = await subtle.verify("RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(`${h}.${p}`));
    return ok ? { state: "verified", text: "signature verifies against the JWKS in the trusted-issuer call (real check)" } : { state: "failed", text: "signature does NOT verify against the JWKS in the trusted-issuer call" };
  } catch { return { state: "unchecked", text: "signature not checked here" }; }
}

/** The JWKS posted in a run's trusted-issuer call (mock or live), if the wire has one. */
export function jwksFromWire(items) {
  for (const i of items || []) {
    if (i.key !== "issuer" || !i.requestBody) continue;
    try { const j = JSON.parse(JSON.parse(i.requestBody).jwks); if (j && Array.isArray(j.keys)) return j; } catch { /* next */ }
  }
  return null;
}

/** ON-SCREEN ONLY: shorten each full token to a one-line placeholder. Callers must copy the raw text, never this. */
export const placeholder = (t) => `${t.slice(0, 8)}…(${t.length} chars, shown decoded below)`;
export function collapseTokens(text, tokens) {
  return [...new Set(tokens.map((t) => t.token))].sort((a, b) => b.length - a.length).reduce((s, t) => s.split(t).join(placeholder(t)), String(text));
}

const KEY = "p1tpx.decode";
export function readDecodePref() { try { const v = window.localStorage.getItem(KEY); return v === null ? true : v === "1"; } catch { return true; } }
export function writeDecodePref(on) { try { window.localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage unavailable: the switch still works for this page */ } }
