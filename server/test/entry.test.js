import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// index.js starts the server at import time, so it cannot be imported in a test. Pin its order instead: the network guard
// is installed before the env file is read, the doctor runs, or any server starts.
test('the entry installs the netguard first, before it can open any socket', () => {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const m = /^installNetguard\(\);/m.exec(src); // a real statement at the start of a line, not inside a comment
  assert.ok(m, 'installNetguard() is called as a statement');
  const guard = m.index;
  for (const later of ['runChecks()', 'startHttpServer({', 'loadEnvFile(']) assert.ok(src.indexOf(later) > guard, `${later} comes after the guard`);
  assert.ok(src.indexOf("import { installNetguard }") < guard);
});

test('the server REFUSES TO START when live mode is requested but not allowed: the hosted/mock image (container bind) can never run live', () => {
  const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
  const run = (env) => spawnSync(process.execPath, [entry], { env: { PATH: process.env.PATH, PORT: '5239', ...env }, encoding: 'utf8', timeout: 20000 });
  for (const env of [{ MODE: 'live', P1TPX_ALLOW_LIVE: '1', P1TPX_BIND: '0.0.0.0' }, { MODE: 'live', P1TPX_ALLOW_LIVE: '1', P1TPX_HOSTED: '1' }, { MODE: 'live', P1TPX_BIND: '0.0.0.0' }, { MODE: 'live' }]) {
    const r = run(env);
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.match(r.stderr, /refusing to start: live: MODE=live was requested but is refused/);
  }
});
