// Rule 19: the Mock/Real toggle. Real is the owner-run live machinery behind its launch-time gate
// (MODE=live, P1TPX_ALLOW_LIVE=1, loopback-only, not hosted): the runtime switch never widens the gate.
// Without the gate: Mock keeps (200), Real is refused (409 with the gate's reasons), malformed bodies 400.
// In the hosted build every switch is refused (403).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';

// The netguard is installed by src/index.js at runtime; live.test.js manages its own guard where needed.

const mode = (base, body, raw) => fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: raw ?? JSON.stringify(body) });

test('GET /api/info carries the rule 19 fields; a plain mock build has realAvailable false', async () => {
  await withServer(async (base) => {
    const j = await (await fetch(`${base}/api/info`)).json();
    assert.equal(j.source, 'mock'); assert.equal(j.realAvailable, false); assert.equal(j.mode, 'mock');
  });
});

test('POST /api/mode keeps Mock and refuses Real with the gate reasons (409) when the launch gate did not pass', async () => {
  await withServer(async (base) => {
    const keep = await mode(base, { source: 'mock' });
    assert.equal(keep.status, 200);
    assert.equal((await keep.json()).source, 'mock');
    const real = await mode(base, { source: 'real' });
    assert.equal(real.status, 409);
    const body = await real.json();
    assert.match(body.message, /gated off/);
    assert.match(body.message, /MODE is not live/);
    assert.equal((await (await fetch(`${base}/api/info`)).json()).source, 'mock');
  });
});

test('POST /api/mode rejects malformed bodies with 400', async () => {
  await withServer(async (base) => {
    for (const body of [{}, { source: 'live' }, { source: 'mock', extra: 1 }, []]) {
      assert.equal((await mode(base, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await mode(base, null, '"mock"')).status, 400);
  });
});

test('the toggle really switches: with the gate passed at launch, Mock and Real both answer 200 and /api/info follows', async () => {
  await withServer(async (base) => {
    const j0 = await (await fetch(`${base}/api/info`)).json();
    assert.deepEqual([j0.source, j0.realAvailable, j0.mode], ['real', true, 'live']);
    const toMock = await mode(base, { source: 'mock' });
    assert.equal(toMock.status, 200);
    assert.equal((await toMock.json()).source, 'mock');
    assert.equal((await (await fetch(`${base}/api/info`)).json()).source, 'mock');
    const back = await mode(base, { source: 'real' });
    assert.equal(back.status, 200);
    assert.equal((await back.json()).source, 'real');
  }, { env: { MODE: 'live', P1TPX_ALLOW_LIVE: '1' } });
});

test('the hosted build refuses every switch (403) and reports itself', async () => {
  await withServer(async (base) => {
    const j = await (await fetch(`${base}/api/info`)).json();
    assert.equal(j.hosted, true); assert.equal(j.realAvailable, false); assert.equal(j.source, 'mock');
    assert.equal((await mode(base, { source: 'real' })).status, 403);
    assert.equal((await mode(base, { source: 'mock' })).status, 403);
  }, { env: { MODE: 'live', P1TPX_ALLOW_LIVE: '1' }, hosted: true });
});
