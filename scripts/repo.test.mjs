import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanHosts } from '../server/src/safety.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml', 'docs/setup.md', 'docs/talk-track.md', 'docs/safety.md', 'docs/shelf-entry.json', 'customer.config.example.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('the shelf entry is valid and portable: relative composeFile, loopback url, health path', () => {
  const e = JSON.parse(read('docs/shelf-entry.json')).demos[0];
  assert.equal(e.id, 'p1-third-party-exchange');
  assert.equal(e.kind, 'Demo');
  assert.equal(e.healthPath, '/api/health');
  assert.match(e.url, /^http:\/\/localhost:52\d\d$/);
  assert.equal(e.catalogId, 'D98', 'owner-confirmed catalog id (2026-10-27)');
  assert.ok(!path.isAbsolute(e.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!/\/Users\//.test(JSON.stringify(e)), 'no absolute home path');
});

test('customer.config.json is git-ignored, and its example only sets the four cast values', () => {
  assert.match(read('.gitignore'), /^customer\.config\.json$/m);
  assert.deepEqual(Object.keys(JSON.parse(read('customer.config.example.json')).cast).sort(), ['app', 'brand', 'host', 'resource']);
});

test('no shipped text names a real customer, company or tenant', () => {
  const skip = new Set(['node_modules', 'dist', '.git', 'package-lock.json']);
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (!['repo.test.mjs', 'data.test.js', 'content-pack.test.mjs'].some((n) => p.endsWith(n))) {
        const t = fs.readFileSync(p, 'utf8').toLowerCase();
        for (const w of ['united airlines', 'mileageplus', 'datapower', 'optum', 'unitedhealth', 'uhg', 'member benefit', 'personal-agent', 'personal agent']) if (t.includes(w)) hits.push(`${path.relative(root, p)}: ${w}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

const tracked = () => {
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n').filter((f) => f && !f.endsWith('package-lock.json') && fs.existsSync(path.join(root, f))) : [];
};

test('README declares its tier, and no copy says "door"', () => {
  assert.match(read('README.md'), /^\*\*Tier: Demo\.\*\*/m);
  for (const f of tracked().filter((x) => /\.(md|js|jsx|json|mjs|css|yaml|yml)$/.test(x) && x !== 'CLAUDE.md' && !x.endsWith('repo.test.mjs') && !x.endsWith('data.test.js') && !x.includes('/api.test.js'))) assert.ok(!/\bdoors?\b/i.test(read(f)), f);
});

test('no shipped file contains a real host (only .example, .invalid, loopback and the RFC editor) or a non-placeholder UUID', () => {
  const allowed = new Set(['www.rfc-editor.org']);
  const hits = [];
  const shipped = (x) => ['README.md', 'docs/setup.md', 'docs/talk-track.md', 'docs/shelf-entry.json', 'content-pack.json', 'customer.config.example.json', 'server/src/exchangeData.js'].includes(x) || x.startsWith('server/diagrams/') || (x.startsWith('web/src/') && /\.jsx?$/.test(x) && !/\.test\./.test(x)) || (x.startsWith('k8s/') && x.endsWith('.yaml'));
  for (const f of tracked().filter(shipped)) {
    const t = read(f);
    for (const h of scanHosts(t.replace(/https:\/\/github\.com\/ping-sandbox\/[A-Za-z0-9._-]+/g, ''))) if (!allowed.has(h) && h !== '0.0.0.0') hits.push(`${f}: ${h}`);
    for (const u of t.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) || []) if (!/^(0{8}|1{8}|2{8}|a{8}|b{8}|c{8}|d{8}|e{8})-/i.test(u)) hits.push(`${f}: uuid ${u.slice(0, 8)}`);
  }
  assert.deepEqual(hits, []);
});

// The forbidden-strings list lives outside the repo (never committed, never printed). Where it exists on this machine, no
// tracked file and no commit in this repo's history may contain any entry; only the COUNT is reported. Skipped where absent.
test('no forbidden string in any tracked file or in the git history (count only)', (t) => {
  const list = path.join(os.homedir(), '.config', 'demo-kit', 'forbidden-strings.txt');
  if (!fs.existsSync(list)) return t.skip('no forbidden-strings list on this machine');
  const files = spawnSync('grep', ['-rcF', '-f', list, ...tracked()], { cwd: root, encoding: 'utf8' });
  const inFiles = files.stdout.split('\n').filter((l) => l && !l.endsWith(':0')).length;
  const hist = spawnSync('sh', ['-c', `git log -p --all | grep -cF -f '${list}'`], { cwd: root, encoding: 'utf8' });
  assert.equal(inFiles, 0, 'files with a forbidden string');
  assert.equal(Number(hist.stdout.trim() || 0), 0, 'history hits');
});
