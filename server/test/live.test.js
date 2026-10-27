import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allowNetworkHosts, installNetguard, networkHostAllowed } from '../src/netguard.js';
import { LIMITS, LiveError, allowedUrl, createLiveClient, targetOf } from '../src/live/client.js';
import { liveGate } from '../src/live/gate.js';
import { SettingsError, createLiveSettings } from '../src/live/settings.js';
import { SCENARIOS, predict } from '../src/live/run.js';
import { startStub } from '../src/live/stub.js';
import { withServer } from './helpers.js';

// SAFETY: whatever else happens, no test in this file may resolve the shared settings file to the real home directory.
process.env.DEMO_KIT_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'p1tpx-guard-'));
const ENV_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const SENTINEL = 'SENTINEL-WORKER-SECRET-0123456789';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `p1tpx-${p}-`));

// ---- gate -------------------------------------------------------------------------------------------------------------------------
test('the live gate needs MODE=live AND P1TPX_ALLOW_LIVE=1 AND a loopback bind AND a non-hosted build, each on its own', () => {
  const ok = { MODE: 'live', P1TPX_ALLOW_LIVE: '1' };
  assert.deepEqual(liveGate(ok), { requested: true, allowed: true, reasons: [] });
  const cases = [[{}, /MODE is not live/], [{ MODE: 'live' }, /P1TPX_ALLOW_LIVE/], [{ ...ok, P1TPX_ALLOW_LIVE: 'true' }, /P1TPX_ALLOW_LIVE/], [{ ...ok, P1TPX_HOSTED: '1' }, /hosted/], [{ ...ok, P1TPX_BIND: '0.0.0.0' }, /loopback/], [{ ...ok, P1TPX_BIND: '192.0.2.5' }, /loopback/], [{ MODE: 'mock', P1TPX_ALLOW_LIVE: '1' }, /MODE is not live/]];
  for (const [env, re] of cases) { const g = liveGate(env); assert.equal(g.allowed, false, JSON.stringify(env)); assert.match(g.reasons.join(' '), re); }
  assert.equal(liveGate(ok, { hosted: true }).allowed, false);
  assert.equal(liveGate({ ...ok, P1TPX_BIND: '127.0.0.1' }).allowed, true);
});

test('every live endpoint answers 403 with the reasons when the gate fails: default, hosted image, container bind, missing allow flag', async () => {
  const bad = [[{}, false], [{ MODE: 'live' }, false], [{ MODE: 'live', P1TPX_ALLOW_LIVE: '1' }, true], [{ MODE: 'live', P1TPX_ALLOW_LIVE: '1', P1TPX_BIND: '0.0.0.0' }, false]];
  for (const [env, hosted] of bad) await withServer(async (url) => {
    for (const [method, p] of [['GET', '/api/live/status'], ['POST', '/api/live/settings'], ['POST', '/api/live/run'], ['POST', '/api/live/cleanup']]) {
      const r = await fetch(`${url}${p}`, { method, headers: { 'content-type': 'application/json', origin: url }, body: method === 'POST' ? '{}' : undefined });
      assert.equal(r.status, 403, `${method} ${p} ${JSON.stringify(env)} hosted=${hosted}`);
      const j = await r.json();
      assert.equal(j.error, 'live_disabled');
      assert.ok(j.reasons.length >= 1);
    }
    const info = await (await fetch(`${url}/api/info`)).json();
    assert.equal(info.mode, 'mock');
    if (env.MODE === 'live') assert.equal(info.live.enabled, false); else assert.ok(!('live' in info), 'no live key at all in a plain mock build');
    const v = await (await fetch(`${url}/api/vendors`)).json();
    assert.ok(!/LIVE:/.test(v.banner), 'the live banner never appears when live is refused');
  }, { env, hosted });
});

// ---- settings ---------------------------------------------------------------------------------------------------------------------
test('settings: shared pingone.json is written 0600, merged (other keys survive), the secret is never in the public view, a blank secret keeps the old one', () => {
  const dir = tmp('set');
  fs.writeFileSync(path.join(dir, 'pingone.json'), JSON.stringify({ other: 'keep-me', environmentId: ENV_ID, clientSecret: 'old-secret-value' }));
  const s = createLiveSettings({ shareDir: dir });
  const v = s.update({ region: 'au', clientId: 'worker.client-1', clientSecret: SENTINEL });
  assert.deepEqual(Object.keys(v).sort(), ['clientId', 'clientSecret', 'configured', 'environmentId', 'file', 'region']);
  assert.equal(v.clientSecret, 'set');
  assert.ok(!JSON.stringify(v).includes(SENTINEL));
  assert.equal(v.region, 'com.au', 'au maps to the shared file convention');
  const file = path.join(dir, 'pingone.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.other, 'keep-me');
  assert.equal(raw.clientSecret, SENTINEL);
  s.update({ clientSecret: '' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).clientSecret, SENTINEL, 'blank keeps');
  assert.equal(s.configured(), true);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')).length, 0);
});

test('settings: bad input changes nothing', () => {
  const dir = tmp('bad');
  const s = createLiveSettings({ shareDir: dir });
  s.update({ environmentId: ENV_ID, region: 'com', clientId: 'c1', clientSecret: SENTINEL });
  const before = fs.readFileSync(path.join(dir, 'pingone.json'), 'utf8');
  for (const body of [{ environmentId: 'nope' }, { region: 'mars' }, { clientId: 'a b' }, { clientSecret: 'x\u0000y' }, { clientSecret: 5 }, { environmentId: 'x'.repeat(100) }, [], null, 'x']) assert.throws(() => s.update(body), SettingsError);
  assert.equal(fs.readFileSync(path.join(dir, 'pingone.json'), 'utf8'), before);
});

// ---- client and netguard ----------------------------------------------------------------------------------------------------------
test('only the saved environment on the two PingOne hosts is reachable: every other URL is refused before any request', () => {
  const t = targetOf({ envId: ENV_ID, region: 'eu' });
  assert.deepEqual(t.hosts, ['auth.pingone.eu', 'api.pingone.eu']);
  assert.deepEqual(targetOf({ envId: ENV_ID, region: 'au' }).hosts, ['auth.pingone.com.au', 'api.pingone.com.au']);
  assert.throws(() => targetOf({ envId: ENV_ID, region: 'mars' }), LiveError);
  const good = [`https://auth.pingone.eu/${ENV_ID}/as/token`, `https://api.pingone.eu/v1/environments/${ENV_ID}/trustedIssuers`, `https://api.pingone.eu/v1/environments/${ENV_ID}/applications/x/secret`];
  for (const u of good) assert.ok(allowedUrl(t, u));
  const other = 'cccccccc-1111-4222-8333-dddddddddddd';
  const refused = [`http://auth.pingone.eu/${ENV_ID}/as/token`, `https://auth.pingone.com/${ENV_ID}/as/token`, `https://auth.pingone.eu/${other}/as/token`, `https://auth.pingone.eu/${ENV_ID}/as`, `https://auth.pingone.eu/${ENV_ID}/as/../x`, `https://user:pw@auth.pingone.eu/${ENV_ID}/as/token`,
    `https://api.pingone.eu/v1/environments/${other}/applications`, `https://api.pingone.eu/v1/organizations/x`, `https://evil.example/${ENV_ID}/as/token`, `https://auth.pingone.eu.evil.example/${ENV_ID}/as/token`, `https://api.pingone.eu:8443/v1/environments/${ENV_ID}/applications`, 'not a url', `https://auth.pingone.eu/${ENV_ID}/as//token`];
  for (const u of refused) assert.throws(() => allowedUrl(t, u), LiveError, u);
  const stub = targetOf({ envId: ENV_ID, stub: 'http://127.0.0.1:9' });
  assert.ok(allowedUrl(stub, `http://127.0.0.1:9/${ENV_ID}/as/token`));
  assert.throws(() => allowedUrl(stub, `http://127.0.0.2:9/${ENV_ID}/as/token`) && allowedUrl(stub, `https://127.0.0.1:9/${ENV_ID}/as/token`), LiveError);
  assert.throws(() => targetOf({ envId: ENV_ID, stub: 'http://evil.example:9' }), LiveError);
  assert.throws(() => targetOf({ envId: ENV_ID, stub: 'https://127.0.0.1:9' }), LiveError);
});

test('the client never follows a redirect, caps the body, times out, redacts credentials in the wire, and never sends a refused URL', async () => {
  const t = targetOf({ envId: ENV_ID, region: 'com' });
  const calls = [];
  const mk = (fetchImpl) => createLiveClient({ target: t, secrets: () => [SENTINEL], fetchImpl: async (...a) => { calls.push(a); return fetchImpl(...a); } });
  const reply = (status, body, headers = {}) => new Response(body, { status, headers });
  const redir = mk(() => reply(302, '', { location: 'https://evil.example/' }));
  await assert.rejects(redir.call({ method: 'GET', url: redir.apiUrl('applications'), auth: 'bearer' }), (e) => e.code === 'no_token');
  redir.setBearer('worker-bearer-token-value');
  await assert.rejects(redir.call({ method: 'GET', url: redir.apiUrl('applications'), auth: 'bearer' }), (e) => e.code === 'redirect_refused');
  assert.equal(calls.at(-1)[1].redirect, 'manual');
  const big = mk(() => reply(200, 'x'.repeat(LIMITS.maxBody + 10)));
  await assert.rejects(big.call({ method: 'POST', url: big.authUrl('token'), auth: 'basic', basic: { id: 'c', secret: SENTINEL }, form: { grant_type: 'client_credentials' } }), (e) => e.code === 'too_large');
  const slow = mk(() => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; });
  await assert.rejects(slow.call({ method: 'POST', url: slow.authUrl('token'), auth: 'basic', basic: { id: 'c', secret: SENTINEL }, form: {} }), (e) => e.code === 'network' && /20 s/.test(e.message));
  assert.ok(calls.every((c) => c[1].signal), 'every request carries a timeout signal');
  const n = calls.length;
  await assert.rejects(redir.call({ method: 'GET', url: 'https://evil.example/x', auth: 'bearer' }), (e) => e.code === 'refused_url');
  assert.equal(calls.length, n, 'a refused URL never reaches fetch');
  const ok = mk(() => reply(200, JSON.stringify({ access_token: 'T', echo: SENTINEL }), { 'content-type': 'application/json' }));
  const r = await ok.call({ method: 'POST', url: ok.authUrl('token'), auth: 'basic', basic: { id: 'worker', secret: SENTINEL }, form: { grant_type: 'client_credentials' } });
  const text = JSON.stringify(r.item);
  assert.ok(!text.includes(SENTINEL), 'the secret is in no wire item');
  assert.ok(!text.includes(Buffer.from(`worker:${SENTINEL}`).toString('base64')), 'nor its base64 in a header');
  assert.equal(r.item.requestHeaders.find((h) => h.name === 'Authorization').value, 'Basic <redacted: client secret is write-only>');
});

test('netguard: the allow-list is empty by default and exact; any other host stays refused and recorded', async () => {
  const g = installNetguard();
  try {
    assert.equal(networkHostAllowed('auth.pingone.eu'), false);
    assert.equal(networkHostAllowed('127.0.0.1'), true);
    allowNetworkHosts(['auth.pingone.eu']);
    assert.equal(networkHostAllowed('auth.pingone.eu'), true);
    assert.equal(networkHostAllowed('AUTH.pingone.eu'), true);
    for (const h of ['api.pingone.eu', 'pingone.eu', 'auth.pingone.eu.evil.example', 'evil.example']) assert.equal(networkHostAllowed(h), false, h);
    await assert.rejects(fetch('https://api.pingone.eu/x', { signal: AbortSignal.timeout(1500) }), /network blocked/);
    await assert.rejects(fetch('https://evil.example/', { signal: AbortSignal.timeout(1500) }), /network blocked/);
    assert.ok(g.attempts.includes('fetch:api.pingone.eu') && g.attempts.includes('fetch:evil.example'));
  } finally { allowNetworkHosts([]); g.attempts.length = 0; g.restore(); }
  assert.equal(networkHostAllowed('auth.pingone.eu'), false);
});

// ---- the stub-based end to end ----------------------------------------------------------------------------------------------------
async function liveServer(fn, { stubOpts = {}, prefill, env: extraEnv = {}, hosted = false } = {}) {
  const stub = await startStub({ envId: ENV_ID, ...stubOpts });
  const share = tmp('share'); const data = tmp('data');
  if (prefill) prefill(stub);
  const env = { MODE: 'live', P1TPX_ALLOW_LIVE: '1', P1TPX_LIVE_STUB: stub.url, DEMO_KIT_CONFIG_DIR: share, P1TPX_DATA_DIR: data, ...extraEnv };
  const captured = [];
  const realOut = process.stdout.write; const realErr = process.stderr.write;
  const tap = (orig) => function tapped(chunk, ...rest) { captured.push(String(chunk)); return orig.call(this, chunk, ...rest); };
  process.stdout.write = tap(realOut); process.stderr.write = tap(realErr);
  try {
    await withServer(async (url) => {
      const post = (p, body) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(body) });
      await fn({ url, post, stub, share, data, captured, env });
    }, { env, hosted, live: { dataDir: data } });
  } finally { process.stdout.write = realOut; process.stderr.write = realErr; await stub.close(); }
}
const configure = (post, stub) => post('/api/live/settings', { environmentId: ENV_ID, region: 'com', clientId: stub.workerId, clientSecret: stub.workerSecret });
const allFiles = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).isFile());

test('LIVE end to end against the stub: settings, typed confirm, every scenario, prediction vs live all match, cleanup leaves nothing, same wire format', async () => {
  await liveServer(async ({ url, post, stub, share, data, captured }) => {
    const status = await (await fetch(`${url}/api/live/status`)).json();
    assert.equal(status.enabled, true);
    assert.match(status.banner, /^LIVE: this writes to a real PingOne environment/);
    assert.equal(status.settings.configured, false);
    assert.equal((await post('/api/live/run', { confirm: ENV_ID })).status, 400, 'not configured');
    const saved = await (await configure(post, stub)).json();
    assert.equal(saved.settings.clientSecret, 'set');
    assert.ok(!JSON.stringify(saved).includes(stub.workerSecret));
    const info = await (await fetch(`${url}/api/info`)).json();
    assert.deepEqual([info.mode, info.live.enabled], ['live', true]);
    assert.match((await (await fetch(`${url}/api/vendors`)).json()).banner, /LIVE: this writes to a real PingOne environment/);

    assert.equal((await post('/api/live/run', {})).status, 400, 'no confirm');
    assert.equal((await post('/api/live/run', { confirm: ENV_ID.toUpperCase() })).status, 400, 'confirm must be exact');
    assert.equal((await post('/api/live/run', { confirm: ENV_ID, scenarios: ['nope'] })).status, 400);
    assert.equal(stub.state.log.length, 0, 'nothing reached PingOne before the confirm');

    const r = await post('/api/live/run', { confirm: ENV_ID });
    const text = await r.text();
    assert.equal(r.status, 200);
    const j = JSON.parse(text);
    assert.equal(j.error, null);
    assert.equal(j.scenarios.length, SCENARIOS.length);
    const bad = j.scenarios.filter((s) => !s.match);
    assert.deepEqual(bad.map((s) => `${s.id}: ${JSON.stringify(s.prediction)} vs ${JSON.stringify(s.live)}`), []);
    assert.deepEqual(j.mismatches, []);
    assert.equal(j.cleanup.ok, true);
    assert.equal(j.cleanup.thisRunClean, true);
    assert.deepEqual(stub.names(), { apps: [], resources: [], issuers: [] });
    assert.ok(!fs.existsSync(path.join(data, 'live-cleanup.json')), 'the cleanup record is removed after a clean run');
    // the measured behaviours the stub encodes
    const by = Object.fromEntries(j.scenarios.map((s) => [s.id, s]));
    assert.equal(by['no-actor'].live.summary.act, 'null-sub');
    assert.equal(by['missing-source-claim'].live.summary.security, 'absent');
    assert.equal(by['missing-source-claim'].live.status, 200);
    assert.equal(by['subject-jwt-no-actor'].live.summary.hasSub, false);
    assert.equal(by['subject-jwt-with-actor'].live.summary.ext_sub, 'p1x-subject-user');
    assert.match(by['clock-skew-limit'].live.description, /clockSkew must be less than or equal to 60/);
    assert.match(by.expired.live.description, /^The request could not be completed\. The request was malformed or invalid\.: The provided JWT has expired \(Correlation ID: /);
    assert.equal(by['clock-skew-ok'].live.status, 200);
    assert.equal(by['clock-skew-too-old'].live.status, 400);
    assert.equal(by.unassigned.live.status, 400);

    // same wire format as the mock, in full
    assert.ok(j.setup.length >= 10 && j.runtime.length >= 20 && j.cleanupWire.length >= 6);
    for (const i of j.wire) for (const f of ['n', 'id', 'key', 'label', 'phase', 'method', 'url', 'requestHeaders', 'curl', 'status', 'statusText', 'responseHeaders', 'requestText', 'responseText', 'notes', 'evidence']) assert.ok(i[f] !== undefined && i[f] !== '', `${i.id}.${f}`);
    const ex = j.wire.find((i) => i.key === 'exchange-valid');
    const params = new URLSearchParams(ex.requestBody);
    assert.equal(params.get('actor_token').split('.').length, 3, 'the full third-party token is on the wire');
    assert.equal(params.get('subject_token').split('.').length, 3);
    assert.ok(JSON.parse(ex.responseBody).access_token.split('.').length === 3, 'the full issued token too');
    assert.equal(j.wire.find((i) => i.key === 'issuer').requestHeaders.find((h) => h.name === 'Authorization').value, 'Bearer <worker token: redacted>');
    assert.match(j.wire.find((i) => i.key === 'secret').responseBody, /redacted/);
    assert.match(j.wire.find((i) => i.key === 'worker').responseBody, /<worker token: redacted>/);

    // secrets: nowhere except the 0600 settings file
    const secrets = [stub.workerSecret, ...[...stub.state.apps.values()].map((a) => a.secret)];
    for (const s of [stub.workerSecret, 'STUB-APP-SECRET-']) { assert.ok(!text.includes(s), `response has ${s.slice(0, 8)}`); assert.ok(!captured.join('').includes(s), 'logs'); }
    for (const f of allFiles(data)) assert.ok(!fs.readFileSync(f, 'utf8').includes(stub.workerSecret), f);
    const shared = path.join(share, 'pingone.json');
    assert.ok(fs.readFileSync(shared, 'utf8').includes(stub.workerSecret));
    assert.equal(fs.statSync(shared).mode & 0o777, 0o600);
    assert.ok(!(await (await fetch(`${url}/api/live/status`)).text()).includes(stub.workerSecret));
    assert.ok(secrets.length >= 1);
  });
});

test('a chosen subset of scenarios runs, a second run is clean too, and objects not named p1x-live-* are never touched', async () => {
  await liveServer(async ({ post, stub }) => {
    await configure(post, stub);
    const j = await (await post('/api/live/run', { confirm: ENV_ID, scenarios: ['valid', 'bad-signature'] })).json();
    assert.deepEqual(j.scenarios.map((s) => s.id), ['valid', 'bad-signature']);
    assert.equal(j.cleanup.ok, true);
    assert.equal(stub.names().apps.join(), 'other-app', 'a foreign object survives');
    assert.deepEqual(stub.names().resources, ['other-resource']);
    assert.deepEqual(stub.names().issuers, ['other-issuer']);
    const k = await (await post('/api/live/run', { confirm: ENV_ID, scenarios: ['valid'] })).json();
    assert.equal(k.cleanup.ok, true);
    assert.notEqual(k.runName, j.runName);
    assert.match(k.runName, /^p1x-live-[0-9a-f]{6}$/);
    const deletes = stub.state.log.filter((l) => l.startsWith('DELETE'));
    assert.ok(deletes.length >= 6);
  }, { prefill: (stub) => {
    const id = (n) => `${n}0000000-0000-4000-8000-000000000000`;
    stub.state.apps.set(id(1), { id: id(1), name: 'other-app', secret: 'x', grants: new Map(), assignments: new Map() });
    stub.state.resources.set(id(2), { id: id(2), name: 'other-resource', audience: 'a', scopes: new Map(), attributes: new Map() });
    stub.state.issuers.set(id(3), { id: id(3), name: 'other-issuer', issuer: 'https://o.example', jwks: '{}' });
  } });
});

test('a mismatch between the mock and PingOne is reported as a pasteable list with a MISMATCH badge input', async () => {
  await liveServer(async ({ post, stub }) => {
    await configure(post, stub);
    const j = await (await post('/api/live/run', { confirm: ENV_ID, scenarios: ['valid', 'nbf-required', 'expired'] })).json();
    assert.equal(j.scenarios.find((s) => s.id === 'valid').match, true);
    const nbf = j.scenarios.find((s) => s.id === 'nbf-required');
    assert.equal(nbf.match, false);
    assert.deepEqual(j.mismatches, [{ scenario: 'nbf-required', field: 'error_description', predicted: 'Missing nbf claim; the Trusted Issuer requires a not-before time', live: nbf.live.description }]);
    assert.match(nbf.live.description, /QUIRK: a different text/);
    assert.equal(j.cleanup.ok, true);
  }, { stubOpts: { quirks: { reasons: { nbfMissing: 'QUIRK: a different text' } } } });
});

test('a failure part-way still cleans up in the finally block, reports the error, and leaves nothing', async () => {
  await liveServer(async ({ post, stub, data }) => {
    await configure(post, stub);
    const j = await (await post('/api/live/run', { confirm: ENV_ID })).json();
    assert.match(j.error, /POST \/applications returned HTTP 500/);
    assert.equal(j.scenarios.length, 0);
    assert.equal(j.cleanup.ok, true);
    assert.deepEqual(stub.names(), { apps: [], resources: [], issuers: [] });
    assert.ok(!fs.existsSync(path.join(data, 'live-cleanup.json')));
  }, { stubOpts: { failOn: 'POST applications' } });
});

test('when cleanup itself fails, the created ids stay in a local cleanup file and "Clean up leftovers" removes them', async () => {
  await liveServer(async ({ post, stub, data }) => {
    await configure(post, stub);
    stub.state.failOn = 'DELETE resources';
    const j = await (await post('/api/live/run', { confirm: ENV_ID, scenarios: ['valid'] })).json();
    assert.equal(j.cleanup.ok, false);
    assert.equal(j.cleanup.thisRunClean, false);
    assert.deepEqual(stub.names().resources, [j.runName]);
    const file = path.join(data, 'live-cleanup.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(rec.runName, j.runName);
    assert.equal(rec.resources.length, 1);
    assert.equal(rec.envId, ENV_ID);
    assert.ok(!fs.readFileSync(file, 'utf8').includes(stub.workerSecret));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal((await post('/api/live/cleanup', { confirm: 'wrong' })).status, 400);
    stub.state.failOn = null;
    const c = await (await post('/api/live/cleanup', { confirm: ENV_ID })).json();
    assert.equal(c.ok, true);
    assert.ok(c.steps.some((s) => s.collection === 'resources' && s.ok));
    assert.deepEqual(stub.names(), { apps: [], resources: [], issuers: [] });
    assert.ok(!fs.existsSync(file));
    assert.ok(!JSON.stringify(c).includes(stub.workerSecret));
  });
});

test('a wrong worker secret fails cleanly, creates nothing and leaks nothing; a cross-origin write is refused', async () => {
  await liveServer(async ({ url, post, stub }) => {
    await post('/api/live/settings', { environmentId: ENV_ID, region: 'com', clientId: stub.workerId, clientSecret: 'WRONG-SECRET-VALUE-123' });
    const r = await post('/api/live/run', { confirm: ENV_ID });
    const t = await r.text();
    const j = JSON.parse(t);
    assert.match(j.error, /worker token request failed/);
    assert.ok(!t.includes('WRONG-SECRET-VALUE-123'));
    assert.deepEqual(stub.names(), { apps: [], resources: [], issuers: [] });
    const x = await fetch(`${url}/api/live/run`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ confirm: ENV_ID }) });
    assert.equal(x.status, 403);
  });
});

test('every scenario has a prediction from the same validateExchange as the Exchange tab', () => {
  const now = 1_790_000_000;
  const p = Object.fromEntries(SCENARIOS.map((s) => [s.id, predict(s, now)]));
  assert.equal(p.valid.status, 200);
  assert.match(p.expired.reason, /expired/);
  assert.match(p['untrusted-issuer'].reason, /assigned to the application$/);
  assert.match(p.unassigned.reason, /for the requesting application$/);
  assert.match(p['bad-signature'].reason, /signature/);
  assert.equal(p['clock-skew-ok'].status, 200);
  assert.equal(p['clock-skew-too-old'].status, 400);
  assert.match(p['max-future'].reason, /maximum allowed future validity/);
  assert.equal(p['no-actor'].expect.act, 'null-sub');
  assert.equal(p['missing-source-claim'].expect.security, 'absent');
  assert.equal(p['subject-jwt-no-actor'].expect.hasSub, false);
  assert.equal(p['wrong-actor-type'].reason, 'Provided token type must be urn:ietf:params:oauth:token-type:jwt');
});
