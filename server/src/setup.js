// The setup guide: docs/setup.md is the single text, served as data and rendered by the web app without any raw HTML.
import fs from 'node:fs';
import { fillDeep } from './cast.js';
import { ADMIN_FACTS, API_SAMPLES, EVIDENCE, NOT_SHOWN, STEPS } from './exchangeData.js';

export const SETUP_FILE = new URL('../../docs/setup.md', import.meta.url);
export const readSetupMarkdown = () => fs.readFileSync(SETUP_FILE, 'utf8');

export function buildSetup(cast) {
  return fillDeep({ markdown: readSetupMarkdown(), steps: STEPS, adminFacts: ADMIN_FACTS, apiSamples: API_SAMPLES, notShown: NOT_SHOWN, evidence: EVIDENCE }, cast);
}
