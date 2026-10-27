// Runs in plain Node before the web tests: builds the data the inventory test serves from the REAL server modules, so adding an issuer,
// a fact, a limit or a call there changes what the inventory must find on the page.
import { DEFAULT_CAST, VERTICALS } from '../server/src/cast.js';
import * as D from '../server/src/exchangeData.js';
import { normalizeInput, runExchange } from '../server/src/exchange.js';
import { buildDiagram } from '../server/src/diagramData.js';
import { buildSetup } from '../server/src/setup.js';
import { buildTalkTrack } from '../server/src/talk.js';
import { buildHops, newTrace } from '../server/src/trace.js';

export default function setup({ provide }) {
  const now = Math.floor(Date.now() / 1000);
  const runs = {};
  for (const state of ['valid', 'expired']) {
    const run = runExchange(normalizeInput({ vendorId: D.VENDORS[0].id, tokenState: state }), { now, cast: DEFAULT_CAST });
    const trace = newTrace();
    runs[state] = { run: { ...run, runId: state === 'valid' ? '0123456789abcdef' : 'fedcba9876543210', traceId: trace.traceId, hops: buildHops({ trace, run }) }, diagram: buildDiagram(DEFAULT_CAST, run) };
  }
  provide('inventory', {
    D: { TITLE: D.TITLE, INTRO: D.INTRO, BANNER: D.BANNER, EVIDENCE: D.EVIDENCE, VENDORS: D.VENDORS.map((v) => ({ id: v.id, name: v.name, evidence: v.evidence, issuer: v.issuer, note: v.note, mappings: v.mappings })), TOKEN_STATES: D.TOKEN_STATES, DEFAULTS: { ...D.TRUSTED_ISSUER_DEFAULTS, assigned: true }, STEPS: D.STEPS, NOT_SHOWN: D.NOT_SHOWN, ADMIN_FACTS: D.ADMIN_FACTS, COMPARE_COLUMNS: D.COMPARE_COLUMNS, COMPARE_ROWS: D.COMPARE_ROWS, COMPARE_NOTE: D.COMPARE_NOTE, TALK_TRACK: D.TALK_TRACK },
    talk: buildTalkTrack(DEFAULT_CAST), cast: DEFAULT_CAST, verticals: Object.keys(VERTICALS), setup: buildSetup(DEFAULT_CAST), runs,
  });
}
