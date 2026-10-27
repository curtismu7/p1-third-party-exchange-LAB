// The ONLY code that talks to PingOne in live mode. It may contact exactly:
//   https://auth.pingone.<tld>/<envId>/as/*              (the token endpoint of the saved environment)
//   https://api.pingone.<tld>/v1/environments/<envId>/*  (the management API of the saved environment)
// (and, in tests, a loopback http stub standing in for both). https only, no credentials in the URL, no redirect is ever followed,
// 20 s timeout, 256 KB response cap. Every call is recorded in the same `wire` format as the mock, with the worker bearer and every
// client secret redacted. The real network guard (netguard.js) is a second wall: it refuses any other host even if this check were bypassed.
import { Buffer } from 'node:buffer';
import { makeItem } from '../wire.js';
import { apiHost, authHost, regionTld } from './regions.js';
import { isLoopbackHost } from '../safety.js';

export const LIMITS = { timeoutMs: 20_000, maxBody: 256 * 1024 };
export class LiveError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const BEARER_REDACTED = 'Bearer <worker token: redacted>';
export const BASIC_REDACTED = 'Basic <redacted: client secret is write-only>';

/** target: { envId, region } for PingOne, or { envId, stub: 'http://127.0.0.1:PORT' } for the tests' stand-in. */
export function targetOf({ envId, region, stub }) {
  if (stub) {
    const u = new URL(stub);
    if (u.protocol !== 'http:' || !isLoopbackHost(u.hostname)) throw new LiveError('bad_target', 'the stub target must be loopback http');
    return { envId, kind: 'stub', authBase: u.origin, apiBase: u.origin, hosts: [] };
  }
  const tld = regionTld(region);
  if (!tld) throw new LiveError('bad_target', 'unknown region');
  return { envId, kind: 'pingone', authBase: `https://${authHost(tld)}`, apiBase: `https://${apiHost(tld)}`, hosts: [authHost(tld), apiHost(tld)] };
}

export function allowedUrl(target, rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new LiveError('refused_url', 'not a URL'); }
  if (u.username || u.password) throw new LiveError('refused_url', 'credentials in the URL');
  if (target.kind === 'pingone' && u.protocol !== 'https:') throw new LiveError('refused_url', 'https only');
  if (target.kind === 'stub' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname))) throw new LiveError('refused_url', 'only the loopback stub');
  const auth = new URL(target.authBase); const api = new URL(target.apiBase);
  const isAuth = u.host === auth.host && u.pathname.startsWith(`/${target.envId}/as/`);
  const isApi = u.host === api.host && u.pathname.startsWith(`/v1/environments/${target.envId}/`);
  if (!isAuth && !isApi) throw new LiveError('refused_url', `${u.host}${u.pathname.slice(0, 40)} is not an allowed PingOne endpoint`);
  if (u.pathname.includes('..') || u.pathname.includes('//')) throw new LiveError('refused_url', 'odd path');
  return u;
}

async function readCapped(res) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) return '';
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LIMITS.maxBody) { try { await reader.cancel(); } catch { /* ignore */ } throw new LiveError('too_large', `response larger than ${LIMITS.maxBody} bytes`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createLiveClient({ target, secrets = () => [], fetchImpl = (...a) => globalThis.fetch(...a), now = () => Math.floor(Date.now() / 1000) }) {
  const wire = [];
  let n = 0;
  let phase = 'setup';
  let bearer = null;
  const scrub = (text) => secrets().filter(Boolean).reduce((t, s) => t.split(s).join('<redacted>'), String(text));
  const authUrl = (p) => `${target.authBase}/${target.envId}/as/${p}`;
  const apiUrl = (p) => `${target.apiBase}/v1/environments/${target.envId}/${p}`;

  /** opts: { method, url, auth: 'basic'|'bearer'|null, basic: {id, secret}, form, json, label, key, notes, redactResponse(text)->text } */
  async function call(opts) {
    const u = allowedUrl(target, opts.url);
    const headers = [];
    let sentAuth = null; let shownAuth = null;
    if (opts.auth === 'basic') { sentAuth = `Basic ${Buffer.from(`${opts.basic.id}:${opts.basic.secret}`).toString('base64')}`; shownAuth = BASIC_REDACTED; }
    if (opts.auth === 'bearer') { if (!bearer) throw new LiveError('no_token', 'no worker token'); sentAuth = `Bearer ${bearer}`; shownAuth = BEARER_REDACTED; }
    const body = opts.form ? new URLSearchParams(opts.form).toString() : opts.json !== undefined ? JSON.stringify(opts.json) : '';
    if (sentAuth) headers.push(['Authorization', sentAuth]);
    if (body) headers.push(['Content-Type', opts.form ? 'application/x-www-form-urlencoded' : 'application/json']);
    headers.push(['Accept', 'application/json']);
    const sentHeaders = Object.fromEntries(headers);
    let res; let text;
    try {
      res = await fetchImpl(u.toString(), { method: opts.method, headers: sentHeaders, body: body || undefined, redirect: 'manual', signal: AbortSignal.timeout(LIMITS.timeoutMs) });
      if (res.status >= 300 && res.status < 400) throw new LiveError('redirect_refused', `a redirect (${res.status}) was not followed`);
      text = await readCapped(res);
    } catch (e) {
      if (e instanceof LiveError) throw e;
      throw new LiveError('network', scrub(e && e.name === 'TimeoutError' ? 'the request timed out after 20 s' : `the request failed: ${e && e.message}`));
    }
    const shownText = scrub(opts.redactResponse ? opts.redactResponse(text) : text);
    const resHeaders = [...res.headers.entries()].map(([k, v]) => [k, scrub(v)]);
    n += 1;
    const item = makeItem({
      n, id: `${phase === 'runtime' ? 'w' : 's'}${n}`, key: opts.key || `call-${n}`, label: opts.label || `${opts.method} ${u.pathname}`, phase, method: opts.method, url: u.toString(),
      reqHeaders: headers.map(([k, v]) => [k, k === 'Authorization' ? shownAuth : v]), requestBody: scrub(body), status: res.status, resHeaders, responseBody: shownText,
      notes: opts.notes || 'Captured live.', evidence: 'measured', now: now(), raw: true,
    });
    wire.push(item);
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json, item };
  }

  return {
    target, wire, authUrl, apiUrl, call,
    setPhase(p) { phase = p; },
    setBearer(t) { bearer = t; },
    items: () => wire.slice(),
    nextNumber: () => n + 1,
  };
}
