import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawHttp, withServer } from './helpers.js';

test('GET /api/health answers demo-health/1, ready and offline', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.equal(j.demo.id, 'p1-third-party-exchange');
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
  });
});

test('health is GET only', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`, { method: 'POST', headers: { origin: url } });
    assert.equal(r.status, 405);
  });
});

test('POST /api/reset confirms and refuses a cross-origin caller', async () => {
  await withServer(async (url) => {
    const ok = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' });
    assert.equal((await ok.json()).reset, 'ok');
    const bad = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(bad.status, 403);
  });
});

test('a non-loopback Host header is refused (DNS rebinding)', async () => {
  await withServer(async (url) => {
    const r = await rawHttp(`${url}/api/health`, { headers: { host: 'evil.example.invalid' } });
    assert.equal(r.status, 403);
  });
});

test('unknown API paths are 404 JSON', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/nope`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
  });
});

test('GET /api/info says what this build is: mock, simulated, and hosted only when asked', async () => {
  await withServer(async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/info`)).json(), { mode: 'mock', simulated: true, hosted: false });
    const j = await (await fetch(`${url}/api/vendors`)).json();
    assert.equal(j.hosted, false);
    assert.match(j.banner, /^SIMULATED/);
  });
  await withServer(async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/info`)).json(), { mode: 'mock', simulated: true, hosted: true });
    assert.match((await (await fetch(`${url}/api/vendors`)).json()).banner, /^HOSTED SIMULATION/);
  }, { hosted: true });
});

test('an oversized or malformed body gets a short JSON error, never a stack trace or a file path', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body });
    const big = await post(JSON.stringify({ pad: 'x'.repeat(9000) }));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: 'payload_too_large' });
    const bad = await post('{not json');
    assert.equal(bad.status, 400);
    const text = JSON.stringify(await bad.json());
    assert.equal(text, JSON.stringify({ error: 'bad_request' }));
    assert.ok(!/\/Users\/|node_modules|at \w+ \(/.test(text), 'no stack or path');
    assert.equal((await fetch(`${url}/api/health`)).status, 200, 'the server stays up');
  });
});

test('GET /api/vendors returns the issuers, the labels, the defaults and the filled talk track; verticals switch the cast; customer.config.json is read each request', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p1tpx-')), 'customer.config.json');
  await withServer(async (url) => {
    let j = await (await fetch(`${url}/api/vendors`)).json();
    assert.equal(j.vendors.length, 8);
    assert.ok(!/\{\{/.test(JSON.stringify(j)), 'no unfilled token');
    assert.deepEqual(Object.keys(j.evidence).sort(), ['derived', 'guide', 'sample', 'unverified']);
    assert.match(j.tokenLabel, /MOCK-ISSUED/);
    assert.deepEqual(j.defaults, { expRequired: true, iatRequired: false, nbfRequired: false, audiences: '', assigned: true });
    assert.equal(j.cast.castApp, 'orders-app');
    j = await (await fetch(`${url}/api/vendors?vertical=finance`)).json();
    assert.equal(j.cast.castApp, 'payments-app');
    j = await (await fetch(`${url}/api/vendors?vertical=__proto__`)).json();
    assert.equal(j.cast.castApp, 'orders-app', 'unknown vertical keeps the default');
    fs.writeFileSync(file, JSON.stringify({ cast: { app: 'custom-app' } }));
    j = await (await fetch(`${url}/api/vendors`)).json();
    assert.equal(j.cast.castApp, 'custom-app');
    assert.ok(j.talkTrack.some((t) => t.say.includes('custom-app')));
  }, { configFile: file });
});

const post = (url, p, body, headers = {}) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('POST /api/exchange: the default exchange succeeds, with checks, request, three tokens, mapping and MOCK jwts', async () => {
  await withServer(async (url) => {
    const j = await (await post(url, '/api/exchange', { vendorId: 'pf-cc' })).json();
    assert.equal(j.ok, true);
    assert.equal(j.checks.length, 7);
    assert.ok(j.checks.every((c) => c.ok));
    assert.match(j.request, /actor_token_type=urn:ietf:params:oauth:token-type:jwt/);
    assert.deepEqual(j.issued.act, { sub: 'cc_client' });
    assert.equal(j.issued.aud[0], 'https://api.northwind.example/address');
    assert.equal(j.subject.sub, '22222222-2222-2222-2222-222222222222');
    assert.equal(j.actor.iss, 'https://pf.vendor.example:9031');
    assert.match(j.jwtLabel, /MOCK/);
    for (const t of Object.values(j.jwts)) assert.ok(t.endsWith('.MOCK-SIGNATURE-NOT-VALID'));
    assert.equal(j.refusal, null);
    assert.equal(j.workspace, 'default');
  });
});

test('requiring nbf flips Okta (no nbf) to refused, Microsoft (has nbf) stays accepted, and the refusal names the check', async () => {
  await withServer(async (url) => {
    const run = async (vendorId, settings) => (await post(url, '/api/exchange', { vendorId, settings })).json();
    const okta = await run('okta', { nbfRequired: true });
    assert.equal(okta.ok, false);
    assert.equal(okta.failed.id, 'nbf');
    assert.equal(okta.issued, null);
    assert.equal(okta.refusal.status, 400);
    assert.match(okta.refusal.body.error_description, /^MOCK: /);
    assert.equal((await run('ms1', { nbfRequired: true })).ok, true);
    assert.equal((await run('ms2', { nbfRequired: true })).ok, true);
    for (const id of ['pf-cc', 'pf-oidc', 'p1', 'auth0', 'rfc9068']) assert.equal((await run(id, { nbfRequired: true })).failed.id, 'nbf', id);
    assert.equal((await run('pf-cc', { iatRequired: true })).failed.id, 'iat');
    assert.equal((await run('okta', { iatRequired: true })).ok, true);
  });
});

test('token states, assignment and audiences each refuse on their own check', async () => {
  await withServer(async (url) => {
    const run = async (body) => (await post(url, '/api/exchange', body)).json();
    assert.equal((await run({ vendorId: 'okta', tokenState: 'expired' })).failed.id, 'exp');
    assert.equal((await run({ vendorId: 'okta', tokenState: 'wrong-issuer' })).failed.id, 'issuer');
    assert.equal((await run({ vendorId: 'okta', tokenState: 'bad-signature' })).failed.id, 'signature');
    assert.equal((await run({ vendorId: 'okta', assigned: false })).failed.id, 'assigned');
    assert.equal((await run({ vendorId: 'okta', settings: { audiences: 'nope, other' } })).failed.id, 'aud');
    assert.equal((await run({ vendorId: 'okta', settings: { audiences: 'nope, https://api.okta-sample.example' } })).ok, true);
    // an absent source claim adds nothing: pf-oidc maps securityLevel, which is present, so security arrives
    assert.equal((await run({ vendorId: 'pf-oidc' })).issued.security, 'Class 3');
  });
});

test('POST /api/exchange bounds hostile input and stays up', async () => {
  await withServer(async (url) => {
    const run = (text) => post(url, '/api/exchange', text);
    let deep = {}; let cur = deep;
    for (let i = 0; i < 1000; i++) { cur.a = {}; cur = cur.a; }
    const cases = [
      [{ vendorId: 'okta', settings: deep }, 'too_deep'],
      [{ vendorId: 'okta', settings: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`k${i}`, 1])) }, 'too_many'],
      [{ vendorId: 'okta', settings: { audiences: 'x'.repeat(600) } }, 'too_long'],
      [{ vendorId: 'okta', settings: { audiences: Array.from({ length: 9 }, (_, i) => `a${i}`).join(',') } }, 'too_many'],
      [JSON.parse('{"vendorId":"okta","__proto__":{"x":1}}'), 'forbidden_key'],
      [JSON.parse('{"vendorId":"okta","settings":{"constructor":{"prototype":{"x":1}}}}'), 'forbidden_key'],
      [{ vendorId: 'okta', extra: 1 }, 'unknown_field'],
      [{ vendorId: 'okta', settings: { evil: true } }, 'unknown_field'],
      [{ vendorId: 'nope' }, 'unknown_vendor'],
      [{ vendorId: '__proto__' }, 'unknown_vendor'],
      [{ vendorId: { toString: 1 } }, 'unknown_vendor'],
      [{}, 'unknown_vendor'],
      [{ vendorId: 'okta', tokenState: 'x' }, 'unknown_state'],
      [{ vendorId: 'okta', tokenState: ['valid'] }, 'unknown_state'],
      [{ vendorId: 'okta', settings: { nbfRequired: 'yes' } }, 'bad_setting'],
      [{ vendorId: 'okta', settings: { audiences: 5 } }, 'bad_setting'],
      [{ vendorId: 'okta', settings: [] }, 'bad_setting'],
      [{ vendorId: 'okta', assigned: 1 }, 'bad_setting'],
    ];
    for (const [body, code] of cases) {
      const r = await run(JSON.stringify(body));
      assert.equal(r.status, 400, code);
      assert.equal((await r.json()).error, code, code);
    }
    for (const t of ['[]', 'null', '"x"', '5']) assert.equal((await run(t)).status, 400, t);
    assert.equal((await run(JSON.stringify({ vendorId: 'okta', pad: 'x'.repeat(9000) }))).status, 413);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  });
});

test('audiences with control characters are stored as plain text, never as markup the server interprets', async () => {
  await withServer(async (url) => {
    const j = await (await post(url, '/api/exchange', { vendorId: 'okta', settings: { audiences: '<img src=x onerror=1>\u0000\u202e' } })).json();
    assert.equal(j.failed.id, 'aud');
    assert.ok(!/[\u0000\u202e]/.test(JSON.stringify(j.settings)));
  });
});

test('exchanges are kept per workspace and Reset clears only that workspace', async () => {
  await withServer(async (url) => {
    await post(url, '/api/exchange', { vendorId: 'okta' }, { 'x-workspace': 'alice' });
    await post(url, '/api/exchange', { vendorId: 'ms1', tokenState: 'expired' }, { 'x-workspace': 'bob' });
    const runs = async (ws) => (await (await fetch(`${url}/api/runs`, { headers: { 'x-workspace': ws } })).json()).runs;
    assert.deepEqual((await runs('alice')).map((r) => r.ok), [true]);
    await post(url, '/api/reset', {}, { 'x-workspace': 'alice' });
    assert.deepEqual(await runs('alice'), []);
    assert.deepEqual((await runs('bob')).map((r) => r.failed), ['exp']);
    assert.equal((await post(url, '/api/exchange', { vendorId: 'okta' }, { 'x-workspace': 'Bad Id!' })).status, 400);
  });
});

test('GET /api/compare serves the comparison sheet, labelled SAMPLE', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/compare`)).json();
    assert.equal(j.columns.length, 7);
    assert.ok(j.rows.every((r) => r.length === 8));
    assert.equal(j.evidence.label, 'SAMPLE');
  });
});

test('GET /api/setup serves the guide markdown, the steps, the admin facts and what is not shown', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/setup`)).json();
    assert.match(j.markdown, /^# PingOne token exchange with third-party signed JWTs/);
    assert.equal(j.steps.length, 4);
    assert.equal(j.adminFacts.length, 5);
    assert.equal(j.notShown.length, 4);
    assert.ok(j.notShown.some((t) => /SUBJECT token/.test(t)));
  });
});

test('GET /api/diagram serves a diagram-studio/1 document for the run: accepted and refused, with a payload on every step', async () => {
  await withServer(async (url) => {
    const get = async (qs) => { const r = await fetch(`${url}/api/diagram${qs}`); assert.equal(r.headers.get('cache-control'), 'no-store'); return r.json(); };
    const ok = await get('?vendorId=okta');
    assert.equal(ok.schema, 'diagram-studio/1');
    assert.equal(ok.id, 'exchange-success');
    assert.equal(ok.steps.length, 9);
    assert.ok(ok.steps.every((s) => s.why && s.why.length > 0), 'payload per step');
    assert.ok(ok.nodes.some((n) => n.label === 'Okta'));
    assert.ok(JSON.stringify(ok).includes('orders-app'));
    const bad = await get('?vendorId=okta&nbfRequired=true');
    assert.equal(bad.id, 'exchange-refused');
    assert.equal(bad.steps.length, 7);
    assert.match(bad.steps[6].title, /nbf present and reached/);
    assert.match(bad.steps[6].why, /MOCK: nbf present and reached/);
    for (const q of ['?vendorId=nope', '?vendorId=okta&nbfRequired=maybe', '?vendorId=okta&x=1', '?vendorId[a]=1', '']) assert.equal((await fetch(`${url}/api/diagram${q}`)).status, 400, q);
    assert.ok(!/\{\{/.test(JSON.stringify(ok) + JSON.stringify(bad)));
  });
});
