// /api/live/*: owner-run LIVE mode. Every route answers 403 {error:'live_disabled', reasons} unless the whole gate passes (gate.js).
// Same-origin writes and the loopback Host check already apply to the whole app. Secrets are write-only: the settings view says "set" and
// every response is scrubbed of the worker secret, the throwaway app secret and the worker bearer before it leaves this file.
import path from 'node:path';
import express from 'express';
import { allowNetworkHosts } from '../netguard.js';
import { createLiveClient, targetOf, LiveError } from './client.js';
import { liveGate } from './gate.js';
import { SettingsError, createLiveSettings, defaultShareDir } from './settings.js';
import { SCENARIOS, cleanupLeftovers, runLive } from './run.js';
import { isLoopbackHost } from '../safety.js';
import { InputError, checkIssuer, parseExchangeInput, realExchange } from './realExchange.js';
import { UrlRefused } from './ssrf.js';

export const LIVE_BANNER = 'LIVE: this writes to a real PingOne environment (it creates throwaway p1x-live-* objects, uses them, and deletes them again). It is NOT a simulation.';

export function createLiveRouter({ env = process.env, hosted = false, settings = createLiveSettings({ shareDir: defaultShareDir(env) }), dataDir, fetchImpl, now } = {}) {
  const router = express.Router();
  const gate = () => liveGate(env, { hosted });
  let running = false;
  const dir = dataDir || env.P1TPX_DATA_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../.data');

  router.use((_req, res, next) => {
    const g = gate();
    if (!g.allowed) return res.status(403).json({ error: 'live_disabled', reasons: g.reasons });
    return next();
  });

  // The target is the saved environment, or (tests and browser proofs only) a loopback stub named by P1TPX_LIVE_STUB.
  function targetFor(s) {
    const stub = env.P1TPX_LIVE_STUB;
    if (stub) { if (!isLoopbackHost(new URL(stub).hostname)) throw new LiveError('bad_target', 'P1TPX_LIVE_STUB must be loopback'); return targetOf({ envId: s.environmentId, stub }); }
    return targetOf({ envId: s.environmentId, region: s.region });
  }

  const scrubber = (secrets) => (value) => {
    let text = JSON.stringify(value);
    for (const s of secrets) if (s && s.length >= 8) text = text.split(JSON.stringify(s).slice(1, -1)).join('<redacted>');
    return text;
  };

  router.get('/status', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: true, banner: LIVE_BANNER, settings: settings.publicView(), scenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title })), stub: Boolean(env.P1TPX_LIVE_STUB) });
  });

  router.post('/settings', (req, res) => {
    try { res.set('Cache-Control', 'no-store'); res.json({ settings: settings.update(req.body) }); } catch (e) {
      if (e instanceof SettingsError) return res.status(400).json({ error: 'bad_settings', detail: e.message });
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  async function withClient(req, res, fn) {
    const s = settings.get();
    if (!settings.configured()) return res.status(400).json({ error: 'not_configured', detail: 'save the environment id, region, worker client id and worker client secret first' });
    if (!req.body || typeof req.body.confirm !== 'string' || req.body.confirm !== s.environmentId) return res.status(400).json({ error: 'confirm_mismatch', detail: 'type the exact environment id to confirm' });
    if (running) return res.status(409).json({ error: 'busy', detail: 'a live run is already in progress' });
    running = true;
    const secrets = [s.clientSecret];
    try {
      const target = targetFor(s);
      allowNetworkHosts(target.hosts);
      const client = createLiveClient({ target, secrets: () => secrets, fetchImpl, now });
      const out = await fn({ client, secrets, s });
      res.set('Cache-Control', 'no-store').type('application/json').send(scrubber(secrets)(out));
    } catch (e) {
      const msg = e instanceof LiveError ? e.message : 'the live run failed';
      res.status(502).type('application/json').send(scrubber(secrets)({ error: e instanceof LiveError ? e.code : 'live_failed', detail: msg }));
    } finally { allowNetworkHosts([]); running = false; }
    return undefined;
  }

  router.post('/run', (req, res) => {
    const ids = req.body && req.body.scenarios;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 40 || ids.some((i) => typeof i !== 'string' || !SCENARIOS.some((s) => s.id === i)))) return res.status(400).json({ error: 'bad_scenarios' });
    return withClient(req, res, async ({ client, secrets, s }) => {
      client.setPhase('setup');
      const bearerTokens = secrets;
      const report = await runLive({ client, worker: { id: s.clientId, secret: s.clientSecret }, dataDir: dir, scenarioIds: ids && ids.length ? ids : undefined, secrets: bearerTokens });
      return { ...report, banner: LIVE_BANNER, setup: report.wire.filter((i) => i.phase === 'setup'), runtime: report.wire.filter((i) => i.phase === 'runtime'), cleanupWire: report.wire.filter((i) => i.phase === 'cleanup') };
    });
  });

  router.post('/cleanup', (req, res) => withClient(req, res, async ({ client, secrets, s }) => {
    const tok = await client.call({ method: 'POST', url: client.authUrl('token'), auth: 'basic', basic: { id: s.clientId, secret: s.clientSecret }, form: { grant_type: 'client_credentials' }, key: 'worker', label: 'Worker token for the management API (client credentials)', redactResponse: (t) => t.replace(/("access_token"\s*:\s*")[^"]+/, '$1<worker token: redacted>') });
    if (tok.status !== 200 || !tok.json || !tok.json.access_token) return { error: 'worker_token_failed', detail: `HTTP ${tok.status}`, wire: client.items() };
    client.setBearer(tok.json.access_token); secrets.push(tok.json.access_token);
    client.setPhase('cleanup');
    const report = await cleanupLeftovers(client);
    if (report.ok) { try { (await import('node:fs')).rmSync(path.join(dir, 'live-cleanup.json')); } catch { /* none */ } }
    return { ...report, wire: client.items() };
  }));

  // "Real exchange (local)": exactly ONE real RFC 8693 request to the saved environment. Creates and deletes nothing. The app secret and
  // the optional third-party secret live in memory for this request only.
  router.post('/real/exchange', (req, res) => {
    let input;
    try { input = parseExchangeInput(req.body); } catch (e) { return res.status(400).json({ error: 'bad_input', detail: e.message }); }
    return withClient(req, res, async ({ client, secrets }) => {
      try { return await realExchange({ client, input, stub: Boolean(env.P1TPX_LIVE_STUB), secrets, nowFn: now || (() => Math.floor(Date.now() / 1000)), fetchImpl }); } catch (e) {
        if (e instanceof UrlRefused || e instanceof InputError) return { error: e.code, detail: e.message, wire: client.items() };
        throw e;
      }
    });
  });

  // "Check issuer metadata": public GETs of <iss>/.well-known/openid-configuration and its jwks_uri, through the SSRF guard.
  router.post('/real/issuer-check', async (req, res) => {
    const b = req.body || {};
    try {
      const report = await checkIssuer({ iss: b.iss, kid: typeof b.kid === 'string' ? b.kid : undefined, x5t: typeof b.x5t === 'string' ? b.x5t : undefined, jwksUrl: typeof b.jwksUrl === 'string' && b.jwksUrl ? b.jwksUrl : undefined, stub: Boolean(env.P1TPX_LIVE_STUB), nowFn: now || (() => Math.floor(Date.now() / 1000)), fetchImpl });
      res.set('Cache-Control', 'no-store').json(report);
    } catch (e) {
      if (e instanceof UrlRefused || e instanceof InputError) return res.status(400).json({ error: e.code, detail: e.message });
      return res.status(502).json({ error: 'check_failed', detail: e instanceof LiveError ? e.message : 'the check failed' });
    }
    return undefined;
  });

  return router;
}
