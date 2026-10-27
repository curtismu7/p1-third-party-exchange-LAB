// Pure helpers for the two "Real exchange" tabs. Nothing here touches the network or storage.
import { decodeJwt } from "./jwt";

export const GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
export const TOKEN_TYPES = [
  ["urn:ietf:params:oauth:token-type:jwt", "jwt (third-party JWT)"],
  ["urn:ietf:params:oauth:token-type:access_token", "access_token (PingOne)"],
  ["urn:ietf:params:oauth:token-type:id_token", "id_token"],
];
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// The only hosts a browser send is allowed to reach: the token endpoint of the visitor's own PingOne region.
const HOST_RE = /^auth\.pingone\.(com|eu|asia|ca|com\.au|sg)$/;
const PATH_RE = new RegExp(`^/(${UUID})/as/token$`);

/** Strict parse of a PingOne token endpoint URL. { ok, envId, region, host, url } or { ok: false, error }. */
export function parseTokenEndpoint(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "Paste your token endpoint." };
  if (text.length > 300 || /[\s\u0000-\u001f\\]/.test(text)) return { ok: false, error: "That is not a plain URL." };
  if (/\.\.|%|\/\.\/|\/\/.*\/\//.test(text)) return { ok: false, error: "No dot segments, percent escapes or empty path segments." };
  let u;
  try { u = new URL(text); } catch { return { ok: false, error: "That is not a URL." }; }
  if (u.protocol !== "https:") return { ok: false, error: "The token endpoint must be https." };
  if (u.username || u.password) return { ok: false, error: "No user name or password in the URL." };
  if (u.port || /^[a-z]+:\/\/[^/?#]*:\d/i.test(text)) return { ok: false, error: "No port: PingOne's token endpoint is on the default https port." };
  if (u.search || u.hash) return { ok: false, error: "No query string or fragment." };
  const host = u.hostname;
  const m = HOST_RE.exec(host);
  if (!m) return { ok: false, error: "The host must be your PingOne auth host (auth.pingone.<com|eu|asia|ca|com.au|sg>)." };
  const p = PATH_RE.exec(u.pathname);
  if (!p) return { ok: false, error: "The path must be /<environment id>/as/token." };
  return { ok: true, envId: p[1].toLowerCase(), region: m[1], host, url: `${u.protocol}//${host}${u.pathname}` };
}

const parseExtra = (text) => {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i < 1) return { error: `Extra parameter "${t.slice(0, 40)}" must look like name=value.` };
    const k = t.slice(0, i).trim(); const v = t.slice(i + 1);
    if (!/^[A-Za-z_][\w.-]{0,63}$/.test(k) || ["__proto__", "constructor", "prototype"].includes(k)) return { error: `Extra parameter name "${k.slice(0, 40)}" is not allowed.` };
    if (["grant_type", "subject_token", "subject_token_type", "actor_token", "actor_token_type", "scope", "client_id", "client_secret", "audience", "resource"].includes(k)) return { error: `${k} has its own field.` };
    out.push([k, v]);
  }
  if (out.length > 10) return { error: "At most 10 extra parameters." };
  return { pairs: out };
};

export const REDACTED_BASIC = "Basic <redacted: client secret is write-only>";
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** Build the request. The secret is used only to compute the Authorization header or the form; callers redact for display. */
export function buildRequest(f) {
  const ep = parseTokenEndpoint(f.endpoint);
  if (!ep.ok) return { error: ep.error };
  if (!f.clientId.trim() || !f.clientSecret) return { error: "Enter the exchanging application's client id and secret." };
  if (!f.scope.trim()) return { error: "Enter a scope." };
  if (!f.subjectToken.trim()) return { error: "Paste a subject token." };
  const extra = parseExtra(f.extra);
  if (extra.error) return { error: extra.error };
  const pairs = [["grant_type", GRANT], ["subject_token", f.subjectToken.trim()], ["subject_token_type", f.subjectType]];
  if (f.actorToken.trim()) pairs.push(["actor_token", f.actorToken.trim()], ["actor_token_type", f.actorType]);
  pairs.push(["scope", f.scope.trim()]);
  if (f.audience.trim()) pairs.push(["audience", f.audience.trim()]);
  pairs.push(...extra.pairs);
  const headers = [["Content-Type", "application/x-www-form-urlencoded"], ["Accept", "application/json"]];
  let secretValue = null;
  if (f.authStyle === "basic") { secretValue = `Basic ${b64(`${f.clientId.trim()}:${f.clientSecret}`)}`; headers.unshift(["Authorization", secretValue]); }
  else pairs.push(["client_id", f.clientId.trim()], ["client_secret", f.clientSecret]);
  return { ep, url: ep.url, method: "POST", headers, pairs, authStyle: f.authStyle, body: new URLSearchParams(pairs).toString(), secret: f.clientSecret, basic: secretValue };
}

/** The request as text. reveal=false redacts the secret (the default); reveal=true shows it, only in the visitor's own browser. */
export function requestView(req, reveal = false) {
  const hs = req.headers.map(([k, v]) => [k, k === "Authorization" && !reveal ? REDACTED_BASIC : v]);
  const body = req.authStyle === "body" && !reveal ? new URLSearchParams(req.pairs.map(([k, v]) => [k, k === "client_secret" ? "<redacted: client secret is write-only>" : v])).toString() : req.body;
  const u = new URL(req.url);
  const text = `${req.method} ${u.pathname} HTTP/1.1\nHost: ${u.host}\n${hs.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${body}`;
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const curl = [`curl -i -X ${req.method} ${q(req.url)}`, ...hs.map(([k, v]) => `  -H ${q(`${k}: ${v}`)}`), `  --data-raw ${q(body)}`].join(" \\\n");
  return { text, curl, body, headers: hs };
}

/** What a browser send produced -> the same item shape WireItem renders. */
export function wireItemFor(req, res, { reveal, includeSecretInCurl }) {
  const shown = requestView(req, reveal);
  const curlView = requestView(req, includeSecretInCurl);
  const status = res ? res.status : 0;
  return {
    n: 1, id: "b1", key: "browser-exchange", label: "Token exchange (REAL request from your browser to your PingOne)", phase: "runtime", method: req.method, url: req.url,
    requestHeaders: shown.headers.map(([name, value]) => ({ name, value })), requestBody: shown.body, curl: curlView.curl, requestText: shown.text,
    status, statusText: res ? res.statusText : "", responseHeaders: res ? res.headers.map(([name, value]) => ({ name, value })) : [], responseBody: res ? res.text : "",
    responseText: res ? `HTTP ${status} ${res.statusText}\n${res.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${prettyJson(res.text)}` : "(no response)",
    notes: "Sent directly from this browser to your PingOne. Nothing passed through this server.", evidence: "measured",
  };
}
export const prettyJson = (t) => { try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; } };

/** Inspect a pasted token: what PingOne's trusted issuer will care about. */
export function inspectToken(raw) {
  const d = decodeJwt(raw);
  if (d.error) return { ok: false, error: d.error };
  const p = d.payload; const h = d.header;
  const now = Math.floor(Date.now() / 1000);
  const aud = p.aud === undefined ? [] : [].concat(p.aud);
  const notes = [];
  if (!h.kid && h.x5t) notes.push("This token has x5t and no kid (typical of PingFederate). PingOne must find the signing key in the issuer's JWKS by x5t, so the key has to be published there.");
  if (!h.kid && !h.x5t) notes.push("The header has neither kid nor x5t: PingOne can only try the keys in the JWKS.");
  if (p.exp === undefined) notes.push("No exp claim: a trusted issuer with expRequired (the default) refuses this token.");
  else if (p.exp <= now) notes.push(`exp is in the past (${new Date(p.exp * 1000).toISOString()}): PingOne will say the JWT has expired.`);
  if (p.act !== undefined && (p.act === null || typeof p.act !== "object" || Array.isArray(p.act))) notes.push('act is not an object (e.g. the text "{}"): it must be an OBJECT such as {"sub": "..."} to be usable as an act claim.');
  if (h.alg && h.alg !== "RS256" && !/^(RS|ES|PS)\d{3}$/.test(h.alg)) notes.push(`Unusual signing algorithm: ${h.alg}.`);
  return {
    ok: true, header: h, payload: p, alg: h.alg, kid: h.kid || null, x5t: h.x5t || null, iss: typeof p.iss === "string" ? p.iss : null, sub: p.sub ?? null, aud,
    hasExp: p.exp !== undefined, hasIat: p.iat !== undefined, hasNbf: p.nbf !== undefined, exp: p.exp ?? null, expired: p.exp !== undefined && p.exp <= now,
    act: p.act === undefined ? "absent" : p.act !== null && typeof p.act === "object" && !Array.isArray(p.act) ? "object" : "not an object", notes,
  };
}

/** What to configure in PingOne for this actor token. */
export function trustedIssuerNote(info) {
  if (!info.ok || !info.iss) return "";
  const base = info.iss.replace(/\/+$/, "");
  return `Trusted issuer needed in PingOne: Issuer = ${info.iss} (character for character), JWKS URL = the jwks_uri of ${base}/.well-known/openid-configuration (for PingFederate: ${base}/pf/JWKS). Assign it to the exchanging application.`;
}

// PingOne's refusal reasons (measured live 2026-10-27) with what to check.
export const REASONS = [
  ["The provided JWT has expired", "The actor (or subject) token's exp is past. Get a fresh token."],
  ["JWT signature verification failed", "PingOne could not verify the signature with the trusted issuer's keys. Check the JWKS URL, that the signing key is published there (PingFederate: the JWT access token manager must publish its keys), and that the token's kid/x5t matches a key."],
  ["does not match any Trusted Issuer assigned to the application", "No trusted issuer assigned to this application has an Issuer equal to the token's iss. Compare character for character (trailing slash, port, case)."],
  ["does not match any Trusted Issuer for the requesting application", "The issuer exists but is not assigned to the application that is sending the exchange. Add the trusted issuer assignment."],
  ["Missing exp claim", "The token has no exp and the trusted issuer requires it. PingFederate: make the access token manager include exp."],
  ["Missing nbf claim", "The trusted issuer has nbfRequired on, but the token has no nbf."],
  ["Missing iat claim", "The trusted issuer has iatRequired on, but the token has no iat."],
  ["nbf claim is in the future", "The token is not valid yet. Check the clocks or raise clockSkew (at most 60 s)."],
  ["None of the token's aud values match", "The trusted issuer has an audience list and none of the token's aud values is in it. Blank the list or fix the token's aud."],
  ["exceeds the maximum allowed future validity", "The token's exp is further ahead than the trusted issuer's maxFutureValidity."],
  ["Provided token type must be urn:ietf:params:oauth:token-type:jwt", "Set actor_token_type (or subject_token_type) to urn:ietf:params:oauth:token-type:jwt for a third-party token."],
  ["No value supplied for required parameter: actor_token_type", "Send actor_token_type together with actor_token."],
];
export function hintFor(responseText) {
  let d = responseText;
  try { const j = JSON.parse(responseText); d = j.error_description || j.message || responseText; } catch { /* plain text */ }
  const hit = REASONS.find(([m]) => String(d).includes(m));
  return hit ? { reason: hit[0], hint: hit[1] } : null;
}

export const PF_HELP = [
  "Using your PingFederate token as the third-party token",
  "In PingOne: add a Trusted issuer with Issuer = your PingFederate base URL exactly as it appears in the token's iss, JWKS URL = <PingFederate base URL>/pf/JWKS, and leave Audience blank. Assign it to the exchanging application (see the Setup guide tab for every step).",
  "The PingFederate token must be a JWT with exp. Its access token manager (ATM) must publish its signing key to the PingFederate JWKS endpoint (\"Publish Keys to the PingFederate JWKS Endpoint\"), otherwise PingOne reports JWT signature verification failed.",
  "PingFederate's token endpoint does not allow browser requests (CORS), so get the PF token yourself (curl or Postman) and paste it here.",
];
