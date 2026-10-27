import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { InputError, parseExchangeInput } from '../src/live/realExchange.js';
import { UrlRefused, assertPublicHost, checkPublicUrl, isPrivateAddress } from '../src/live/ssrf.js';
import { decodeJwt } from '../src/jwt.js';
import { startStub } from '../src/live/stub.js';
import { withServer } from './helpers.js';

// SAFETY: no test may resolve the shared settings file to the real home directory.
process.env.DEMO_KIT_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'p1tpx-guard-'));
const ENV_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const WSECRET = ['worker', 'probe', 'value'].join('-');
const APPSECRET = ['app', 'probe', 'val&ue/+='].join('-');
const TPSECRET = ['tp', 'probe', 'value'].join('-');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `p1tpx-${p}-`));

test('SSRF guard: https only, no IP literals, no internal names, no credentials; every resolved address must be public', async () => {
  for (const ok of ['https://idp.vendor.example/as/token.oauth2', 'https://idp.vendor.example:9031/as/token.oauth2', 'https://a.b.c.example/x?y=1']) assert.ok(checkPublicUrl(ok), ok);
  const refused = ['http://idp.vendor.example/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://192.168.1.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://localhost/x', 'https://intranet/x', 'https://host.internal/x', 'https://printer.local/x', 'https://user:pw@idp.vendor.example/x', 'https://idp.vendor.example\\@evil.example/', 'ftp://idp.vendor.example/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://idp vendor.example/', '', 5, null, `https://${'a'.repeat(3000)}.example/`, 'https://[::ffff:127.0.0.1]/x', 'https://127.1/x'];
  for (const u of refused) assert.throws(() => checkPublicUrl(u), UrlRefused, String(u).slice(0, 40));
  assert.ok(checkPublicUrl('http://127.0.0.1:9/tp/token', { stub: true }), 'the loopback stub is the only loopback exception');
  assert.throws(() => checkPublicUrl('http://10.0.0.1/x', { stub: true }), UrlRefused);
  assert.throws(() => checkPublicUrl('http://evil.example/x', { stub: true }), UrlRefused);
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.9', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', 'garbage']) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946']) assert.equal(isPrivateAddress(a), false, a);
  await assert.rejects(assertPublicHost('x.example', async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }]), UrlRefused);
  await assert.rejects(assertPublicHost('x.example', async () => []), UrlRefused);
  await assert.rejects(assertPublicHost('x.example', async () => { throw new Error('nx'); }), UrlRefused);
  assert.equal((await assertPublicHost('x.example', async () => [{ address: '93.184.216.34' }])).length, 1);
});

test('exchange input is validated and bounded: types, extras, reserved names, prototype keys, lengths', () => {
  const ok = { appId: 'a', appSecret: 's', scope: 'p1x.read', subject: { mode: 'paste', token: 'x.y.z' } };
  const p = parseExchangeInput({ ...ok, actor: { mode: 'paste', token: 'a.b.c' }, extra: { requested_token_type: 'urn:x' } });
  assert.equal(p.actorType, 'urn:ietf:params:oauth:token-type:jwt');
  assert.equal(p.subjectType, 'urn:ietf:params:oauth:token-type:access_token');
  assert.equal(p.authStyle, 'basic');
  const bad = [null, [], 'x', { ...ok, appId: '' }, { ...ok, appSecret: undefined }, { ...ok, scope: '' }, { ...ok, authStyle: 'digest' }, { ...ok, subjectType: 'jwt' }, { ...ok, actorType: 'urn:' + 'x'.repeat(200) },
    { ...ok, subject: { mode: 'paste' } }, { ...ok, subject: { mode: 'other' } }, { ...ok, actor: { mode: 'fetch', fetch: {} } }, { ...ok, actor: { mode: 'paste' } },
    { ...ok, extra: { grant_type: 'x' } }, { ...ok, extra: { actor_token: 'x' } }, { ...ok, extra: { 'bad name': 'x' } }, { ...ok, extra: JSON.parse('{"__proto__":"x"}') }, { ...ok, extra: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])) },
    { ...ok, extra: { a: 'x'.repeat(2001) } }, { ...ok, subject: { mode: 'paste', token: 'x'.repeat(9000) } }, { ...ok, scope: 'a\u0000b' }];
  for (const b of bad) assert.throws(() => parseExchangeInput(b), InputError, JSON.stringify(b)?.slice(0, 60));
});

// ---- stub based end to end ---------------------------------------------------------------------------------------------------------
async function realServer(fn, { env: extra = {}, hosted = false, configure = true } = {}) {
  const tpKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const tp = { ...tpKeys, kid: 'tp-key-1', clientId: 'tp-client', clientSecret: TPSECRET };
  const stub = await startStub({ envId: ENV_ID, workerSecret: WSECRET, tp });
  const share = tmp('share'); const data = tmp('data');
  const env = { MODE: 'live', P1TPX_ALLOW_LIVE: '1', P1TPX_LIVE_STUB: stub.url, DEMO_KIT_CONFIG_DIR: share, P1TPX_DATA_DIR: data, ...extra };
  const captured = [];
  const wo = process.stdout.write; const we = process.stderr.write;
  const tap = (o) => function t(c, ...r) { captured.push(String(c)); return o.call(this, c, ...r); };
  process.stdout.write = tap(wo); process.stderr.write = tap(we);
  try {
    await withServer(async (url) => {
      const post = (p, body) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(body) });
      if (configure !== false) await post('/api/live/settings', { environmentId: ENV_ID, region: 'com', clientId: stub.workerId, clientSecret: WSECRET });
      await fn({ url, post, stub, tp, captured, share, data });
    }, { env, hosted, live: { dataDir: data } });
  } finally { process.stdout.write = wo; process.stderr.write = we; await stub.close(); }
}

// Build the PingOne objects directly on the stub (this is what the owner would already have in a real environment).
async function prepare(stub, tp, { attributes = true } = {}) {
  const w = await (await fetch(`${stub.url}/${ENV_ID}/as/token`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${stub.workerId}:${WSECRET}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })).json();
  const api = async (m, p, b) => (await fetch(`${stub.url}/v1/environments/${ENV_ID}/${p}`, { method: m, headers: { authorization: `Bearer ${w.access_token}`, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
  const jwk = { ...tp.publicKey.export({ format: 'jwk' }), kid: tp.kid, use: 'sig', alg: 'RS256' };
  const ti = await api('POST', 'trustedIssuers', { name: 'preexisting-issuer', issuer: stub.tpIssuer, expRequired: true, jwks: JSON.stringify({ keys: [jwk] }) });
  const res = await api('POST', 'resources', { name: 'preexisting-resource', audience: 'https://api.preexisting.example' });
  const scope = await api('POST', `resources/${res.id}/scopes`, { name: 'real.read' });
  if (attributes) { await api('POST', `resources/${res.id}/attributes`, { name: 'act', type: 'CUSTOM', value: "${{'sub': #root.context.requestData.actorToken.sub}}" }); await api('POST', `resources/${res.id}/attributes`, { name: 'security', type: 'CUSTOM', value: '${#root.context.requestData.actorToken.securityLevel}' }); }
  const app = await api('POST', 'applications', { name: 'preexisting-app', type: 'WEB_APP', grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'], tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' });
  await api('POST', `applications/${app.id}/grants`, { resource: { id: res.id }, scopes: [{ id: scope.id }] });
  await api('POST', `applications/${app.id}/trustedIssuerAssignments`, { trustedIssuer: { id: ti.id } });
  const secret = stub.state.apps.get(app.id).secret;
  return { appId: app.id, appSecret: secret, ti, res };
}

test('REAL EXCHANGE (stub): client-credentials subject + third-party actor fetched once, ONE exchange, nothing created or deleted, secrets redacted everywhere', async () => {
  await realServer(async ({ post, stub, tp, captured, data }) => {
    const { appId, appSecret } = await prepare(stub, tp);
    const logBefore = stub.state.log.length;
    const body = { confirm: ENV_ID, appId, appSecret, authStyle: 'basic', scope: 'real.read', subject: { mode: 'cc' }, actor: { mode: 'fetch', fetch: { url: `${stub.url}/tp/token`, clientId: 'tp-client', clientSecret: TPSECRET } } };
    const r = await post('/api/live/real/exchange', body);
    const text = await r.text();
    assert.equal(r.status, 200);
    const j = JSON.parse(text);
    assert.equal(j.error ?? null, null);
    assert.equal(j.pingoneError ?? null, null);
    const calls = stub.state.log.slice(logBefore);
    assert.deepEqual(calls, [`POST /${ENV_ID}/as/token`, 'POST /tp/token', `POST /${ENV_ID}/as/token`], 'subject, third-party fetch, ONE exchange; no management call, nothing created or deleted');
    assert.deepEqual(j.wire.map((w) => w.key), ['cc', 'third-party-token', 'exchange']);
    assert.deepEqual(j.wire.map((w) => w.n), [1, 2, 3]);
    const ex = j.wire[2];
    const f = new URLSearchParams(ex.requestBody);
    assert.equal(f.get('actor_token'), j.actorToken);
    assert.equal(f.get('subject_token'), j.subjectToken);
    assert.equal(f.get('actor_token_type'), 'urn:ietf:params:oauth:token-type:jwt');
    assert.equal(f.get('grant_type'), 'urn:ietf:params:oauth:grant-type:token-exchange');
    const issued = decodeJwt(j.issued).payload;
    assert.deepEqual(issued.act, { sub: 'tp-client' });
    assert.equal(issued.security, 'Class 3');
    assert.equal(decodeJwt(j.actorToken).header.kid, 'tp-key-1');
    for (const w of j.wire) assert.equal(w.requestHeaders.find((h) => h.name === 'Authorization')?.value ?? 'Basic <redacted: client secret is write-only>', 'Basic <redacted: client secret is write-only>');
    for (const s of [appSecret, TPSECRET, WSECRET, encodeURIComponent(appSecret), Buffer.from(`${appId}:${appSecret}`).toString('base64'), Buffer.from(`tp-client:${TPSECRET}`).toString('base64')]) {
      assert.ok(!text.includes(s), `response leaks ${s.slice(0, 6)}`);
      assert.ok(!captured.join('').includes(s), 'log leaks');
    }
    for (const f2 of fs.readdirSync(data, { recursive: true })) assert.ok(!fs.readFileSync(path.join(data, f2), 'utf8').includes(appSecret));
    assert.ok(!fs.existsSync(path.join(data, 'live-cleanup.json')));
    assert.ok(!JSON.stringify([...stub.state.apps.values()].map((a) => a.name)).includes('p1x-live'));
  });
});

test('REAL EXCHANGE: body auth style puts the client in the form (redacted in the wire), pasted tokens, extra params, a PingOne refusal comes back whole', async () => {
  await realServer(async ({ post, stub, tp }) => {
    const { appId, appSecret } = await prepare(stub, tp);
    const cc = await (await post('/api/live/real/exchange', { confirm: ENV_ID, appId, appSecret, authStyle: 'body', scope: 'real.read', subject: { mode: 'cc' }, actor: { mode: 'none' } })).json();
    const first = cc.wire[0];
    assert.ok(first.requestBody.includes('client_id=') && first.requestBody.includes('client_secret=%3Credacted%3E') || first.requestBody.includes('client_secret=<redacted>'), first.requestBody);
    assert.ok(!JSON.stringify(cc).includes(appSecret) && !JSON.stringify(cc).includes(encodeURIComponent(appSecret)));
    assert.equal(first.requestHeaders.some((h) => h.name === 'Authorization'), false);
    assert.deepEqual(decodeJwt(cc.issued).payload.act, { sub: null }, 'no actor token: act comes out {"sub": null}');
    // a pasted actor signed by another key is refused by PingOne's check, and the refusal is returned and mapped
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { signJwt } = await import('../src/jwt.js');
    const t = Math.floor(Date.now() / 1000);
    const forged = signJwt({ iss: stub.tpIssuer, sub: 'x', exp: t + 600 }, { privateKey: other.privateKey, kid: 'tp-key-1' });
    const bad = await (await post('/api/live/real/exchange', { confirm: ENV_ID, appId, appSecret, scope: 'real.read', subject: { mode: 'paste', token: cc.subjectToken }, actor: { mode: 'paste', token: forged }, extra: { note: 'x' } })).json();
    assert.equal(bad.status, 400);
    assert.equal(bad.pingoneError.error, 'invalid_request');
    assert.match(bad.pingoneError.error_description, /JWT signature verification failed/);
    assert.equal(bad.wire.at(-1).status, 400);
    assert.ok(new URLSearchParams(bad.wire.at(-1).requestBody).get('note') === 'x');
  });
});

test('REAL EXCHANGE: gate, typed confirm, bad input and SSRF refusals; a refused third-party URL sends nothing', async () => {
  await realServer(async ({ post, stub, tp, url }) => {
    const { appId, appSecret } = await prepare(stub, tp);
    const base = { appId, appSecret, scope: 'real.read', subject: { mode: 'cc' }, actor: { mode: 'none' } };
    assert.equal((await post('/api/live/real/exchange', base)).status, 400);
    assert.equal((await post('/api/live/real/exchange', { ...base, confirm: ENV_ID.slice(1) })).status, 400);
    assert.equal((await post('/api/live/real/exchange', { ...base, confirm: ENV_ID, scope: '' })).status, 400);
    const n = stub.state.log.length;
    const before = stub.state.log.length;
    for (const u of ['https://127.0.0.1/token', 'https://169.254.169.254/latest', 'http://idp.vendor.example/token', 'https://localhost/token', 'https://user:pw@idp.vendor.example/token', 'https://10.1.1.1/token']) {
      const r = await post('/api/live/real/exchange', { ...base, confirm: ENV_ID, actor: { mode: 'fetch', fetch: { url: u, clientId: 'c', clientSecret: TPSECRET } } });
      const j = await r.json();
      assert.equal(j.error, 'refused_url', u);
      assert.ok(!JSON.stringify(j).includes(TPSECRET));
    }
    const after = stub.state.log.slice(before);
    assert.ok(after.every((l) => l === `POST /${ENV_ID}/as/token`), 'only the subject token requests; no exchange and no third-party call went out');
    assert.equal(after.length, 6, 'one subject token per attempt, never an exchange');
    assert.ok(n >= 0);
    assert.equal((await fetch(`${url}/api/live/real/exchange`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ ...base, confirm: ENV_ID }) })).status, 403);
  });
});

test('the real-exchange endpoints answer 403 unless the whole live gate passes (default mock, hosted image, container bind)', async () => {
  for (const [env, hosted] of [[{}, false], [{ MODE: 'live', P1TPX_ALLOW_LIVE: '1' }, true], [{ MODE: 'live', P1TPX_ALLOW_LIVE: '1', P1TPX_BIND: '0.0.0.0' }, false], [{ MODE: 'live' }, false]]) await withServer(async (url) => {
    for (const p of ['/api/live/real/exchange', '/api/live/real/issuer-check']) {
      const r = await fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify({ iss: 'https://idp.vendor.example' }) });
      assert.equal(r.status, 403, p);
      assert.equal((await r.json()).error, 'live_disabled');
    }
  }, { env, hosted });
});

test('Check issuer metadata (stub): reachable, key count, kid match; the PingFederate trap (x5t, no kid, key not published) is flagged', async () => {
  await realServer(async ({ post, stub }) => {
    const ok = await (await post('/api/live/real/issuer-check', { iss: stub.tpIssuer, kid: 'tp-key-1' })).json();
    assert.equal(ok.discovery.reachable, true);
    assert.equal(ok.discovery.issuerMatches, true);
    assert.equal(ok.jwks.reachable, true);
    assert.equal(ok.jwks.count, 1);
    assert.deepEqual(ok.jwks.kids, ['tp-key-1']);
    assert.equal(ok.match.kid, true);
    assert.ok(ok.flags.some((f) => /matches the token's kid/.test(f)));
    assert.equal(ok.wire.length, 2);
    const trap = await (await post('/api/live/real/issuer-check', { iss: stub.tpIssuer, x5t: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA' })).json();
    assert.equal(trap.match.x5t, false);
    assert.ok(trap.flags.some((f) => /x5t and no kid/.test(f)));
    assert.ok(trap.flags.some((f) => /Publish Keys to the PingFederate JWKS Endpoint/.test(f)));
    const wrongKid = await (await post('/api/live/real/issuer-check', { iss: stub.tpIssuer, kid: 'nope' })).json();
    assert.equal(wrongKid.match.kid, false);
    for (const iss of ['https://127.0.0.1/x', 'http://idp.vendor.example', 'https://localhost', 'https://10.0.0.1']) {
      const j = await (await post('/api/live/real/issuer-check', { iss })).json();
      assert.equal(j.discovery.reachable, false, iss);
      assert.match(j.discovery.error, /IP addresses are not allowed|https only|internal-looking/, iss);
      assert.equal(j.wire.length, 0, 'nothing was requested');
    }
    for (const iss of [5, 'x'.repeat(1200)]) assert.equal((await post('/api/live/real/issuer-check', { iss })).status, 400);
    const dead = await (await post('/api/live/real/issuer-check', { iss: `${stub.url}/nothing` })).json();
    assert.equal(dead.discovery.reachable, false);
  });
});
