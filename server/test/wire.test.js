import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAST, VERTICALS } from '../src/cast.js';
import { VENDORS } from '../src/exchangeData.js';
import { normalizeInput, runExchange } from '../src/exchange.js';
import { decodeJwt, signJwt, verifyJwt } from '../src/jwt.js';
import { badKey, thirdPartyJwks } from '../src/keys.js';
import { scanHosts } from '../src/safety.js';
import { rawHttp, withServer } from './helpers.js';

const NOW = 1_790_000_000;
const runOf = (body, cast = DEFAULT_CAST) => runExchange(normalizeInput(body), { now: NOW, cast });
const FIELDS = ['n', 'id', 'key', 'label', 'phase', 'method', 'url', 'requestHeaders', 'requestBody', 'curl', 'status', 'statusText', 'responseHeaders', 'responseBody', 'responseBodyPretty', 'requestText', 'responseText', 'notes', 'evidence'];
const JWT = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{100,}/g;

test('every wire and setup item has every field, ordered numbering, full URLs on mock hosts and the headers the contract names', () => {
  for (const v of VENDORS) for (const body of [{}, { settings: { nbfRequired: true } }, { assigned: false }]) {
    const r = runOf({ vendorId: v.id, ...body });
    const all = [...r.setup, ...r.wire];
    assert.deepEqual(all.map((i) => i.n), all.map((_, i) => i + 1), 'numbered in order, setup then runtime');
    assert.ok(r.setup.length >= 9 && r.wire.length === 3);
    for (const i of all) {
      for (const f of FIELDS) assert.ok(i[f] !== undefined && i[f] !== null && i[f] !== '' || (f === 'requestBody' && i.method === 'GET'), `${i.id}.${f}`);
      assert.match(i.url, /^https:\/\/(auth\.pingone\.example|api\.pingone\.example|[a-z0-9.-]+\.example)(:\d+)?\//);
      assert.ok(i.requestHeaders.length >= 3 && i.requestHeaders.every((h) => h.name && typeof h.value === 'string'));
      assert.equal(i.requestHeaders[0].name, 'Host');
      const names = i.responseHeaders.map((h) => h.name);
      for (const need of ['Date', 'Content-Type', 'Cache-Control', 'Pragma', 'X-Correlation-Id']) assert.ok(names.includes(need), `${i.id} ${need}`);
      assert.equal(i.responseHeaders.find((h) => h.name === 'Cache-Control').value, 'no-store');
      assert.equal(i.responseHeaders.find((h) => h.name === 'Pragma').value, 'no-cache');
      assert.ok(i.curl.startsWith('curl -i -X '));
      assert.ok(['setup', 'runtime'].includes(i.phase));
      JSON.parse(i.responseBody);
      assert.equal(JSON.stringify(JSON.parse(i.responseBody), null, 2), i.responseBodyPretty);
    }
    assert.deepEqual(scanHosts(JSON.stringify(all)), []);
  }
});

test('the setup calls are the live-proven sequence: issuer, resource, scope, attributes, app, secret, grant, assignment', () => {
  const r = runOf({ vendorId: 'pf-oidc', settings: { clockSkew: 30, maxFutureValidity: 3600, audiences: 'one, two' } });
  assert.deepEqual(r.setup.map((i) => `${i.method} ${new URL(i.url).pathname.replace(/^\/v1\/environments\/[0-9a-f-]+/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}')}`), [
    'POST /{id}/as/token', 'POST /trustedIssuers', 'POST /resources', 'POST /resources/{id}/scopes', 'POST /resources/{id}/attributes',
    'POST /applications', 'GET /applications/{id}/secret', 'POST /applications/{id}/grants', 'POST /applications/{id}/trustedIssuerAssignments']);
  const issuer = JSON.parse(r.setup[1].requestBody);
  assert.equal(typeof issuer.jwks, 'string', 'inline jwks is a JSON string');
  assert.deepEqual(JSON.parse(issuer.jwks), thirdPartyJwks());
  assert.deepEqual([issuer.expRequired, issuer.iatRequired, issuer.nbfRequired, issuer.clockSkew, issuer.maxFutureValidity, issuer.audiences], [true, false, false, 30, 3600, ['one', 'two']]);
  assert.equal(JSON.parse(r.setup[1].responseBody).jwksUrl, null);
  assert.equal(r.setup[1].status, 201);
  assert.equal(JSON.parse(r.setup[4].requestBody).value, '${#root.context.requestData.actorToken.securityLevel}');
  const act = runOf({ vendorId: 'pf-cc' }).setup.find((i) => i.key === 'attr-1');
  assert.equal(JSON.parse(act.requestBody).value, "${{'sub': #root.context.requestData.actorToken.sub}}");
  assert.deepEqual(JSON.parse(r.setup.find((i) => i.key === 'app').requestBody).grantTypes, ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE']);
});

test('no token is truncated or replaced by a placeholder anywhere in the wire: full JWTs sit in the urlencoded body and the response, and decode', () => {
  for (const v of VENDORS) {
    const r = runOf({ vendorId: v.id });
    const ex = r.wire.find((i) => i.key === 'exchange');
    const params = new URLSearchParams(ex.requestBody);
    assert.equal(params.get('subject_token'), r.jwts.subject);
    assert.equal(params.get('actor_token'), r.jwts.actor);
    assert.equal(params.get('actor_token_type'), 'urn:ietf:params:oauth:token-type:jwt');
    assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:token-exchange');
    assert.equal(JSON.parse(ex.responseBody).access_token, r.jwts.issued);
    assert.equal(JSON.parse(r.wire[0].responseBody).access_token, r.jwts.subject);
    assert.ok(r.wire[1].responseBody.includes(r.jwts.actor), `${v.id}: the vendor response carries the full actor token`);
    for (const i of [...r.setup, ...r.wire]) {
      for (const text of [i.requestBody, i.responseBody, i.requestText, i.responseText, i.curl]) assert.ok(!/<[^>]*(token|jwt|secret)[^>]*>|\.\.\.|…/i.test(text), `${i.id} has a placeholder or an ellipsis`);
      for (const t of i.requestText.match(JWT) || []) assert.ok(t.length > 300 && decodeJwt(t).header.alg === 'RS256');
    }
    assert.ok(ex.requestText.includes(r.jwts.actor) && ex.requestText.includes(r.jwts.subject));
    assert.ok(ex.curl.includes(r.jwts.actor.replace(/[^A-Za-z0-9_.-]/g, '')));
  }
});

test('the actor JWT verifies against the JWKS posted in the trusted-issuer call; a bad signature (second key, same kid) really fails verification', () => {
  const good = runOf({ vendorId: 'okta' });
  const jwks = JSON.parse(JSON.parse(good.setup.find((i) => i.key === 'issuer').requestBody).jwks);
  assert.equal(verifyJwt(good.jwts.actor, jwks).ok, true);
  assert.equal(good.checks.find((c) => c.id === 'signature').ok, true);
  const bad = runOf({ vendorId: 'okta', tokenState: 'bad-signature' });
  assert.equal(decodeJwt(bad.jwts.actor).header.kid, decodeJwt(good.jwts.actor).header.kid, 'same kid');
  const v = verifyJwt(bad.jwts.actor, jwks);
  assert.equal(v.ok, false);
  assert.equal(bad.failed.id, 'signature');
  assert.match(bad.error.error_description, /JWT signature verification failed/);
  // the checks are real: tampering with a valid token's payload also fails, and a token signed by the second key but never labelled "bad" fails
  const [h, , s] = good.jwts.actor.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...good.actor, sub: 'attacker' })).toString('base64url')}.${s}`;
  assert.equal(verifyJwt(forged, jwks).ok, false);
  assert.equal(verifyJwt(signJwt({ a: 1 }, { privateKey: badKey().privateKey, kid: 'mock-key' }), jwks).ok, false);
  assert.equal(verifyJwt(signJwt({ a: 1 }, { privateKey: badKey().privateKey, kid: 'other' }), jwks).reason, 'no key in the JWKS has this kid');
});

test('verifyJwt is bounded and refuses alg none, HS256 and malformed tokens', () => {
  const jwks = thirdPartyJwks();
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  for (const t of [`${part({ alg: 'none', kid: 'mock-key' })}.${part({})}.`, `${part({ alg: 'HS256', kid: 'mock-key' })}.${part({})}.abc`, 'a.b', 'x'.repeat(9000), '..', 5, null, undefined, '{}.{}.{}']) assert.equal(verifyJwt(t, jwks).ok, false, String(t).slice(0, 20));
});

test('the PingOne-issued tokens are signed by another mock key (they do not verify against the third-party JWKS) and the issued token carries the mapped claim', () => {
  const r = runOf({ vendorId: 'pf-oidc' });
  assert.equal(verifyJwt(r.jwts.subject, thirdPartyJwks()).ok, false);
  assert.equal(verifyJwt(r.jwts.issued, thirdPartyJwks()).ok, false);
  assert.equal(decodeJwt(r.jwts.issued).payload.security, 'Class 3');
  assert.equal(decodeJwt(r.jwts.issued).header.kid, 'mock-p1-key');
});

test('a refusal puts the full 400 body, with a fake Correlation ID matching the header, on the wire', () => {
  const r = runOf({ vendorId: 'okta', settings: { nbfRequired: true } });
  const ex = r.wire.find((i) => i.key === 'exchange');
  assert.equal(ex.status, 400);
  const body = JSON.parse(ex.responseBody);
  assert.deepEqual(Object.keys(body), ['error', 'error_description']);
  assert.equal(body.error_description, r.error.error_description);
  const header = ex.responseHeaders.find((h) => h.name === 'X-Correlation-Id').value;
  assert.ok(body.error_description.endsWith(`(Correlation ID: ${header})`));
  assert.equal(ex.responseText.includes('Missing nbf claim'), true);
});

test('wire items exist in every vertical pack and every token state', () => {
  for (const cast of Object.values(VERTICALS)) for (const tokenState of ['valid', 'expired', 'wrong-issuer', 'bad-signature']) {
    const r = runOf({ vendorId: 'ms2', tokenState }, cast);
    assert.equal(r.wire.length, 3);
    assert.ok(r.setup.find((i) => i.key === 'resource').requestBody.includes(cast.castResource));
  }
});

test('POST /api/exchange returns wire and setup, GET /api/wire?runId= returns the same data, per workspace; the hosted build serves the same', async () => {
  for (const hosted of [false, true]) await withServer(async (url) => {
    const post = (ws) => fetch(`${url}/api/exchange`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify({ vendorId: 'auth0' }) });
    const j = await (await post('alice')).json();
    assert.match(j.runId, /^[0-9a-f]{16}$/);
    assert.equal(j.wire.length, 3);
    assert.ok(j.setup.length >= 9);
    const w = await (await fetch(`${url}/api/wire?runId=${j.runId}`, { headers: { 'x-workspace': 'alice' } })).json();
    assert.deepEqual(w.wire, j.wire);
    assert.deepEqual(w.setup, j.setup);
    assert.equal((await fetch(`${url}/api/wire?runId=${j.runId}`, { headers: { 'x-workspace': 'bob' } })).status, 404, 'another workspace cannot read it');
    for (const bad of ['zz', '../etc', `${j.runId}0`, '0'.repeat(16)]) assert.equal((await fetch(`${url}/api/wire?runId=${bad}`, { headers: { 'x-workspace': 'alice' } })).status, 404, bad);
    assert.equal((await fetch(`${url}/api/wire?runId[a]=1`, { headers: { 'x-workspace': 'alice' } })).status, 404);
    const latest = await (await fetch(`${url}/api/wire`, { headers: { 'x-workspace': 'alice' } })).json();
    assert.equal(latest.runId, j.runId, 'no runId: the latest run of the workspace');
    const nf = await fetch(`${url}/api/wire?runId=${'0'.repeat(16)}`, { headers: { 'x-workspace': 'alice' } });
    assert.deepEqual(await nf.json(), { error: 'run_not_found', hint: 'POST /api/exchange first' });
    const none = await fetch(`${url}/api/wire`, { headers: { 'x-workspace': 'nobody' } });
    assert.equal(none.status, 404);
    assert.equal((await none.json()).error, 'run_not_found');
    await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': 'alice' }, body: '{}' });
    assert.equal((await fetch(`${url}/api/wire?runId=${j.runId}`, { headers: { 'x-workspace': 'alice' } })).status, 404, 'Reset clears it');
    assert.equal((await rawHttp(`${url}/api/wire?runId=${j.runId}`, { headers: { host: 'evil.example.invalid' } })).status, 403);
  }, { hosted });
});

test('hostile input is still bounded after the wire change, and the wire never reflects user text unescaped into a header', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/exchange`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify({ vendorId: 'okta', settings: { audiences: 'a\r\nX-Evil: 1,b' } }) });
    const j = await r.json();
    assert.equal(r.status, 200);
    for (const i of [...j.setup, ...j.wire]) for (const h of [...i.requestHeaders, ...i.responseHeaders]) assert.ok(!/[\r\n]/.test(h.name + h.value), i.id);
    assert.ok(!j.setup[1].requestBody.includes('\r'));
    assert.equal((await fetch(`${url}/api/exchange`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify({ vendorId: 'okta', pad: 'x'.repeat(9000) }) })).status, 413);
  });
});
