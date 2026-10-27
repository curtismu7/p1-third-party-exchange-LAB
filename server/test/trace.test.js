import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHops, formatTraceparent, newTrace, parseTraceparent } from '../src/trace.js';
import { DEFAULT_CAST } from '../src/cast.js';
import { normalizeInput, runExchange } from '../src/exchange.js';
import { withServer } from './helpers.js';

const GOOD = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

test('parseTraceparent accepts the W3C shape and refuses everything else', () => {
  assert.deepEqual(parseTraceparent(GOOD), { traceId: '0af7651916cd43dd8448eb211c80319c', parentId: 'b7ad6b7169203331', flags: '01' });
  for (const bad of [undefined, '', 'x', GOOD.toUpperCase(), `00-${'0'.repeat(32)}-b7ad6b7169203331-01`, `00-0af7651916cd43dd8448eb211c80319c-${'0'.repeat(16)}-01`, `${GOOD}-extra`, 5]) assert.equal(parseTraceparent(bad), null);
});

const NOW = 1_790_000_000;
const runOf = (body) => runExchange(normalizeInput(body), { now: NOW, cast: DEFAULT_CAST });

test('one trace id, a distinct valid span id per hop, mock text carries the traceparent', () => {
  const trace = newTrace(GOOD);
  assert.equal(trace.traceId, '0af7651916cd43dd8448eb211c80319c');
  const ok = buildHops({ trace, run: runOf({ vendorId: 'okta' }) });
  assert.equal(ok.length, 4);
  assert.equal(new Set(ok.map((h) => h.traceparent)).size, 4);
  for (const h of ok) { assert.ok(parseTraceparent(h.traceparent)); assert.ok(h.request.includes(h.traceparent)); assert.ok(h.traceparent.includes(trace.traceId)); }
  assert.match(ok[1].response, /200/);
  const refused = buildHops({ trace: newTrace(GOOD), run: runOf({ vendorId: 'okta', settings: { nbfRequired: true } }) });
  assert.equal(refused.length, 3, 'no mapping hop when refused');
  assert.match(refused[1].response, /HTTP 400 \(MOCK, UNVERIFIED\)/);
  assert.equal(formatTraceparent('a'.repeat(32), 'b'.repeat(16)), `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
});

test('POST /api/exchange returns hops, a traceparent header, and continues a valid incoming trace', async () => {
  await withServer(async (url) => {
    const post = (headers = {}) => fetch(`${url}/api/exchange`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify({ vendorId: 'okta' }) });
    let r = await post();
    let j = await r.json();
    assert.ok(parseTraceparent(r.headers.get('traceparent')));
    assert.equal(j.hops.length, 4);
    assert.match(j.traceId, /^[0-9a-f]{32}$/);
    r = await post({ traceparent: GOOD });
    j = await r.json();
    assert.equal(j.traceId, '0af7651916cd43dd8448eb211c80319c');
    r = await post({ traceparent: 'garbage' });
    assert.notEqual((await r.json()).traceId, '0af7651916cd43dd8448eb211c80319c');
  });
});
