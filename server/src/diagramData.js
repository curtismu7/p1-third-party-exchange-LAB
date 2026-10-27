// The exchange diagrams are diagram-studio/1 DATA (server/diagrams/*.json), loaded by name and checked with the studio's own
// validator copy. Nothing here builds nodes or edges by hand. Two named diagrams: the accepted path and the refused path.
// {{tokens}} are filled from the vertical cast plus the values of one run (DYNAMIC_KEYS). Each step is one edge, walked in
// order by Simulate; the step's `why` carries the payload shown for it.
import fs from 'node:fs';
import { TOKEN_STATES } from './exchangeData.js';
import { fillDeep } from './cast.js';
import { validateDiagram } from './diagramStudioValidate.js';

const DIR = new URL('../diagrams/', import.meta.url);
export const DIAGRAM_NAMES = ['exchange-success', 'exchange-refused'];

export function loadDiagram(name) {
  const doc = JSON.parse(fs.readFileSync(new URL(`${name}.json`, DIR), 'utf8'));
  const problems = validateDiagram(doc);
  if (problems.length) throw new Error(`diagram ${name} is not valid diagram-studio/1: ${problems.join('; ')}`);
  return doc;
}
const DOCS = Object.fromEntries(DIAGRAM_NAMES.map((n) => [n, loadDiagram(n)]));
export const rawDiagram = (name) => DOCS[name];

// Tokens that come from one run rather than from the cast.
export const DYNAMIC_KEYS = ['vendorName', 'vendorIssuer', 'stateLabel', 'subjectJson', 'actorJson', 'requestText', 'checksPassed', 'mappingSummary', 'mappingJson', 'issuedJson', 'failedLabel', 'failedDetail', 'refusalJson'];

const MAX_PAYLOAD = 580;
const clip = (s) => (s.length > MAX_PAYLOAD ? `${s.slice(0, MAX_PAYLOAD - 1)}…` : s);
const json = (v) => clip(JSON.stringify(v, null, 1));

export function dynamicValues(run) {
  const state = TOKEN_STATES.find((t) => t.id === run.tokenState);
  return {
    vendorName: run.vendor.name,
    vendorIssuer: run.vendor.issuer,
    stateLabel: state ? state.label : run.tokenState,
    subjectJson: json(run.subject),
    actorJson: json(run.actor),
    requestText: clip(run.request),
    checksPassed: clip(run.checks.map((c) => `- ${c.label}`).join('\n')),
    mappingSummary: run.mapping.map((m) => (m.present ? `${m.label}.` : `${m.label}: the token has no ${m.source}, so no claim is added.`)).join(' '),
    mappingJson: json(run.mapping.map((m) => ({ mapping: m.label, sourcePresent: m.present, claim: m.claim }))),
    issuedJson: run.issued ? json(run.issued) : '(nothing issued)',
    failedLabel: run.failed ? run.failed.label : '',
    failedDetail: run.failed ? run.failed.detail : '',
    refusalJson: run.error ? json(run.error) : '',
  };
}

/** Full text of one wire reference. hop = "key", "key:req", "key:res" or "attrs" (every attribute call). Setup and runtime items both qualify. */
export function hopText(run, hop) {
  const all = [...run.setup, ...run.wire];
  const [key, part] = String(hop).split(':');
  const items = key === 'attrs' ? all.filter((i) => i.key.startsWith('attr-')) : all.filter((i) => i.key === key);
  return items.map((i) => (part === 'req' ? i.requestText : part === 'res' ? i.responseText : `${i.requestText}\n\n${i.responseText}`)).join('\n\n');
}

export function hopSummary(run, hop) {
  const [key, part] = String(hop).split(':');
  const all = [...run.setup, ...run.wire];
  const items = key === 'attrs' ? all.filter((i) => i.key.startsWith('attr-')) : all.filter((i) => i.key === key);
  const what = part === 'req' ? ' request' : part === 'res' ? ' response' : '';
  return items.map((i) => `Wire call ${i.n}${what}: ${i.method} ${i.url}${part === 'res' ? ` -> ${i.status} ${i.statusText}` : ''}. Full text: Wire tab.`).join('\n');
}

/** The diagram-studio/1 document for one run: the accepted or the refused path, with the cast and run values filled in. */
export function buildDiagram(cast, run) {
  const name = run.ok ? 'exchange-success' : 'exchange-refused';
  const doc = fillDeep(DOCS[name], { ...cast, ...dynamicValues(run) });
  // A step that points at a wire call (hop) names the call in `why` (the studio caps `why` at 600 characters, and a token must never be
  // cut), and the web shows the FULL wire text for that hop from run.wire. Nothing is truncated anywhere.
  for (const s of doc.steps) if (s.hop) { const t = hopSummary(run, s.hop); if (t) s.why = t; }
  const problems = validateDiagram(doc);
  if (problems.length) throw new Error(`diagram ${name} filled is not valid: ${problems.join('; ')}`);
  return doc;
}
