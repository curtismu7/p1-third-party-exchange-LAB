import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedFrom, modeFrom } from '../src/config.js';

test('MODE defaults to mock, live is only a request (the live gate decides), anything else is refused, never a silent fallback', () => {
  assert.equal(modeFrom({}), 'mock');
  assert.equal(modeFrom({ MODE: 'mock' }), 'mock');
  assert.equal(modeFrom({ MODE: 'live' }), 'live');
  for (const MODE of ['prod', 'Mock', 'LIVE', 'x']) assert.throws(() => modeFrom({ MODE }), /not available/, MODE);
});

test('hosted is only the exact string 1', () => {
  assert.equal(hostedFrom({}), false);
  assert.equal(hostedFrom({ P1TPX_HOSTED: '1' }), true);
  for (const v of ['true', '0', 'yes', '']) assert.equal(hostedFrom({ P1TPX_HOSTED: v }), false, v);
});
