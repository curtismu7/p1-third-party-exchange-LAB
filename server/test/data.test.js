import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CAST, VERTICALS, fill, unfilled } from '../src/cast.js';
import * as D from '../src/exchangeData.js';
import { DIAGRAM_NAMES, DYNAMIC_KEYS, buildDiagram, rawDiagram } from '../src/diagramData.js';
import { validateDiagram } from '../src/diagramStudioValidate.js';
import { normalizeInput, runExchange } from '../src/exchange.js';
import { readSetupMarkdown } from '../src/setup.js';
import { renderTalkTrackMarkdown } from '../src/talk.js';
import { scanHosts } from '../src/safety.js';

const NOW = 1_790_000_000;
const dyn = Object.fromEntries(DYNAMIC_KEYS.map((k) => [k, 'x']));
const all = () => JSON.stringify([{ ...D, VENDORS: D.VENDORS.map((v) => ({ ...v, claims: undefined })) }, D.TALK_TRACK, DIAGRAM_NAMES.map(rawDiagram), readSetupMarkdown()]);
const runOf = (body, cast = DEFAULT_CAST) => runExchange(normalizeInput(body), { now: NOW, cast });

test('every {{token}} in the data, the diagrams and the guide is defined by every vertical or by a run (fails on an undefined token)', () => {
  for (const [name, cast] of Object.entries(VERTICALS)) assert.deepEqual(unfilled(all(), { ...cast, ...dyn }), [], name);
  assert.equal(Object.keys(VERTICALS).length, 3);
});

test('the check itself catches an undefined token and leaves it visible', () => {
  assert.deepEqual(unfilled('a {{castBrand}} {{nope}}', DEFAULT_CAST), ['nope']);
  assert.equal(fill('{{nope}}', DEFAULT_CAST), '{{nope}}');
  assert.equal(fill('{{__proto__}}', DEFAULT_CAST), '{{__proto__}}');
  // a diagram token that no run supplies would be caught by the first test: prove the dynamic list is exactly what the diagrams use
  const used = new Set(unfilled(JSON.stringify(DIAGRAM_NAMES.map(rawDiagram)), {}));
  for (const k of used) assert.ok(DYNAMIC_KEYS.includes(k) || Object.hasOwn(DEFAULT_CAST, k), k);
});

test('every vendor succeeds by default in every vertical, and its mapping is present', () => {
  for (const cast of Object.values(VERTICALS)) for (const v of D.VENDORS) {
    const r = runOf({ vendorId: v.id }, cast);
    assert.equal(r.ok, true, v.id);
    assert.ok(r.mapping.every((m) => m.present), v.id);
    assert.ok(r.issued.aud[0].includes(`api.${cast.castHost}.example/${cast.castResource}`));
  }
});

test('which vendors the nbf and iat switches refuse matches the claims each issuer really puts in its token', () => {
  const refusedBy = (setting) => D.VENDORS.filter((v) => !runOf({ vendorId: v.id, settings: { [setting]: true } }).ok).map((v) => v.id).sort();
  assert.deepEqual(refusedBy('nbfRequired'), ['auth0', 'okta', 'p1', 'pf-cc', 'pf-oidc', 'rfc9068']);
  assert.deepEqual(refusedBy('iatRequired'), ['pf-cc']);
  assert.deepEqual(refusedBy('expRequired'), []);
});

test('the evidence labels stay as honest as the twin: GUIDE for the guide samples, OUR CHOICE for the illustrations, UNVERIFIED stated', () => {
  assert.deepEqual(Object.values(D.EVIDENCE).map((e) => e.label), ['MEASURED', 'GUIDE', 'SAMPLE', 'OUR CHOICE', 'UNVERIFIED']);
  assert.deepEqual(D.VENDORS.filter((v) => v.evidence === 'guide').map((v) => v.id), ['pf-cc', 'pf-oidc']);
  for (const v of D.VENDORS) for (const m of v.mappings) assert.equal(m.evidence, v.evidence === 'guide' ? 'measured' : 'derived', `${v.id}/${m.id}`);
  assert.ok(D.EVIDENCE.unverified.note.includes('guide shows its token requests as images'));
});

test('what is not shown says the subject token is not simulated and that no feature flag name is given', () => {
  const t = D.NOT_SHOWN.join('\n');
  assert.match(t, /Third-party token as the SUBJECT token/);
  assert.match(t, /does not simulate it/);
  assert.match(t, /no flag name/);
  assert.match(readSetupMarkdown(), /the guide gives no flag name/);
  assert.match(t, /order PingOne evaluates the checks in/);
  assert.ok(!/flag (is|named|called)\s+["`']?[a-z_]+_[a-z_]+/i.test(all()), 'no invented flag name');
});

test('the setup guide in docs/setup.md matches the steps and facts in the data, and keeps its labels', () => {
  const md = readSetupMarkdown();
  for (const s of D.STEPS) assert.ok(md.includes(s.title.split(' ').slice(0, 2).join(' ')) || md.includes(s.where), s.title);
  assert.ok(md.includes('trustedIssuers:create|read|update|delete:trustedIssuer'));
  assert.ok(md.includes('Environment Admin'));
  assert.equal((md.match(/\*\*GUIDE\*\*/g) || []).length >= 1, true);
  assert.match(md, /\*\*UNVERIFIED\*\*/);
  assert.match(md, /\*\*MEASURED\*\*/);
  assert.match(md, /Third-party JWT as the subject token \(MEASURED\)/);
});

test('only .example hosts, only placeholder ids, no key-looking values, no real vendor host, in data, mock tokens and guide', () => {
  const runs = D.VENDORS.flatMap((v) => ['valid', 'expired', 'wrong-issuer', 'bad-signature'].map((tokenState) => runOf({ vendorId: v.id, tokenState })));
  const text = JSON.stringify([all(), runs]).replace(/\{\{\w+\}\}/g, 'x');
  assert.deepEqual(scanHosts(text), []);
  for (const real of ['okta.com', 'auth0.com', 'windows.net', 'microsoftonline.com', 'example.com', 'pingidentity']) assert.ok(!text.includes(real), real);
});

test('no copy says "door"', () => {
  assert.ok(!/\bdoors?\b/i.test(all() + readSetupMarkdown()));
});

test('the diagrams are valid diagram-studio/1, filled for every vendor and outcome, with payloads within bounds', () => {
  for (const n of DIAGRAM_NAMES) assert.deepEqual(validateDiagram(rawDiagram(n)), [], n);
  for (const v of D.VENDORS) for (const s of [{}, { settings: { nbfRequired: true } }, { tokenState: 'bad-signature' }]) {
    const run = runOf({ vendorId: v.id, ...s });
    const doc = buildDiagram(DEFAULT_CAST, run);
    assert.deepEqual(validateDiagram(doc), []);
    assert.equal(doc.id, run.ok ? 'exchange-success' : 'exchange-refused');
    assert.equal(doc.steps.length, run.ok ? 9 : 7);
    assert.ok(doc.steps.every((st) => st.why && st.why.length <= 600));
    assert.ok(!/\{\{\w+\}\}/.test(JSON.stringify(doc)));
  }
});

test('a refused diagram names the failed check on its last step and edge', () => {
  const run = runOf({ vendorId: 'okta', settings: { nbfRequired: true } });
  const doc = buildDiagram(DEFAULT_CAST, run);
  assert.equal(doc.edges.at(-1).label, 'Refused: nbf present and reached');
  assert.match(doc.steps.at(-1).what, /token has no nbf/);
  assert.match(doc.steps.at(-1).why, /Missing nbf claim/);
});

test('docs/talk-track.md is exactly what the talk-track data renders (no drift; run `npm run talk-track`)', () => {
  const doc = fs.readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8');
  assert.equal(doc, renderTalkTrackMarkdown(DEFAULT_CAST));
  for (const t of D.TALK_TRACK) assert.ok(doc.includes(`## ${t.title}`), t.id);
});

test('the mock JWT is labelled and carries the placeholder signature, never a verifiable one', () => {
  const r = runOf({ vendorId: 'okta' });
  const [h, p, sig] = r.jwts.actor.split('.');
  assert.equal(sig, 'MOCK-SIGNATURE-NOT-VALID');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).kid, 'mock-key');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, r.actor.iss);
});

const PREFIX = 'The request could not be completed. The request was malformed or invalid.: ';
const errorOf = (body) => runOf(body).error;

test('each PingOne refusal text measured live on 2026-10-27 is returned verbatim, HTTP 400 invalid_request', () => {
  const cases = [
    [{ vendorId: 'okta', tokenState: 'expired' }, 'The provided JWT has expired'],
    [{ vendorId: 'okta', tokenState: 'bad-signature' }, 'JWT signature verification failed'],
    [{ vendorId: 'okta', tokenState: 'wrong-issuer' }, 'The token issuer does not match any Trusted Issuer assigned to the application'],
    [{ vendorId: 'okta', assigned: false }, 'The token issuer does not match any Trusted Issuer for the requesting application'],
    [{ vendorId: 'okta', settings: { nbfRequired: true } }, 'Missing nbf claim; the Trusted Issuer requires a not-before time'],
    [{ vendorId: 'pf-cc', settings: { iatRequired: true } }, 'Missing iat claim; the Trusted Issuer requires an issued-at time'],
    [{ vendorId: 'okta', settings: { audiences: 'nope' } }, "None of the token's aud values match the Trusted Issuer's configured audiences"],
    [{ vendorId: 'okta', settings: { maxFutureValidity: 60 } }, 'The exp claim exceeds the maximum allowed future validity'],
    [{ vendorId: 'ms1', settings: { clockSkew: 0 }, tokenState: 'expired' }, 'The provided JWT has expired'],
  ];
  for (const [body, text] of cases) assert.deepEqual(errorOf(body), { status: 400, error: 'invalid_request', error_description: PREFIX + text }, text);
  assert.equal(errorOf({ vendorId: 'okta' }), null);
});

test('the other refusal texts (no exp, nbf in the future, expired) are measured text too', () => {
  const noExp = { ...D.VENDORS[3], claims: (now) => { const { exp, ...rest } = D.VENDORS[3].claims(now); return rest; } };
  const r = runExchange({ vendor: noExp, state: 'valid', settings: normalizeInput({ vendorId: 'okta' }).settings, assigned: true }, { now: NOW, cast: DEFAULT_CAST });
  assert.equal(r.error.error_description, PREFIX + 'Missing exp claim; the Trusted Issuer requires an expiration time');
  const future = { ...D.VENDORS[3], claims: (now) => ({ ...D.VENDORS[3].claims(now), nbf: now + 120 }) };
  const f = (clockSkew) => runExchange({ vendor: future, state: 'valid', settings: { ...normalizeInput({ vendorId: 'okta' }).settings, nbfRequired: true, clockSkew }, assigned: true }, { now: NOW, cast: DEFAULT_CAST });
  assert.equal(f(0).error.error_description, PREFIX + 'The nbf claim is in the future beyond the allowed clock skew');
  assert.equal(f(60).ok, false, 'nbf 120 s ahead is beyond a 60 s skew');
  assert.equal(f(60).failed.id, 'nbf');
});

test('clock skew: an exp 30 s ago passes with skew 60 and fails with skew 0 or 29; 120 s ago fails even with skew 60; the 60 s edge', () => {
  const at = (secondsAgo) => ({ ...D.VENDORS[3], claims: (now) => ({ ...D.VENDORS[3].claims(now), exp: now - secondsAgo }) });
  const go = (secondsAgo, clockSkew) => runExchange({ vendor: at(secondsAgo), state: 'valid', settings: { ...normalizeInput({ vendorId: 'okta' }).settings, clockSkew }, assigned: true }, { now: NOW, cast: DEFAULT_CAST });
  assert.equal(go(30, 60).ok, true);
  assert.equal(go(30, 0).failed.id, 'exp');
  assert.equal(go(30, 29).failed.id, 'exp');
  assert.equal(go(30, 30).failed.id, 'exp', 'exp exactly skew seconds ago is not > now - skew');
  assert.equal(go(30, 31).ok, true);
  assert.equal(go(120, 60).failed.id, 'exp');
  assert.equal(go(60, 60).failed.id, 'exp');
  assert.equal(go(59, 60).ok, true);
});

test('maxFutureValidity: 0 is no limit; with 3600 an exp a day ahead is refused and one 10 minutes ahead passes; the boundary is inclusive', () => {
  const ahead = (s) => ({ ...D.VENDORS[3], claims: (now) => ({ ...D.VENDORS[3].claims(now), exp: now + s }) });
  const go = (s, maxFutureValidity) => runExchange({ vendor: ahead(s), state: 'valid', settings: { ...normalizeInput({ vendorId: 'okta' }).settings, maxFutureValidity }, assigned: true }, { now: NOW, cast: DEFAULT_CAST });
  assert.equal(go(86400, 0).ok, true);
  assert.equal(go(86400, 3600).failed.id, 'maxfuture');
  assert.equal(go(600, 3600).ok, true);
  assert.equal(go(3600, 3600).ok, true);
  assert.equal(go(3601, 3600).failed.id, 'maxfuture');
});

test('what the guide samples really issue: act from sub, security from securityLevel, and an absent source claim leaves the claim out but still issues', () => {
  const noSec = { ...D.VENDORS[1], claims: (now) => { const { securityLevel, ...rest } = D.VENDORS[1].claims(now); return rest; } };
  const r = runExchange({ vendor: noSec, state: 'valid', settings: normalizeInput({ vendorId: 'okta' }).settings, assigned: true }, { now: NOW, cast: DEFAULT_CAST });
  assert.equal(r.ok, true);
  assert.ok(!('security' in r.issued));
  assert.equal(runOf({ vendorId: 'pf-oidc' }).issued.security, 'Class 3');
});
