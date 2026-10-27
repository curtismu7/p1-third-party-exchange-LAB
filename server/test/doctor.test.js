import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { allPassed, runChecks } from '../src/doctor.js';
import { DEFAULT_CAST } from '../src/cast.js';

test('every doctor check passes on a clean default environment', async () => {
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  for (const id of ['node', 'bind', 'port-range', 'exchanges', 'nbf-trap', 'wire', 'live', 'facts-labelled', 'story-tokens', 'verticals', 'diagrams', 'story-hosts', 'story-keys', 'netguard', 'tenant']) {
    assert.ok(checks.some((c) => c.id === id), id);
  }
});

test('a port outside 5200-5249 fails, and a wildcard bind needs the opt-in', async () => {
  assert.equal((await runChecks({ env: { PORT: '5010' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '5200', P1TPX_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('MODE other than mock or live fails the doctor, live without the other gates is refused, live is off by default, and the hosted build says so', async () => {
  assert.equal((await runChecks({ env: { MODE: 'prod' } })).find((c) => c.id === 'mode').level, 'fail');
  const off = (await runChecks({ env: {} })).find((c) => c.id === 'live');
  assert.equal(off.level, 'pass');
  assert.match(off.detail, /^live: off/);
  const refused = (await runChecks({ env: { MODE: 'live' } })).find((c) => c.id === 'live');
  assert.equal(refused.level, 'fail');
  assert.match(refused.detail, /P1TPX_ALLOW_LIVE/);
  assert.equal((await runChecks({ env: { MODE: 'live', P1TPX_ALLOW_LIVE: '1', P1TPX_HOSTED: '1' } })).find((c) => c.id === 'live').level, 'fail');
  const dir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'p1tpx-doc-'));
  const incomplete = (await runChecks({ env: { MODE: 'live', P1TPX_ALLOW_LIVE: '1', DEMO_KIT_CONFIG_DIR: dir } })).find((c) => c.id === 'live');
  assert.equal(incomplete.level, 'info', 'nothing saved yet is not a failure: the settings are entered on the Live tab');
  assert.match(incomplete.detail, /no settings saved yet/);
  fs.writeFileSync(path.join(dir, 'pingone.json'), JSON.stringify({ environmentId: 'not-a-uuid', clientId: 'c' }));
  assert.equal((await runChecks({ env: { MODE: 'live', P1TPX_ALLOW_LIVE: '1', DEMO_KIT_CONFIG_DIR: dir } })).find((c) => c.id === 'live').level, 'fail');
  const probe = ['doctor', 'probe', 'value'].join('-');
  fs.writeFileSync(path.join(dir, 'pingone.json'), JSON.stringify({ environmentId: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb', region: 'com', clientId: 'c', clientSecret: probe }));
  const full = (await runChecks({ env: { MODE: 'live', P1TPX_ALLOW_LIVE: '1', DEMO_KIT_CONFIG_DIR: dir } })).find((c) => c.id === 'live');
  assert.equal(full.level, 'pass');
  assert.ok(!full.detail.includes(probe), 'the doctor never prints the secret');
  const hosted = (await runChecks({ env: { P1TPX_HOSTED: '1' } })).find((c) => c.id === 'mode');
  assert.equal(hosted.level, 'pass');
  assert.match(hosted.detail, /hosted build/);
});


test('the doctor host scan catches a real host in the data', async () => {
  const bad = { ...DEFAULT_CAST, castBrand: 'Acme https://acme-airlines.com/x' };
  const hosts = (await runChecks({ env: {}, cast: bad })).find((c) => c.id === 'story-hosts');
  assert.equal(hosts.level, 'fail');
  assert.match(hosts.detail, /acme-airlines\.com/);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'story-hosts').level, 'pass');
});
