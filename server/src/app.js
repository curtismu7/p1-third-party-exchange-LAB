// One Express app. /api = health, vendors, exchange, compare, setup, diagram, info and reset. The only server state is each
// workspace's recent exchanges, kept per workspace id (X-Workspace) so one visitor's Reset never touches another's.
// Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom, VERTICALS } from './cast.js';
import { liveGate } from './live/gate.js';
import { LIVE_BANNER, createLiveRouter } from './live/routes.js';
import { BANNER, COMPARE_COLUMNS, COMPARE_NOTE, COMPARE_ROWS, EVIDENCE, HOSTED_BANNER, INTRO, NOT_SHOWN, STEPS, TITLE, TOKEN_STATES, TRUSTED_ISSUER_DEFAULTS, VENDORS } from './exchangeData.js';
import { ExchangeInputError, inputFromQuery, normalizeInput, runExchange } from './exchange.js';
import { buildDiagram } from './diagramData.js';
import { buildSetup } from './setup.js';
import { buildTalkTrack } from './talk.js';
import { randomBytes } from 'node:crypto';
import { buildHops, formatTraceparent, newTrace } from './trace.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');
const nowSeconds = () => Math.floor(Date.now() / 1000);

export function createApp({ health = createHealth(), configFile = CONFIG, hosted = false, workspaces = createWorkspaces(), now = nowSeconds, env = process.env, live = {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  const castFor = (req) => loadCast(configFile, verticalFrom(req.query.vertical));
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/vendors', (req, res) => {
    noStore(res);
    const cast = castFor(req);
    res.json({
      title: TITLE, intro: INTRO, banner: hosted ? HOSTED_BANNER : liveGate(env, { hosted }).allowed ? `SIMULATED except the Live tab. ${LIVE_BANNER}` : BANNER, hosted, simulated: true,
      tokenLabel: 'MOCK-ISSUED teaching tokens: decoded for education, never a real credential',
      evidence: EVIDENCE,
      vendors: VENDORS.map((v) => ({ id: v.id, name: v.name, evidence: v.evidence, issuer: v.issuer, note: v.note, mappings: v.mappings })),
      tokenStates: TOKEN_STATES, defaults: { ...TRUSTED_ISSUER_DEFAULTS, assigned: true }, steps: STEPS, notShown: NOT_SHOWN,
      talkTrack: buildTalkTrack(cast), verticals: Object.keys(VERTICALS), cast,
    });
  });
  api.get('/compare', (_req, res) => { noStore(res); res.json({ columns: COMPARE_COLUMNS, rows: COMPARE_ROWS, note: COMPARE_NOTE, evidence: EVIDENCE.sample }); });
  api.get('/setup', (req, res) => { noStore(res); res.json(buildSetup(castFor(req))); });
  api.get('/diagram', (req, res) => {
    noStore(res);
    try {
      const run = runExchange(inputFromQuery(req.query), { now: now(), cast: castFor(req) });
      return res.json(buildDiagram(castFor(req), run));
    } catch (e) {
      if (e instanceof ExchangeInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  });
  // What this build is, for the banner and for verifying a deploy by content (not by a 200).
  api.get('/info', (_req, res) => {
    noStore(res);
    const g = liveGate(env, { hosted });
    const body = { mode: g.allowed ? 'live' : 'mock', simulated: true, hosted };
    if (g.requested) body.live = { requested: true, enabled: g.allowed, reasons: g.reasons };
    res.json(body);
  });
  // Owner-run LIVE mode. Always mounted so the answer is a clear 403 with reasons; the hosted build can never pass the gate.
  api.use('/live', createLiveRouter({ env, hosted, ...live }));

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    noStore(res);
    return handler(ws, req, res);
  };
  // One mock exchange. Input is bounded in size, depth, count and value (exchange.js); unknown fields are refused.
  api.post('/exchange', withWorkspace((ws, req, res) => {
    try {
      const cast = castFor(req);
      const input = normalizeInput(req.body);
      const trace = newTrace(req.headers.traceparent);
      const traceparents = [trace.span(), trace.span(), trace.span()].map((id) => formatTraceparent(trace.traceId, id));
      const run = runExchange(input, { now: now(), cast, traceparents });
      const runId = randomBytes(8).toString('hex');
      workspaces.record(ws, { runId, vendorId: run.vendor.id, tokenState: run.tokenState, ok: run.ok, failed: run.failed ? run.failed.id : null });
      const hops = buildHops({ trace, run });
      res.set('traceparent', hops[0].traceparent);
      const body = { ...run, workspace: ws, runId, traceId: trace.traceId, hops };
      workspaces.setLast(ws, runId, { runId, setup: run.setup, wire: run.wire });
      return res.json(body);
    } catch (e) {
      if (e instanceof ExchangeInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  // The full wire (and setup calls) of this workspace's latest exchange. Same data as POST /api/exchange returned.
  api.get('/wire', withWorkspace((ws, req, res) => {
    // No runId: the latest run of this workspace. A runId the server no longer holds (a restart, another pod, Reset) is a 404 whose body
    // tells the client what to do; the web app recovers by running the exchange again.
    const given = req.query.runId;
    const id = typeof given === 'string' ? given : '';
    const found = given === undefined ? workspaces.latest(ws) : /^[0-9a-f]{16}$/.test(id) ? workspaces.last(ws, id) : null;
    return found ? res.json(found) : res.status(404).json({ error: 'run_not_found', hint: 'POST /api/exchange first' });
  }));
  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // Reset clears this workspace's exchanges only.
  api.post('/reset', withWorkspace((ws, _req, res) => { workspaces.reset(ws); res.json({ reset: 'ok', workspace: ws }); }));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Errors become short JSON. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
