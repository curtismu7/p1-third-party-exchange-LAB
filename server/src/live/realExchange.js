// "Real exchange (local)": ONE real RFC 8693 request to the saved environment's token endpoint, nothing created or deleted. The exchanging
// app's secret and the optional third-party client secret are used in memory for this request only: never returned, logged or stored, and
// redacted in the wire (the router also scrubs every response). The only other outbound calls are the optional one-shot client-credentials
// call to the user-typed third-party token endpoint and the public GETs of "Check issuer metadata", both through checkPublicUrl.
import { Buffer } from 'node:buffer';
import { swapAllowedHosts, allowNetworkHosts } from '../netguard.js';
import { makeItem } from '../wire.js';
import { LIMITS, LiveError } from './client.js';
import { BASIC_REDACTED } from './client.js';
import { assertPublicHost, checkPublicUrl } from './ssrf.js';
import { thirdPartyJwksFromX5c } from './x5t.js';

const TYPE_RE = /^urn:[A-Za-z0-9:._-]{1,150}$/;
const RESERVED = new Set(['grant_type', 'subject_token', 'subject_token_type', 'actor_token', 'actor_token_type', 'scope', 'client_id', 'client_secret', 'audience', 'resource']);
const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS = 'urn:ietf:params:oauth:token-type:access_token';
const JWT = 'urn:ietf:params:oauth:token-type:jwt';
export class InputError extends Error { constructor(message) { super(message); this.code = 'bad_input'; } }

const text = (v, name, max, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw new InputError(`${name} is required`); return ''; }
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)) throw new InputError(`${name} must be plain text of at most ${max} characters`);
  return v.trim();
};

/** Validate the request body of POST /api/live/real/exchange. Returns a clean object or throws InputError. */
export function parseExchangeInput(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new InputError('body must be an object');
  const authStyle = b.authStyle === 'body' ? 'body' : 'basic';
  if (b.authStyle !== undefined && !['basic', 'body'].includes(b.authStyle)) throw new InputError('authStyle must be basic or body');
  const typeOf = (v, name, dflt) => { const t = v === undefined || v === '' ? dflt : v; if (typeof t !== 'string' || !TYPE_RE.test(t)) throw new InputError(`${name} must be a urn: token type`); return t; };
  const subject = b.subject || { mode: 'paste' };
  const actor = b.actor || { mode: 'none' };
  if (!['paste', 'cc'].includes(subject.mode)) throw new InputError('subject.mode must be paste or cc');
  if (!['paste', 'fetch', 'none'].includes(actor.mode)) throw new InputError('actor.mode must be paste, fetch or none');
  const extraIn = b.extra === undefined ? {} : b.extra;
  if (extraIn === null || typeof extraIn !== 'object' || Array.isArray(extraIn) || Object.keys(extraIn).length > 10) throw new InputError('extra must be an object of at most 10 parameters');
  const extra = {};
  for (const [k, v] of Object.entries(extraIn)) {
    if (!/^[A-Za-z_][\w.-]{0,63}$/.test(k) || ['__proto__', 'constructor', 'prototype'].includes(k)) throw new InputError('an extra parameter name is not allowed');
    if (RESERVED.has(k)) throw new InputError(`${k} has its own field; it cannot be an extra parameter`);
    extra[k] = text(v, `extra ${k}`, 2000);
  }
  const out = {
    appId: text(b.appId, 'appId', 128, { required: true }), appSecret: text(b.appSecret, 'appSecret', 512, { required: true }), authStyle,
    scope: text(b.scope, 'scope', 500, { required: true }), audience: text(b.audience, 'audience', 500), resource: text(b.resource, 'resource', 500),
    subjectType: typeOf(b.subjectType, 'subjectType', ACCESS), actorType: typeOf(b.actorType, 'actorType', JWT), extra,
    subject: { mode: subject.mode, token: subject.mode === 'paste' ? text(subject.token, 'subject token', 8192, { required: true }) : '' },
    actor: { mode: actor.mode, token: actor.mode === 'paste' ? text(actor.token, 'actor token', 8192, { required: true }) : '', fetch: null },
  };
  if (actor.mode === 'fetch') {
    const f = actor.fetch || {};
    out.actor.fetch = { url: text(f.url, 'third-party token endpoint', 2000, { required: true }), clientId: text(f.clientId, 'third-party client id', 256, { required: true }), clientSecret: text(f.clientSecret, 'third-party client secret', 512, { required: true }), style: f.style === 'body' ? 'body' : 'basic' };
  }
  return out;
}

const enc = (pairs) => new URLSearchParams(pairs).toString();

/** One-shot GET/POST to a user-typed public origin: checkPublicUrl + resolved-address check + netguard for that exact host only, no redirect, 20 s, 256 KB. */
export async function publicCall({ rawUrl, method = 'GET', headers = [], body = '', stub, secrets, label, key, phase, nowFn, fetchImpl = (...a) => globalThis.fetch(...a), lookup, redact }) {
  const u = checkPublicUrl(rawUrl, { stub });
  if (!stub || !(u.protocol === 'http:')) await assertPublicHost(u.hostname, lookup);
  const previous = swapAllowedHosts([u.hostname]);
  let res; let textBody;
  try {
    res = await fetchImpl(u.toString(), { method, headers: Object.fromEntries(headers), body: body || undefined, redirect: 'manual', signal: AbortSignal.timeout(LIMITS.timeoutMs) });
    if (res.status >= 300 && res.status < 400) throw new LiveError('redirect_refused', `a redirect (${res.status}) was not followed`);
    const reader = res.body.getReader(); const chunks = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > LIMITS.maxBody) { await reader.cancel(); throw new LiveError('too_large', 'response larger than 256 KB'); } chunks.push(value); }
    textBody = Buffer.concat(chunks).toString('utf8');
  } catch (e) {
    if (e instanceof LiveError) throw e;
    throw new LiveError('network', e && e.name === 'TimeoutError' ? 'the request timed out after 20 s' : `the request failed: ${e && e.message}`);
  } finally { allowNetworkHosts(previous); }
  const scrub = (t) => secrets.filter(Boolean).reduce((s, x) => s.split(x).join('<redacted>').split(encodeURIComponent(x)).join('<redacted>'), String(t));
  const shown = scrub(redact ? redact(textBody) : textBody);
  const item = makeItem({ n: 0, id: 'x', key, label, phase, method, url: u.toString(), reqHeaders: headers.map(([k, v]) => [k, k === 'Authorization' ? BASIC_REDACTED : v]), requestBody: scrub(body), status: res.status, resHeaders: [...res.headers.entries()].map(([k, v]) => [k, scrub(v)]), responseBody: shown, notes: 'Third-party call made from this server for you.', evidence: 'measured', now: nowFn(), raw: true });
  let json = null; try { json = JSON.parse(textBody); } catch { /* not JSON */ }
  return { status: res.status, json, text: textBody, item };
}

/** The whole tab-1 operation. `client` is the Live client (PingOne only). Returns { wire, subject, actor, issued, response }. */
export async function realExchange({ client, input, stub, secrets, nowFn, fetchImpl, lookup }) {
  secrets.push(input.appSecret);
  const wire = [];
  const num = () => wire.length + 1;
  const push = (item, label) => { item.n = num(); item.id = `w${item.n}`; if (label) item.label = label; wire.push(item); return item; };
  const basicOrBody = (id, secret, style, pairs) => (style === 'basic' ? { auth: 'basic', basic: { id, secret }, form: pairs } : { form: [...pairs, ['client_id', id], ['client_secret', secret]] });

  let subjectToken = input.subject.token; let actorToken = input.actor.token;
  client.setPhase('runtime');
  if (input.subject.mode === 'cc') {
    const r = await client.call({ method: 'POST', url: client.authUrl('token'), ...basicOrBody(input.appId, input.appSecret, input.authStyle, [['grant_type', 'client_credentials'], ['scope', input.scope]]), key: 'cc', label: 'PingOne subject token (client credentials from this app)' });
    if (r.status !== 200 || !r.json || !r.json.access_token) return { wire: client.items(), stopped: `the subject token request returned HTTP ${r.status}`, response: r.json };
    subjectToken = r.json.access_token;
  }
  let thirdPartyWire = null;
  if (input.actor.mode === 'fetch') {
    const f = input.actor.fetch; secrets.push(f.clientSecret);
    const pairs = [['grant_type', 'client_credentials']];
    const hdr = [['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json']];
    let body;
    if (f.style === 'basic') { hdr.unshift(['Authorization', `Basic ${Buffer.from(`${f.clientId}:${f.clientSecret}`).toString('base64')}`]); body = enc(pairs); } else body = enc([...pairs, ['client_id', f.clientId], ['client_secret', f.clientSecret]]);
    const r = await publicCall({ rawUrl: f.url, method: 'POST', headers: hdr, body, stub, secrets, label: 'Third-party token request (client credentials)', key: 'third-party-token', phase: 'runtime', nowFn, fetchImpl, lookup, redact: (t) => t });
    thirdPartyWire = r.item;
    if (r.status !== 200 || !r.json || !(r.json.access_token || r.json.id_token)) { const items = [...client.items(), r.item]; return { wire: items.map((x, i) => ({ ...x, n: i + 1, id: `w${i + 1}` })), stopped: `the third-party token endpoint returned HTTP ${r.status}; no exchange was sent` }; }
    actorToken = r.json.access_token || r.json.id_token;
  }
  const pairs = [['grant_type', GRANT], ['subject_token', subjectToken], ['subject_token_type', input.subjectType]];
  if (actorToken) pairs.push(['actor_token', actorToken], ['actor_token_type', input.actorType]);
  pairs.push(['scope', input.scope]);
  if (input.audience) pairs.push(['audience', input.audience]);
  if (input.resource) pairs.push(['resource', input.resource]);
  for (const [k, v] of Object.entries(input.extra)) pairs.push([k, v]);
  const ex = await client.call({ method: 'POST', url: client.authUrl('token'), ...basicOrBody(input.appId, input.appSecret, input.authStyle, pairs), key: 'exchange', label: 'Token exchange (REAL request to PingOne)', notes: 'The one real RFC 8693 request. Client secrets are redacted; every token is shown whole.' });
  // renumber: PingOne calls, with the third-party call placed just before the exchange
  const items = client.items();
  if (thirdPartyWire) items.splice(items.length - 1, 0, thirdPartyWire);
  items.forEach((x, i) => { x.n = i + 1; x.id = `w${i + 1}`; });
  return { wire: items, subjectToken, actorToken, response: ex.json, status: ex.status, issued: ex.json && ex.json.access_token, pingoneError: ex.status >= 400 && ex.json ? ex.json : null };
}

const b64u = (b) => Buffer.from(b).toString('base64url');

/** "Check issuer metadata": public GETs of <iss>/.well-known/openid-configuration and the jwks_uri. */
export async function checkIssuer({ iss, kid, x5t, jwksUrl, stub, secrets = [], nowFn, fetchImpl, lookup }) {
  if (typeof iss !== 'string' || iss.length > 1000) throw new InputError('iss must be a URL');
  const base = iss.replace(/\/+$/, '');
  const report = { discovery: { url: `${base}/.well-known/openid-configuration`, reachable: false }, jwks: { url: null, reachable: false, count: 0, kids: [], x5ts: [] }, match: { kid: null, x5t: null }, flags: [], wire: [] };
  const get = async (url, label, key) => publicCall({ rawUrl: url, method: 'GET', headers: [['Accept', 'application/json']], stub, secrets, label, key, phase: 'runtime', nowFn, fetchImpl, lookup });
  let jwksFrom = jwksUrl || null;
  try {
    const d = await get(report.discovery.url, 'GET issuer discovery document', 'discovery');
    report.wire.push(d.item); report.discovery.status = d.status; report.discovery.reachable = d.status === 200 && Boolean(d.json);
    if (d.json && typeof d.json.jwks_uri === 'string' && !jwksFrom) jwksFrom = d.json.jwks_uri;
    if (d.json && typeof d.json.issuer === 'string') { report.discovery.issuer = d.json.issuer; report.discovery.issuerMatches = d.json.issuer === iss; if (d.json.issuer !== iss) report.flags.push(`The discovery document says issuer ${d.json.issuer}, the token says ${iss}: PingOne's Issuer field must equal the token's iss exactly.`); }
  } catch (e) { report.discovery.error = e.message; report.flags.push(`Discovery document not reachable: ${e.message}`); }
  if (!jwksFrom) report.flags.push('No jwks_uri found; type the JWKS URL of your issuer.');
  else {
    report.jwks.url = jwksFrom;
    try {
      const j = await get(jwksFrom, 'GET issuer JWKS', 'jwks');
      report.wire.push(j.item); report.jwks.status = j.status; report.jwks.reachable = j.status === 200 && Boolean(j.json && Array.isArray(j.json.keys));
      if (report.jwks.reachable) {
        const keys = j.json.keys;
        report.jwks.count = keys.length;
        report.jwks.kids = keys.map((k) => k.kid).filter(Boolean);
        report.jwks.x5ts = keys.flatMap((k) => [k.x5t, ...thirdPartyJwksFromX5c(k)]).filter(Boolean);
        if (kid) report.match.kid = report.jwks.kids.includes(kid);
        if (x5t) report.match.x5t = report.jwks.x5ts.includes(x5t);
        if (!report.jwks.kids.length) report.flags.push('None of the keys in this JWKS has a kid.');
      }
    } catch (e) { report.jwks.error = e.message; report.flags.push(`JWKS not reachable: ${e.message}`); }
  }
  if (!kid && x5t) report.flags.push('PingFederate trap: this token carries x5t and no kid. PingOne has to find the signing key in the JWKS, so the key must be published there with a matching x5t or kid.');
  if (report.jwks.reachable && (kid || x5t) && report.match.kid !== true && report.match.x5t !== true) report.flags.push('The token\'s kid/x5t matches NO key in this JWKS. For PingFederate: the JWT access token manager (ATM) must have "Publish Keys to the PingFederate JWKS Endpoint" on, otherwise its signing key is not at /pf/JWKS. PingOne will then fail with "JWT signature verification failed".');
  if (report.jwks.reachable && (kid || x5t) && (report.match.kid === true || report.match.x5t === true)) report.flags.push('A key in the JWKS matches the token\'s kid/x5t.');
  void b64u;
  return report;
}
