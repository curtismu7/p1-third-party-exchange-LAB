// The live run: creates THROWAWAY objects named p1x-live-<random> in the saved PingOne environment (a trusted issuer with an INLINE jwks, a
// custom resource with a scope and attributes, a WEB_APP, the grant and the issuer assignment), runs the chosen scenarios, and ALWAYS deletes
// everything again in reverse order in a finally block. The created ids are written to a cleanup file as they are created, so a crash
// leaves a record a "Clean up leftovers" button can use. It never touches an object whose name does not start with p1x-live-.
// Every call is captured in the same `wire` format as the mock. Secrets: the worker secret and the throwaway app secret never leave this
// module (the client redacts them); the exchange and third-party TEST tokens are shown whole.
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { decodeJwt, signJwt } from '../jwt.js';
import { jwkOf } from '../keys.js';
import { MESSAGES, validateExchange } from '../exchange.js';
import { BASIC_REDACTED } from './client.js';

export const PREFIX = 'p1x-live-';
export const TP_ISSUER = 'https://third-party.p1x-test.example';
const JWT_T = 'urn:ietf:params:oauth:token-type:jwt';
const ACCESS_T = 'urn:ietf:params:oauth:token-type:access_token';
const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const KID = 'p1x-live-key-1';
export const BASE_SETTINGS = { expRequired: true, iatRequired: false, nbfRequired: false, clockSkew: 0, maxFutureValidity: 0, audiences: [] };
const ACT_EXPR = "${{'sub': #root.context.requestData.actorToken.sub}}";
const SEC_EXPR = '${#root.context.requestData.actorToken.securityLevel}';
const EXT_EXPR = '${#root.context.requestData.subjectToken.sub}';

const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const baseClaims = (now) => ({ iss: TP_ISSUER, sub: 'p1x-actor', aud: 'p1x-audience', iat: now - 60, exp: now + 3540, jti: `p1x-${now}`, securityLevel: 'Class 3' });

// id, title, kind ('exchange' | 'management'), settings (patch of BASE_SETTINGS), and what the third-party token / request looks like.
export const SCENARIOS = [
  { id: 'valid', title: 'Valid third-party actor token', claims: (c) => c },
  { id: 'expired', title: 'Actor exp in the past', claims: (c, now) => ({ ...c, exp: now - 600 }) },
  { id: 'untrusted-issuer', title: 'iss matches no trusted issuer', claims: (c) => ({ ...c, iss: 'https://untrusted.p1x-test.example' }) },
  { id: 'bad-signature', title: 'Signed with a second key (same kid)', signer: 'B' },
  { id: 'unknown-kid', title: 'Header kid not in the JWKS', kid: 'p1x-live-unknown-kid' },
  { id: 'no-exp', title: 'No exp, expRequired on', claims: (c) => without(c, 'exp') },
  { id: 'nbf-required', title: 'nbfRequired on, token has no nbf', settings: { nbfRequired: true } },
  { id: 'iat-required', title: 'iatRequired on, token has no iat', settings: { iatRequired: true }, claims: (c) => without(c, 'iat') },
  { id: 'audience-mismatch', title: 'Audience list set, no aud matches', settings: { audiences: ['p1x-expected-audience'] } },
  { id: 'clock-skew-ok', title: 'clockSkew 60, exp 30 s ago', settings: { clockSkew: 60 }, claims: (c, now) => ({ ...c, exp: now - 30 }) },
  { id: 'clock-skew-too-old', title: 'clockSkew 60, exp 120 s ago', settings: { clockSkew: 60 }, claims: (c, now) => ({ ...c, exp: now - 120 }) },
  { id: 'max-future', title: 'maxFutureValidity 3600, exp a day ahead', settings: { maxFutureValidity: 3600 }, claims: (c, now) => ({ ...c, exp: now + 86400 }) },
  { id: 'unassigned', title: 'Issuer not assigned to the application', unassigned: true },
  { id: 'missing-source-claim', title: 'Actor has no securityLevel (mapping source absent)', claims: (c) => without(c, 'securityLevel') },
  { id: 'wrong-actor-type', title: 'actor_token_type is access_token', actorType: ACCESS_T },
  { id: 'missing-actor-type', title: 'actor_token_type missing', actorType: null },
  { id: 'no-actor', title: 'No actor token at all (act comes out {"sub": null})', noActor: true },
  { id: 'subject-jwt-with-actor', title: 'Third-party JWT as the SUBJECT token, with an actor', subjectJwt: true },
  { id: 'subject-jwt-no-actor', title: 'Third-party JWT as the SUBJECT token, no actor', subjectJwt: true, noActor: true },
  { id: 'clock-skew-limit', title: 'PUT clockSkew 61 (management API refuses)', kind: 'management', settings: { clockSkew: 61 } },
];

/** What the MOCK predicts for a scenario, using the same validateExchange as the Exchange tab. */
export function predict(sc, now) {
  if (sc.kind === 'management') return { status: 400, reason: MESSAGES.clockSkewLimit };
  if (sc.actorType === null) return { status: 400, reason: MESSAGES.actorTypeMissing };
  if (sc.actorType) return { status: 400, reason: MESSAGES.actorType };
  const claims = (sc.claims || ((c) => c))(baseClaims(now), now);
  const settings = { ...BASE_SETTINGS, ...(sc.settings || {}) };
  const toValidate = [];
  if (sc.subjectJwt) toValidate.push({ ...baseClaims(now), sub: 'p1x-subject-user' });
  if (!sc.noActor) toValidate.push(claims);
  for (const c of toValidate) {
    const r = validateExchange({ vendor: { issuer: TP_ISSUER, claims: () => c }, state: 'valid', settings, assigned: !sc.unassigned, now, signatureOk: !(sc.signer === 'B' || sc.kid) });
    if (!r.ok) return { status: 400, reason: r.failed.message };
  }
  const expect = { act: sc.noActor ? 'null-sub' : (Object.hasOwn(claims, 'sub') ? claims.sub : 'absent'), security: sc.noActor ? 'absent' : (Object.hasOwn(claims, 'securityLevel') ? claims.securityLevel : 'absent'), hasSub: !sc.subjectJwt };
  if (sc.subjectJwt) expect.ext_sub = 'p1x-subject-user';
  return { status: 200, expect };
}

function summarise(json) {
  if (!json) return { status: 0 };
  if (json.access_token) {
    let p; try { p = decodeJwt(json.access_token).payload; } catch { return { ok: true, undecodable: true }; }
    return { ok: true, act: p.act === undefined ? 'absent' : p.act && p.act.sub === null ? 'null-sub' : p.act && p.act.sub, security: p.security === undefined ? 'absent' : p.security, hasSub: Object.hasOwn(p, 'sub'), ext_sub: p.ext_sub };
  }
  return { ok: false };
}

/** match + the mismatch lines the user can paste back. */
export function compare(sc, prediction, live) {
  const mism = [];
  if (prediction.status !== live.status) mism.push({ field: 'status', predicted: prediction.status, live: live.status });
  else if (live.status === 400) { if (!String(live.description || '').includes(prediction.reason)) mism.push({ field: 'error_description', predicted: prediction.reason, live: live.description }); }
  else if (live.status === 200) {
    for (const f of ['act', 'security', 'hasSub', ...(prediction.expect.ext_sub !== undefined ? ['ext_sub'] : [])]) if (live.summary[f] !== prediction.expect[f]) mism.push({ field: f, predicted: prediction.expect[f], live: live.summary[f] });
  }
  return { match: mism.length === 0, mismatches: mism.map((m) => ({ scenario: sc.id, ...m })) };
}

const randomHex = (n) => randomBytes(n).toString('hex');

export async function listLeftovers(client) {
  const found = { apps: [], resources: [], issuers: [] };
  const get = async (p, key, into) => {
    const r = await client.call({ method: 'GET', url: client.apiUrl(p), auth: 'bearer', key: `list-${p}`, label: `GET /${p} (verify nothing named ${PREFIX} remains)` });
    const items = (r.json && r.json._embedded && r.json._embedded[key]) || [];
    for (const o of items) if (typeof o.name === 'string' && o.name.startsWith(PREFIX)) found[into].push({ id: o.id, name: o.name });
  };
  await get('applications', 'applications', 'apps');
  await get('resources', 'resources', 'resources');
  await get('trustedIssuers', 'trustedIssuers', 'issuers');
  return found;
}

async function deleteById(client, collection, o) {
  if (!o.name.startsWith(PREFIX)) throw new Error('refusing to delete an object that is not named p1x-live-*');
  const r = await client.call({ method: 'DELETE', url: client.apiUrl(`${collection}/${o.id}`), auth: 'bearer', key: `del-${collection}`, label: `DELETE /${collection}/{id} (${o.name})` });
  return { collection, name: o.name, status: r.status, ok: r.status === 204 || r.status === 404 };
}

/** Remove every p1x-live-* object (this run's or an earlier run's): apps first, then resources, then trusted issuers. */
export async function cleanupLeftovers(client) {
  const before = await listLeftovers(client);
  const steps = [];
  for (const o of before.apps) steps.push(await deleteById(client, 'applications', o));
  for (const o of before.resources) steps.push(await deleteById(client, 'resources', o));
  for (const o of before.issuers) steps.push(await deleteById(client, 'trustedIssuers', o));
  const after = await listLeftovers(client);
  return { steps, remaining: after, ok: !after.apps.length && !after.resources.length && !after.issuers.length };
}

export const cleanupFile = (dataDir) => path.join(dataDir, 'live-cleanup.json');

/**
 * client: createLiveClient(...); worker: { id, secret }; dataDir: where the cleanup record lives. Returns the whole report.
 */
export async function runLive({ client, worker, dataDir, scenarioIds, now = () => Math.floor(Date.now() / 1000), rand = randomHex, secrets }) {
  const name = `${PREFIX}${rand(3)}`;
  const report = { runName: name, error: null, scenarios: [], mismatches: [], cleanup: null };
  const created = { runName: name, envId: client.target.envId, apps: [], resources: [], issuers: [] };
  const persist = () => { fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }); fs.writeFileSync(cleanupFile(dataDir), JSON.stringify(created), { mode: 0o600 }); };
  const chosen = SCENARIOS.filter((s) => !scenarioIds || scenarioIds.includes(s.id));
  try {
    client.setPhase('setup');
    const tok = await client.call({ method: 'POST', url: client.authUrl('token'), auth: 'basic', basic: worker, form: { grant_type: 'client_credentials' }, key: 'worker', label: 'Worker token for the management API (client credentials)', redactResponse: (t) => t.replace(/("access_token"\s*:\s*")[^"]+/, '$1<worker token: redacted>') });
    if (tok.status !== 200 || !tok.json || !tok.json.access_token) throw new Error(`the worker token request failed (HTTP ${tok.status}); check the worker client id, secret and environment`);
    client.setBearer(tok.json.access_token);
    secrets.push(tok.json.access_token);
    const keyA = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyB = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwks = JSON.stringify({ keys: [jwkOf(keyA.publicKey, KID)] });
    const mk = async (label, key, method, p, json, expectStatus = 201, extra = {}) => {
      const r = await client.call({ method, url: client.apiUrl(p), auth: 'bearer', json, key, label, ...extra });
      if (r.status !== expectStatus) throw new Error(`${label} returned HTTP ${r.status}${r.json && r.json.message ? `: ${r.json.message}` : ''}`);
      return r.json;
    };
    const issuerBody = (s) => ({ name, issuer: TP_ISSUER, expRequired: s.expRequired, iatRequired: s.iatRequired, nbfRequired: s.nbfRequired, clockSkew: s.clockSkew, maxFutureValidity: s.maxFutureValidity, ...(s.audiences.length ? { audiences: s.audiences } : {}), jwks });
    const ti = await mk('POST /trustedIssuers (inline jwks)', 'issuer', 'POST', 'trustedIssuers', issuerBody(BASE_SETTINGS));
    created.issuers.push({ id: ti.id, name }); persist();
    const res = await mk('POST /resources', 'resource', 'POST', 'resources', { name, audience: `https://${name}.example/address`, type: 'CUSTOM' });
    created.resources.push({ id: res.id, name }); persist();
    const scope = await mk('POST /resources/{id}/scopes', 'scope', 'POST', `resources/${res.id}/scopes`, { name: 'p1x.read' });
    await mk('POST /resources/{id}/attributes (act)', 'attr-1', 'POST', `resources/${res.id}/attributes`, { name: 'act', type: 'CUSTOM', value: ACT_EXPR });
    await mk('POST /resources/{id}/attributes (security)', 'attr-2', 'POST', `resources/${res.id}/attributes`, { name: 'security', type: 'CUSTOM', value: SEC_EXPR });
    await mk('POST /resources/{id}/attributes (ext_sub from the subject token)', 'attr-3', 'POST', `resources/${res.id}/attributes`, { name: 'ext_sub', type: 'CUSTOM', value: EXT_EXPR });
    const app = await mk('POST /applications', 'app', 'POST', 'applications', { name, enabled: true, type: 'WEB_APP', protocol: 'OPENID_CONNECT', grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'], tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' });
    created.apps.push({ id: app.id, name }); persist();
    const sec = await client.call({ method: 'GET', url: client.apiUrl(`applications/${app.id}/secret`), auth: 'bearer', key: 'secret', label: 'GET /applications/{id}/secret', redactResponse: (t) => t.replace(/("secret"\s*:\s*")[^"]+/, `$1${BASIC_REDACTED.replace('Basic ', '')}`), notes: 'The throwaway application secret is read here and redacted: client secrets are write-only.' });
    if (sec.status !== 200 || !sec.json || !sec.json.secret) throw new Error(`reading the application secret returned HTTP ${sec.status}`);
    const appSecret = sec.json.secret; secrets.push(appSecret);
    const appAuth = { auth: 'basic', basic: { id: app.id, secret: appSecret } };
    await mk('POST /applications/{id}/grants', 'grant', 'POST', `applications/${app.id}/grants`, { resource: { id: res.id }, scopes: [{ id: scope.id }] });
    let assignment = await mk('POST /applications/{id}/trustedIssuerAssignments', 'assign', 'POST', `applications/${app.id}/trustedIssuerAssignments`, { trustedIssuer: { id: ti.id } });

    client.setPhase('runtime');
    const cc = await client.call({ method: 'POST', url: client.authUrl('token'), ...appAuth, form: { grant_type: 'client_credentials', scope: 'p1x.read' }, key: 'cc', label: 'PingOne subject token (client credentials)' });
    if (cc.status !== 200 || !cc.json || !cc.json.access_token) throw new Error(`the subject token request returned HTTP ${cc.status}`);
    const subjectToken = cc.json.access_token;
    let current = { ...BASE_SETTINGS };
    const put = async (s, label) => client.call({ method: 'PUT', url: client.apiUrl(`trustedIssuers/${ti.id}`), auth: 'bearer', json: issuerBody(s), key: 'put-issuer', label });

    for (const sc of chosen) {
      const t = now();
      const prediction = predict(sc, t);
      const entry = { id: sc.id, title: sc.title, prediction, live: null, match: false, wire: [] };
      let unassignedPending = false;
      try {
        if (sc.kind === 'management') {
          const r = await put({ ...BASE_SETTINGS, ...sc.settings }, 'PUT /trustedIssuers/{id} with clockSkew 61 (expected to be refused)');
          const msg = r.json ? [r.json.message, ...((r.json.details || []).map((d) => d.message))].filter(Boolean).join(' | ') : '';
          entry.live = { status: r.status, description: msg, summary: {} };
          entry.wire = [r.item.n];
        } else {
          const want = { ...BASE_SETTINGS, ...(sc.settings || {}) };
          if (JSON.stringify(want) !== JSON.stringify(current)) { const r = await put(want, `PUT /trustedIssuers/{id} (settings for ${sc.id})`); if (r.status !== 200) throw new Error(`PUT /trustedIssuers returned HTTP ${r.status}`); current = want; }
          if (sc.unassigned) { const d = await client.call({ method: 'DELETE', url: client.apiUrl(`applications/${app.id}/trustedIssuerAssignments/${assignment.id}`), auth: 'bearer', key: 'unassign', label: 'DELETE the trusted issuer assignment' }); if (d.status !== 204) throw new Error(`deleting the assignment returned HTTP ${d.status}`); unassignedPending = true; }
          const claims = (sc.claims || ((c) => c))(baseClaims(t), t);
          const sign = (cl) => signJwt(cl, { privateKey: (sc.signer === 'B' ? keyB : keyA).privateKey, kid: sc.kid || KID });
          const form = { grant_type: GRANT, scope: 'p1x.read' };
          if (sc.subjectJwt) { form.subject_token = sign({ ...baseClaims(t), sub: 'p1x-subject-user' }); form.subject_token_type = JWT_T; } else { form.subject_token = subjectToken; form.subject_token_type = ACCESS_T; }
          if (!sc.noActor) { form.actor_token = sign(claims); if (sc.actorType !== null) form.actor_token_type = sc.actorType || JWT_T; }
          const r = await client.call({ method: 'POST', url: client.authUrl('token'), ...appAuth, form, key: `exchange-${sc.id}`, label: `Token exchange: ${sc.title}` });
          entry.live = { status: r.status, description: r.json && r.json.error_description, summary: summarise(r.json) };
          entry.wire = [r.item.n];
        }
        const c = compare(sc, prediction, entry.live);
        entry.match = c.match; report.mismatches.push(...c.mismatches);
      } catch (e) {
        entry.live = { status: 0, description: `the scenario could not run: ${e.message}`, summary: {} };
        report.mismatches.push({ scenario: sc.id, field: 'run', predicted: 'a result', live: entry.live.description });
      }
      if (unassignedPending) {
        try { assignment = await mk('POST the trusted issuer assignment again', 'assign-again', 'POST', `applications/${app.id}/trustedIssuerAssignments`, { trustedIssuer: { id: ti.id } }); } catch (e) { report.error = `could not recreate the assignment: ${e.message}`; }
      }
      report.scenarios.push(entry);
    }
  } catch (e) {
    report.error = e.message;
  } finally {
    client.setPhase('cleanup');
    try {
      report.cleanup = await cleanupLeftovers(client);
      // "this run" is clean when none of this run's objects remain; objects of earlier runs are reported separately.
      const mine = [...report.cleanup.remaining.apps, ...report.cleanup.remaining.resources, ...report.cleanup.remaining.issuers].filter((o) => o.name === name);
      report.cleanup.thisRunClean = mine.length === 0;
      if (report.cleanup.ok) { try { fs.rmSync(cleanupFile(dataDir)); } catch { /* none */ } }
    } catch (e) {
      report.cleanup = { ok: false, thisRunClean: false, steps: [], remaining: null, error: `cleanup failed: ${e.message}; the ids are in ${cleanupFile(dataDir)} for "Clean up leftovers"` };
    }
  }
  report.wire = client.items();
  return report;
}
