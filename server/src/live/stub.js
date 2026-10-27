// A stand-in for PingOne on loopback, for the tests and for browser proofs of live mode. It implements the endpoints the live run
// uses, with the behaviour MEASURED against a real environment on 2026-10-27 (same reason texts as exchange.js MESSAGES). It makes
// no network call. Nothing here is a real credential. `quirks.reasons` overrides a reason text so a test can force a mismatch.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { decodeJwt, signJwt, verifyJwt } from '../jwt.js';
import { KIDS, p1Key } from '../keys.js';
import { MESSAGES, P1_ERROR_PREFIX } from '../exchange.js';

const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const JWT_T = 'urn:ietf:params:oauth:token-type:jwt';
const ACCESS_T = 'urn:ietf:params:oauth:token-type:access_token';
const rid = () => `${randomBytes(4).toString('hex')}-0000-4000-8000-${randomBytes(6).toString('hex')}`;

export function startStub({ envId, workerId = 'stub-worker-client', workerSecret = 'STUB-WORKER-SECRET-VALUE', quirks = {}, failOn = null } = {}) {
  const state = { failOn, issuers: new Map(), resources: new Map(), apps: new Map(), workerTokens: new Set(), log: [], corr: 0 };
  const key = p1Key();
  const iss = `http://stub.invalid/${envId}/as`;
  const reason = (k) => (quirks.reasons && quirks.reasons[k]) || MESSAGES[k];
  const now = () => Math.floor(Date.now() / 1000);
  const sign = (claims) => signJwt(claims, { privateKey: key.privateKey, kid: KIDS.p1 });

  const send = (res, status, body, extra = {}) => {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Correlation-Id': `stub-${++state.corr}`, ...extra });
    res.end(text);
  };
  const oauthError = (res, why) => send(res, 400, { error: 'invalid_request', error_description: `${P1_ERROR_PREFIX}${why} (Correlation ID: stub-${state.corr + 1})` });
  const invalidData = (res, target, message) => send(res, 400, { id: rid(), code: 'INVALID_DATA', message: 'The request could not be completed. One or more validation errors were in the request.', details: [{ code: 'INVALID_VALUE', target, message }] });

  const checkTrusted = (token, app) => {
    let d; try { d = decodeJwt(token); } catch { return MESSAGES.signature; }
    const assigned = [...app.assignments.values()].map((a) => state.issuers.get(a.trustedIssuer.id)).filter(Boolean);
    const ti = assigned.find((t) => t.issuer === d.payload.iss);
    if (!ti) return [...state.issuers.values()].some((t) => t.issuer === d.payload.iss) ? reason('assigned') : reason('issuer');
    let jwks; try { jwks = JSON.parse(ti.jwks); } catch { jwks = { keys: [] }; }
    if (!verifyJwt(token, jwks).ok) return reason('signature');
    const p = d.payload; const t = now(); const skew = ti.clockSkew || 0;
    if (p.exp === undefined ? ti.expRequired : !(p.exp > t - skew)) return p.exp === undefined ? reason('expMissing') : reason('expired');
    if (ti.maxFutureValidity && p.exp !== undefined && p.exp - t > ti.maxFutureValidity) return reason('maxfuture');
    if (ti.iatRequired && p.iat === undefined) return reason('iat');
    if (p.nbf === undefined ? ti.nbfRequired : !(p.nbf <= t + skew)) return p.nbf === undefined ? reason('nbfMissing') : reason('nbfFuture');
    const aud = p.aud === undefined ? [] : [].concat(p.aud);
    if ((ti.audiences || []).length && !aud.some((a) => ti.audiences.includes(a))) return reason('aud');
    return null;
  };

  const evalAttr = (expr, actor, subject) => {
    const act = /^\$\{\{'sub': #root\.context\.requestData\.(actorToken|subjectToken)\.([A-Za-z_]\w*)\}\}$/.exec(expr);
    const plain = /^\$\{#root\.context\.requestData\.(actorToken|subjectToken)\.([A-Za-z_]\w*)\}$/.exec(expr);
    const m = act || plain;
    if (!m) return { skip: true };
    const src = m[1] === 'actorToken' ? actor : subject;
    if (act) return src === null ? { value: { sub: null } } : Object.hasOwn(src, m[2]) ? { value: { sub: src[m[2]] } } : { skip: true };
    return src !== null && Object.hasOwn(src, m[2]) ? { value: src[m[2]] } : { skip: true };
  };

  function token(req, res, body) {
    const basic = /^Basic (.+)$/.exec(req.headers.authorization || '');
    const [id, secret] = basic ? Buffer.from(basic[1], 'base64').toString().split(/:(.*)/s) : [];
    const f = new URLSearchParams(body);
    const grant = f.get('grant_type');
    if (id === workerId && secret === workerSecret && grant === 'client_credentials') {
      const t = `stub-worker-${randomBytes(12).toString('hex')}`; state.workerTokens.add(t);
      return send(res, 200, { access_token: t, token_type: 'Bearer', expires_in: 3600 });
    }
    const app = state.apps.get(id);
    if (!app || app.secret !== secret) return send(res, 401, { error: 'invalid_client', error_description: 'Request denied: Unsupported authentication method' });
    const granted = () => { const g = [...app.grants.values()].find((x) => x.scopes.some((s) => s.name === (f.get('scope') || ''))); return g ? state.resources.get(g.resource.id) : null; };
    if (grant === 'client_credentials') {
      const r = granted();
      return send(res, 200, { access_token: sign({ iss, aud: r ? [r.audience] : [], client_id: id, sub: id, scope: f.get('scope') || '', env: envId, iat: now(), exp: now() + 3600 }), token_type: 'Bearer', expires_in: 3600, scope: f.get('scope') || '' });
    }
    if (grant !== GRANT) return send(res, 400, { error: 'unsupported_grant_type', error_description: 'Unsupported grant type' });
    const r = granted();
    if (!r) return send(res, 400, { error: 'invalid_scope', error_description: 'The request could not be completed. The requested scope is invalid.' });
    const subjectTok = f.get('subject_token'); const actorTok = f.get('actor_token');
    if (!subjectTok || !f.get('subject_token_type')) return oauthError(res, 'No value supplied for required parameter: subject_token');
    if (actorTok && !f.get('actor_token_type')) return oauthError(res, reason('actorTypeMissing'));
    if (actorTok && f.get('actor_token_type') !== JWT_T) return oauthError(res, reason('actorType'));
    let subjectClaims; let subjectIsThirdParty = false;
    if (f.get('subject_token_type') === JWT_T) { const why = checkTrusted(subjectTok, app); if (why) return oauthError(res, why); subjectClaims = decodeJwt(subjectTok).payload; subjectIsThirdParty = true; }
    else if (f.get('subject_token_type') === ACCESS_T) { if (!verifyJwt(subjectTok, { keys: [{ ...key.publicKey.export({ format: 'jwk' }), kid: KIDS.p1, kty: 'RSA' }] }).ok) return oauthError(res, reason('signature')); subjectClaims = decodeJwt(subjectTok).payload; }
    else return oauthError(res, 'Provided token type is not supported');
    let actorClaims = null;
    if (actorTok) { const why = checkTrusted(actorTok, app); if (why) return oauthError(res, why); actorClaims = decodeJwt(actorTok).payload; }
    const issued = { iss, aud: [r.audience], client_id: id, scope: f.get('scope'), env: envId, iat: now(), exp: now() + 3600, jti: rid() };
    if (!subjectIsThirdParty && subjectClaims.sub !== undefined) issued.sub = subjectClaims.sub;
    for (const a of r.attributes.values()) { const v = evalAttr(a.value, actorClaims, subjectIsThirdParty ? subjectClaims : null); if (!v.skip) issued[a.name] = v.value; }
    return send(res, 200, { access_token: sign(issued), issued_token_type: ACCESS_T, token_type: 'Bearer', expires_in: 3600, scope: f.get('scope') });
  }

  const list = (map, name, pick) => ({ _embedded: { [name]: [...map.values()].map(pick) }, count: map.size, size: map.size });
  const brief = (o) => ({ id: o.id, name: o.name });
  const base = `/v1/environments/${envId}`;

  function manage(req, res, body, pathname) {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!bearer || !state.workerTokens.has(bearer[1])) return send(res, 401, { id: rid(), code: 'ACCESS_FAILED', message: 'Invalid key=value pair (missing equal-sign) in Authorization header' });
    let j = {}; if (body) { try { j = JSON.parse(body); } catch { return send(res, 400, { code: 'INVALID_REQUEST', message: 'bad json' }); } }
    const p = pathname.slice(base.length).split('/').filter(Boolean);
    const m = req.method;
    if (state.failOn && `${m} ${p[0]}` === state.failOn) return send(res, 500, { code: 'UNEXPECTED_ERROR', message: 'stub forced failure' });
    const stamp = new Date().toISOString();
    if (p[0] === 'trustedIssuers') {
      const id = p[1];
      if (m === 'GET' && !id) return send(res, 200, list(state.issuers, 'trustedIssuers', (o) => ({ ...o })));
      if (m === 'POST' || m === 'PUT') {
        if (typeof j.name !== 'string' || typeof j.issuer !== 'string' || (typeof j.jwks !== 'string' && !j.jwksUrl)) return invalidData(res, 'jwks', 'name, issuer and jwks (a JSON string) or jwksUrl are required');
        if (j.clockSkew !== undefined && j.clockSkew > 60) return invalidData(res, 'clockSkew', MESSAGES.clockSkewLimit);
        if (m === 'PUT' && !state.issuers.has(id)) return send(res, 404, { code: 'NOT_FOUND' });
        const prev = m === 'PUT' ? state.issuers.get(id) : null;
        const obj = { id: prev ? prev.id : rid(), environment: { id: envId }, name: j.name, issuer: j.issuer, expRequired: j.expRequired ?? true, iatRequired: j.iatRequired ?? false, nbfRequired: j.nbfRequired ?? false, clockSkew: j.clockSkew ?? 0, maxFutureValidity: j.maxFutureValidity ?? 0, audiences: j.audiences || [], jwks: j.jwks, jwksUrl: j.jwksUrl || null, createdAt: prev ? prev.createdAt : stamp, updatedAt: stamp };
        state.issuers.set(obj.id, obj);
        return send(res, m === 'POST' ? 201 : 200, obj);
      }
      if (m === 'DELETE' && state.issuers.delete(id)) return send(res, 204);
    }
    if (p[0] === 'resources') {
      const id = p[1];
      if (!id) { if (m === 'GET') return send(res, 200, list(state.resources, 'resources', brief)); if (m === 'POST') { const o = { id: rid(), name: j.name, audience: j.audience, type: j.type || 'CUSTOM', scopes: new Map(), attributes: new Map(), createdAt: stamp }; state.resources.set(o.id, o); return send(res, 201, { ...o, scopes: undefined, attributes: undefined }); } }
      const r = state.resources.get(id);
      if (!r) return send(res, 404, { code: 'NOT_FOUND' });
      if (!p[2] && m === 'DELETE') { state.resources.delete(id); return send(res, 204); }
      if (p[2] === 'scopes' && m === 'POST') { const o = { id: rid(), name: j.name }; r.scopes.set(o.id, o); return send(res, 201, o); }
      if (p[2] === 'attributes' && m === 'POST') { const o = { id: rid(), name: j.name, type: j.type, value: j.value }; r.attributes.set(o.id, o); return send(res, 201, o); }
    }
    if (p[0] === 'applications') {
      const id = p[1];
      if (!id) { if (m === 'GET') return send(res, 200, list(state.apps, 'applications', brief)); if (m === 'POST') { const o = { id: rid(), name: j.name, enabled: j.enabled, type: j.type, grantTypes: j.grantTypes, tokenEndpointAuthMethod: j.tokenEndpointAuthMethod, secret: `STUB-APP-SECRET-${randomBytes(6).toString('hex')}`, grants: new Map(), assignments: new Map() }; state.apps.set(o.id, o); return send(res, 201, { id: o.id, name: o.name, type: o.type, grantTypes: o.grantTypes, tokenEndpointAuthMethod: o.tokenEndpointAuthMethod }); } }
      const a = state.apps.get(id);
      if (!a) return send(res, 404, { code: 'NOT_FOUND' });
      if (!p[2] && m === 'DELETE') { state.apps.delete(id); return send(res, 204); }
      if (p[2] === 'secret' && m === 'GET') return send(res, 200, { secret: a.secret });
      if (p[2] === 'grants' && m === 'POST') { const r = state.resources.get(j.resource && j.resource.id); if (!r) return send(res, 400, { code: 'INVALID_REFERENCE' }); const o = { id: rid(), resource: { id: r.id }, scopes: (j.scopes || []).map((s) => ({ id: s.id, name: (r.scopes.get(s.id) || {}).name })) }; a.grants.set(o.id, o); return send(res, 201, { id: o.id, resource: o.resource, scopes: o.scopes.map((s) => ({ id: s.id })) }); }
      if (p[2] === 'trustedIssuerAssignments') {
        if (m === 'POST') { if (!state.issuers.has(j.trustedIssuer && j.trustedIssuer.id)) return send(res, 400, { code: 'INVALID_REFERENCE' }); const o = { id: rid(), trustedIssuer: { id: j.trustedIssuer.id } }; a.assignments.set(o.id, o); return send(res, 201, o); }
        if (m === 'DELETE' && a.assignments.delete(p[3])) return send(res, 204);
      }
    }
    return send(res, 404, { code: 'NOT_FOUND', message: 'stub: no such endpoint' });
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const pathname = new URL(req.url, 'http://x').pathname;
      state.log.push(`${req.method} ${pathname}`);
      try {
        if (req.method === 'POST' && pathname === `/${envId}/as/token`) return token(req, res, body);
        if (pathname.startsWith(`${base}/`)) return manage(req, res, body, pathname);
        return send(res, 404, { code: 'NOT_FOUND' });
      } catch { return send(res, 500, { code: 'UNEXPECTED_ERROR' }); }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, state, url: `http://127.0.0.1:${server.address().port}`, workerId, workerSecret,
    names: () => ({ apps: [...state.apps.values()].map((x) => x.name), resources: [...state.resources.values()].map((x) => x.name), issuers: [...state.issuers.values()].map((x) => x.name) }),
    close: () => new Promise((r) => server.close(r)),
  })));
}
