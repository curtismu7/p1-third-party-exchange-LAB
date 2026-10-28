#!/usr/bin/env node
// Mints a fresh PingFederate client-credentials token and writes it into the gitignored local prefill as the actor token.
// Reads .data/pf-actor.json ({ tokenUrl, clientId, clientSecret, scope }); the secret is never printed. Local use only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.data');
const cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'pf-actor.json'), 'utf8'));
const res = await fetch(cfg.tokenUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}` },
  body: new URLSearchParams({ grant_type: 'client_credentials', scope: cfg.scope || 'openid' }),
});
const j = await res.json().catch(() => ({}));
if (!res.ok || !j.access_token) { console.error(`PingFederate refused: HTTP ${res.status} ${j.error || ''}`); process.exit(1); }
const file = path.join(DATA, 'real-prefill.json');
let pre = {}; try { pre = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
fs.writeFileSync(file, `${JSON.stringify({ ...pre, actorToken: j.access_token, actorType: 'urn:ietf:params:oauth:token-type:jwt' }, null, 2)}\n`);
const c = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url'));
console.log(`actor token written to .data/real-prefill.json; iss=${c.iss} expires in ${c.exp - Math.floor(Date.now() / 1000)}s`);
