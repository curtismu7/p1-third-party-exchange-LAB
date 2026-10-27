// Live settings: environment id, region, worker client id and worker client secret. The PingOne identity is shared by every demo app, so it
// lives in the shared per-user file <dir>/pingone.json (mode 600, merge-written: other keys are never dropped). DEMO_KIT_CONFIG_DIR
// overrides the directory (tests use it so they never touch the real file). The secret is write-only: no API, log, wire item or diagram
// ever carries it; the public view only says "set".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENV_ID_RE, regionTld } from './regions.js';

export const defaultShareDir = (env = process.env) => env.DEMO_KIT_CONFIG_DIR || path.join(os.homedir(), '.config', 'demo-kit');
const readJson = (file) => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const CTRL = /[\u0000-\u001f\u007f-\u009f]/;

export class SettingsError extends Error {}

export function createLiveSettings({ shareDir = defaultShareDir() } = {}) {
  const file = path.join(shareDir, 'pingone.json');
  const load = () => { const s = readJson(file); return { environmentId: s.environmentId || '', region: s.region || 'com', clientId: s.clientId || '', clientSecret: s.clientSecret || '' }; };
  const configured = (s = load()) => Boolean(ENV_ID_RE.test(s.environmentId) && regionTld(s.region) && s.clientId && s.clientSecret);
  return {
    file,
    get: load,
    configured: () => configured(),
    secret: () => load().clientSecret,
    publicView() {
      const s = load();
      return { environmentId: s.environmentId, region: s.region, clientId: s.clientId, clientSecret: s.clientSecret ? 'set' : '', configured: configured(s), file };
    },
    // A blank clientSecret keeps the stored one (the form never has it to send back). Every check runs before anything is written.
    update(body) {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new SettingsError('settings must be an object');
      const next = {};
      const text = (k, max) => { const v = body[k]; if (v === undefined) return undefined; if (typeof v !== 'string' || v.length > max || CTRL.test(v)) throw new SettingsError(`${k} must be plain text of at most ${max} characters`); return v.trim(); };
      const env = text('environmentId', 64); const region = text('region', 12); const clientId = text('clientId', 128); const secret = text('clientSecret', 512);
      if (env !== undefined && env !== '') { if (!ENV_ID_RE.test(env)) throw new SettingsError('environmentId must be the PingOne environment UUID'); next.environmentId = env.toLowerCase(); }
      if (region !== undefined && region !== '') { if (!regionTld(region)) throw new SettingsError('region must be one of com, eu, asia, ca, au, sg'); next.region = region === 'au' ? 'com.au' : region; }
      if (clientId !== undefined && clientId !== '') { if (!/^[\w.-]{1,128}$/.test(clientId)) throw new SettingsError('clientId may hold letters, digits, dot, dash and underscore'); next.clientId = clientId; }
      if (secret !== undefined && secret !== '') next.clientSecret = secret;
      const merged = { ...readJson(file), ...next };
      fs.mkdirSync(shareDir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(merged), { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, file);
      return this.publicView();
    },
  };
}
