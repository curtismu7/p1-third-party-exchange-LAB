// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { DEFAULT_CAST, VERTICALS, fillDeep, unfilled } from './cast.js';
import * as D from './exchangeData.js';
import { normalizeInput, runExchange } from './exchange.js';
import { modeFrom } from './config.js';
import { DIAGRAM_NAMES, DYNAMIC_KEYS, buildDiagram, rawDiagram } from './diagramData.js';
import { readSetupMarkdown } from './setup.js';
import { verifyJwt } from './jwt.js';

// The data and token checks sign a lot of RSA tokens, so they run once per process and cast (the health endpoint refreshes every minute).
const heavyCache = new Map();
function heavyChecks(cast) {
  const key = JSON.stringify(cast);
  if (!heavyCache.has(key)) heavyCache.set(key, computeHeavy(cast));
  return heavyCache.get(key);
}

function computeHeavy(cast) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });
  const NOW = 1_790_000_000;
  const input = (vendorId, extra = {}) => normalizeInput({ vendorId, ...extra });
  const brokenVendors = D.VENDORS.filter((v) => !runExchange(input(v.id), { now: NOW, cast }).ok).map((v) => v.id);
  add('exchanges', D.VENDORS.length >= 7 && !brokenVendors.length ? 'pass' : 'fail', brokenVendors.length ? `issuers whose default exchange is refused: ${brokenVendors.join(', ')}` : `${D.VENDORS.length} issuers each succeed with the guide defaults`);
  const nbf = runExchange(input('okta', { settings: { nbfRequired: true } }), { now: NOW, cast });
  add('nbf-trap', !nbf.ok && nbf.failed.id === 'nbf' ? 'pass' : 'fail', 'Okta is refused on nbf when nbf is required');
  const sample0 = runExchange(input('okta'), { now: NOW, cast });
  const bad0 = runExchange(input('okta', { tokenState: 'bad-signature' }), { now: NOW, cast });
  const wireOk = sample0.wire.length === 3 && sample0.setup.length >= 9 && sample0.signature.ok && !bad0.signature.ok && verifyJwt(sample0.jwts.actor, JSON.parse(sample0.jwks)).ok;
  add('wire', wireOk ? 'pass' : 'fail', wireOk ? `${sample0.setup.length} setup and ${sample0.wire.length} runtime calls in full; real RS256 tokens: valid verifies, bad signature fails` : 'the wire or the RS256 signature check is broken');
  const unlabelled = D.VENDORS.filter((v) => !D.EVIDENCE[v.evidence] || v.mappings.some((m) => !D.EVIDENCE[m.evidence])).map((v) => v.id);
  add('facts-labelled', unlabelled.length ? 'fail' : 'pass', unlabelled.length ? `issuers with no evidence label: ${unlabelled.join(', ')}` : 'every issuer and mapping carries a MEASURED, GUIDE, SAMPLE, OUR CHOICE or UNVERIFIED label');

  const data = { ...D, VENDORS: D.VENDORS.map((v) => ({ ...v, claims: undefined })), TITLE: D.TITLE };
  const text = JSON.stringify([data, D.TALK_TRACK, DIAGRAM_NAMES.map(rawDiagram), readSetupMarkdown()]);
  const holes = unfilled(text, { ...DEFAULT_CAST, ...Object.fromEntries(DYNAMIC_KEYS.map((k) => [k, ''])) });
  add('story-tokens', holes.length ? 'fail' : 'pass', holes.length ? `unfilled {{tokens}}: ${[...new Set(holes)].join(', ')}` : 'every {{cast}} token is filled');
  const badVert = Object.entries(VERTICALS).filter(([, v]) => unfilled(text, { ...v, ...Object.fromEntries(DYNAMIC_KEYS.map((k) => [k, ''])) }).length).map(([k]) => k);
  add('verticals', badVert.length ? 'fail' : 'pass', badVert.length ? `verticals missing a token: ${badVert.join(', ')}` : `${Object.keys(VERTICALS).length} vertical packs fill every token`);

  const sample = D.VENDORS.flatMap((v) => [runExchange(input(v.id), { now: NOW, cast }), runExchange(input(v.id, { tokenState: 'expired' }), { now: NOW, cast })]);
  const filled = JSON.stringify([fillDeep({ ...data, TALK_TRACK: D.TALK_TRACK }, cast), sample, readSetupMarkdown()]);
  const hosts = scanHosts(filled);
  add('story-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts: ${hosts.join(', ')}` : 'every host in the data and mock tokens is .invalid or .example');
  const keys = scanKeys(filled);
  add('story-keys', keys.length ? 'fail' : 'pass', keys.length ? 'key-looking values that are not sk-MOCK-' : 'no key-looking values');
  // The diagrams are diagram-studio/1 data; diagramData validated them on import, and each filled run is validated again.
  const diagramsOk = DIAGRAM_NAMES.every((n) => rawDiagram(n).steps.length > 0) && sample.every((r) => buildDiagram(cast, r).steps.length > 0);
  add('diagrams', diagramsOk ? 'pass' : 'fail', `${DIAGRAM_NAMES.length} diagram-studio/1 diagrams load, validate and fill for every issuer, accepted and refused`);

  return checks;
}

export async function runChecks({ env = process.env, cast = DEFAULT_CAST } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20)`);

  try { add('mode', 'pass', `MODE=${modeFrom(env)} (the only mode this app has${env.P1TPX_HOSTED === '1' ? '; hosted build' : ''})`); }
  catch (e) { add('mode', 'fail', e.message); }

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.P1TPX_BIND ? ' (P1TPX_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);

  for (const h of heavyChecks(cast)) checks.push(h);

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  add('tenant', 'pass', 'mock only: no tenant, no credentials, no outbound network');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
