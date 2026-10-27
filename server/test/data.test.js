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
import { verifyJwt } from '../src/jwt.js';

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
  assert.match(doc.steps.at(-1).why, /Wire call \d+ response/);
  assert.equal(doc.steps.at(-1).hop, 'exchange:res');
});

test('docs/talk-track.md is exactly what the talk-track data renders (no drift; run `npm run talk-track`)', () => {
  const doc = fs.readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8');
  assert.equal(doc, renderTalkTrackMarkdown(DEFAULT_CAST));
  for (const t of D.TALK_TRACK) assert.ok(doc.includes(`## ${t.title}`), t.id);
});

test('the mock JWTs are real RS256 tokens: the actor verifies against the JWKS of the trusted-issuer call, and the claims round-trip', () => {
  const r = runOf({ vendorId: 'okta' });
  const [h, p, sig] = r.jwts.actor.split('.');
  assert.ok(sig.length > 300, 'a real RSA-2048 signature, not a placeholder');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT', kid: 'mock-key' });
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, r.actor.iss);
  assert.equal(verifyJwt(r.jwts.actor, JSON.parse(r.jwks)).ok, true);
  assert.match(r.jwtLabel, /MOCK/);
});
