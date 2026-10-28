#!/usr/bin/env node
// Mints a fresh PingOne client-credentials access token and writes it into the gitignored local prefill as the subject
// token, with the exchanging app's id, the endpoint, and the gateway audience/scope to ask for. Reads .data/p1-app.json
// ({ tokenUrl, clientId, clientSecret, scope }); the secret is never printed and never prefilled. Local use only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.data');
const cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'p1-app.json'), 'utf8'));
const res = await fetch(cfg.tokenUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}` },
  body: new URLSearchParams({ grant_type: 'client_credentials', scope: cfg.scope }),
});
const j = await res.json().catch(() => ({}));
if (!res.ok || !j.access_token) { console.error(`PingOne refused: HTTP ${res.status} ${j.error || ''}`); process.exit(1); }
const file = path.join(DATA, 'real-prefill.json');
let pre = {}; try { pre = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
fs.writeFileSync(file, `${JSON.stringify({ ...pre, endpoint: cfg.tokenUrl, clientId: cfg.clientId, authStyle: 'basic', scope: 'p1tpx:invoke', subjectToken: j.access_token, subjectType: 'urn:ietf:params:oauth:token-type:access_token' }, null, 2)}\n`);
console.log('subject token written to .data/real-prefill.json');
