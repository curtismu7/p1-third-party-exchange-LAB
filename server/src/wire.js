// The wire: every HTTP call of one mock run, written out in full. Nothing is abbreviated: full URLs, every header in order, the exact
// raw request and response bodies (the urlencoded form carries the FULL raw JWTs), a copy-pasteable curl, status and response headers.
// Everything is MOCK: hosts end in .example, ids are obviously fake, the credentials below are labelled MOCK (rulebook rule 4,
// mock-credential exception) and the JWTs are real RS256 tokens signed by per-process mock keys. The calls follow the sequence proven
// live on 2026-10-27 (MEASURED); response bodies are mock and any field beyond that sequence is UNVERIFIED.
import { Buffer } from 'node:buffer';
import { fill } from './cast.js';
import { KIDS, p1Key, thirdPartyJwksString } from './keys.js';
import { signJwt } from './jwt.js';
import { ACCESS_TYPE, APP_CLIENT_ID, GRANT_TYPE, JWT_TYPE, P1_ISSUER, RESOURCE_AUD, RESOURCE_SCOPE, TRUSTED_ISSUER_DEFAULTS } from './exchangeData.js';

export const ENV_ID = '00000000-0000-0000-0000-000000000001';
export const AUTH_HOST = 'auth.pingone.example';
export const API_HOST = 'api.pingone.example';
export const API_BASE = `https://${API_HOST}/v1/environments/${ENV_ID}`;
export const MOCK_APP_SECRET = 'MOCK-app-secret-not-real';
export const MOCK_WORKER_ID = 'cccccccc-0000-0000-0000-0000000000c9';
export const MOCK_WORKER_SECRET = 'MOCK-worker-secret-not-real';
export const MOCK_TP_CLIENT = 'mock-third-party-client';
export const MOCK_TP_SECRET = 'MOCK-third-party-secret-not-real';
const IDS = {
  issuer: 'cccccccc-0000-0000-0000-0000000000c1', resource: 'dddddddd-0000-0000-0000-0000000000d1', scope: 'eeeeeeee-0000-0000-0000-0000000000e1',
  attr: (i) => `bbbbbbbb-0000-0000-0000-0000000000b${i}`, grant: 'aaaaaaaa-0000-0000-0000-0000000000a1', assign: 'aaaaaaaa-0000-0000-0000-0000000000a2',
};
export const corrId = (n) => `mock0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UA = 'p1-third-party-exchange-mock/0.1';
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
const form = (pairs) => pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const STATUS = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' };

export function curlOf({ method, url, requestHeaders, requestBody }) {
  const lines = [`curl -i -X ${method} ${q(url)}`];
  for (const h of requestHeaders) if (!['Host', 'Content-Length', 'User-Agent'].includes(h.name)) lines.push(`  -H ${q(`${h.name}: ${h.value}`)}`);
  if (requestBody) lines.push(`  --data-raw ${q(requestBody)}`);
  return lines.join(' \\\n');
}

const pretty = (raw) => { try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; } };

/** One fully described call. `req.headers` / `res.headers` are [name, value] pairs in wire order; Host, Content-Length and Date are added here. */
export function makeItem({ n, id, key, label, phase, method, url, reqHeaders, requestBody = '', status, resHeaders, responseBody = '', notes, evidence = 'measured', now, raw = false }) {
  const u = new URL(url);
  // raw: a captured call (live mode). The headers are exactly what was sent and received (minus redactions); Host and Content-Length
  // of the request are added, and nothing is invented for the response.
  const requestHeaders = [['Host', u.host], ...reqHeaders, ...(requestBody ? [['Content-Length', String(Buffer.byteLength(requestBody))]] : [])].map(([name, value]) => ({ name, value }));
  const responseHeaders = (raw ? resHeaders : [['Date', new Date(now * 1000).toUTCString()], ...resHeaders, ...(responseBody ? [['Content-Length', String(Buffer.byteLength(responseBody))]] : [])]).map(([name, value]) => ({ name, value }));
  const statusText = STATUS[status] || 'Status';
  const requestBodyPretty = pretty(requestBody);
  const responseBodyPretty = pretty(responseBody);
  const head = (hs) => hs.map((h) => `${h.name}: ${h.value}`).join('\n');
  return {
    n, id, key, label, phase, method, url, requestHeaders, requestBody, requestBodyPretty,
    curl: curlOf({ method, url, requestHeaders, requestBody }),
    status, statusText, responseHeaders, responseBody, responseBodyPretty,
    requestText: `${method} ${u.pathname}${u.search} HTTP/1.1\n${head(requestHeaders)}${requestBody ? `\n\n${requestBody}` : ''}`,
    responseText: `HTTP/1.1 ${status} ${statusText}\n${head(responseHeaders)}${responseBody ? `\n\n${responseBodyPretty}` : ''}`,
    notes, evidence,
  };
}

const jsonRes = (n) => [['Content-Type', 'application/json;charset=UTF-8'], ['Cache-Control', 'no-store'], ['Pragma', 'no-cache'], ['X-Correlation-Id', corrId(n)]];
const noBody = (n) => [['Cache-Control', 'no-store'], ['Pragma', 'no-cache'], ['X-Correlation-Id', corrId(n)]];

function vendorTokenCall(vendor, actorJwt) {
  const o = new URL(vendor.issuer);
  const ms = (path) => `https://login.microsoftonline.example/${o.pathname.split('/').filter(Boolean)[0] || ''}${path}`;
  const ccBody = form([['grant_type', 'client_credentials'], ['scope', 'api.read']]);
  const authBasic = [['Authorization', basic(MOCK_TP_CLIENT, MOCK_TP_SECRET)], ['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json']];
  const bearer = (extra = {}) => JSON.stringify({ access_token: actorJwt, token_type: 'Bearer', expires_in: 3600, ...extra });
  switch (vendor.id) {
    case 'pf-cc': return { url: `${o.origin}/as/token.oauth2`, headers: authBasic, body: ccBody, res: bearer({ scope: '' }) };
    case 'pf-oidc': return { url: `${o.origin}/as/token.oauth2`, headers: [['Authorization', basic('oic_client', MOCK_TP_SECRET)], ['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json']], body: form([['grant_type', 'authorization_code'], ['code', 'MOCK-authorization-code'], ['redirect_uri', 'https://app.example/callback']]), res: JSON.stringify({ access_token: 'MOCK-opaque-access-token', token_type: 'Bearer', expires_in: 3600, id_token: actorJwt }) };
    case 'p1': return { url: `${vendor.issuer}/token`, headers: authBasic, body: ccBody, res: bearer({ scope: 'openid' }) };
    case 'okta': return { url: `${vendor.issuer}/v1/token`, headers: authBasic, body: form([['grant_type', 'client_credentials'], ['scope', 'custom']]), res: JSON.stringify({ token_type: 'Bearer', expires_in: 3600, access_token: actorJwt, scope: 'custom' }) };
    case 'auth0': return { url: `${o.origin}/oauth/token`, headers: [['Content-Type', 'application/json'], ['Accept', 'application/json']], body: JSON.stringify({ client_id: MOCK_TP_CLIENT, client_secret: MOCK_TP_SECRET, audience: 'https://health-api.example/', grant_type: 'client_credentials' }), res: JSON.stringify({ access_token: actorJwt, scope: 'read:patients', expires_in: 86400, token_type: 'Bearer' }) };
    case 'rfc9068': return { url: `${o.origin}/token`, headers: authBasic, body: ccBody, res: bearer() };
    case 'ms1': return { url: ms('/oauth2/token'), headers: [['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json']], body: form([['grant_type', 'client_credentials'], ['client_id', MOCK_TP_CLIENT], ['client_secret', MOCK_TP_SECRET], ['resource', 'api://example-app']]), res: JSON.stringify({ token_type: 'Bearer', expires_in: '3599', ext_expires_in: '3599', access_token: actorJwt }) };
    case 'ms2': return { url: ms('/oauth2/v2.0/token'), headers: [['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json']], body: form([['grant_type', 'client_credentials'], ['client_id', MOCK_TP_CLIENT], ['client_secret', MOCK_TP_SECRET], ['scope', 'api://example-app/.default']]), res: JSON.stringify({ token_type: 'Bearer', expires_in: 3599, ext_expires_in: 3599, access_token: actorJwt }) };
    default: return { url: `${o.origin}/token`, headers: authBasic, body: ccBody, res: bearer() };
  }
}

export const attributeExpression = (m) => (m.wrap === 'act' ? `\${{'sub': #root.context.requestData.actorToken.${m.source}}}` : `\${#root.context.requestData.actorToken.${m.source}}`);

/**
 * Builds { setup, wire } for one run. `run` is the result of runExchange (tokens already signed). `traceparents` (optional) are the W3C
 * traceparent values for the three runtime calls.
 */
export function buildWire({ run, vendor, cast, now, workerJwt, traceparents = [] }) {
  const aud = fill(RESOURCE_AUD, cast);
  const s = run.settings;
  const mgmt = (extra = []) => [['Authorization', `Bearer ${workerJwt}`], ...extra, ['Accept', 'application/json'], ['User-Agent', UA]];
  const post = (extra) => mgmt([['Content-Type', 'application/json'], ...extra]);
  const ts = new Date(now * 1000).toISOString();
  let n = 0;
  const next = () => ++n;
  const setup = [];
  const add = (target, spec) => { const nn = next(); target.push(makeItem({ now, ...spec(nn), n: nn })); };

  add(setup, (nn) => ({
    id: `s${nn}`, key: 'worker', label: 'Worker token for the management API (client credentials)', phase: 'setup', method: 'POST', url: `https://${AUTH_HOST}/${ENV_ID}/as/token`,
    reqHeaders: [['Authorization', basic(MOCK_WORKER_ID, MOCK_WORKER_SECRET)], ['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json'], ['User-Agent', UA]],
    requestBody: form([['grant_type', 'client_credentials']]), status: 200, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ access_token: workerJwt, token_type: 'Bearer', expires_in: 3600 }),
    notes: 'MOCK worker app and secret (a mock credential, shown in full per the mock-credential exception). The bearer token below is used by every management call that follows.', evidence: 'measured',
  }));
  const issuerBody = { name: `${cast.castApp} trusted issuer`, issuer: vendor.issuer, expRequired: s.expRequired, iatRequired: s.iatRequired, nbfRequired: s.nbfRequired, clockSkew: s.clockSkew, maxFutureValidity: s.maxFutureValidity, ...(s.audiences.length ? { audiences: s.audiences } : {}), jwks: thirdPartyJwksString() };
  add(setup, (nn) => ({
    id: `s${nn}`, key: 'issuer', label: 'POST /trustedIssuers (inline JWKS)', phase: 'setup', method: 'POST', url: `${API_BASE}/trustedIssuers`, reqHeaders: post([]), requestBody: JSON.stringify(issuerBody),
    status: 201, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ id: IDS.issuer, environment: { id: ENV_ID }, ...issuerBody, jwksUrl: null, createdAt: ts, updatedAt: ts }),
    notes: 'MEASURED: the inline `jwks` field (a JSON string, the PUBLIC key set of this mock run) is accepted and the response shows jwksUrl null. The other settings come from the controls on the Exchange tab. clockSkew is at most 60.', evidence: 'measured',
  }));
  add(setup, (nn) => ({
    id: `s${nn}`, key: 'resource', label: 'POST /resources (custom resource = audience of the issued token)', phase: 'setup', method: 'POST', url: `${API_BASE}/resources`, reqHeaders: post([]),
    requestBody: JSON.stringify({ name: `${cast.castResource}-api`, audience: aud, type: 'CUSTOM', accessTokenValiditySeconds: 3600 }), status: 201, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ id: IDS.resource, environment: { id: ENV_ID }, name: `${cast.castResource}-api`, audience: aud, type: 'CUSTOM', accessTokenValiditySeconds: 3600, createdAt: ts, updatedAt: ts }),
    notes: 'Request shape from the live-proven sequence. The response body is a MOCK; fields beyond id, name and audience are UNVERIFIED.', evidence: 'measured',
  }));
  add(setup, (nn) => ({
    id: `s${nn}`, key: 'scope', label: 'POST /resources/{id}/scopes', phase: 'setup', method: 'POST', url: `${API_BASE}/resources/${IDS.resource}/scopes`, reqHeaders: post([]),
    requestBody: JSON.stringify({ name: RESOURCE_SCOPE }), status: 201, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ id: IDS.scope, name: RESOURCE_SCOPE, createdAt: ts, updatedAt: ts }), notes: 'The scope the exchange asks for. MOCK response (extra fields UNVERIFIED).', evidence: 'measured',
  }));
  run.mapping.forEach((m, i) => {
    const expr = attributeExpression(vendor.mappings[i]);
    add(setup, (nn) => ({
      id: `s${nn}`, key: `attr-${i + 1}`, label: `POST /resources/{id}/attributes (${m.target})`, phase: 'setup', method: 'POST', url: `${API_BASE}/resources/${IDS.resource}/attributes`, reqHeaders: post([]),
      requestBody: JSON.stringify({ name: m.target, type: 'CUSTOM', value: expr }), status: 201, resHeaders: jsonRes(nn),
      responseBody: JSON.stringify({ id: IDS.attr(i + 1), name: m.target, type: 'CUSTOM', value: expr, createdAt: ts, updatedAt: ts }),
      notes: m.evidence === 'measured' ? 'MEASURED expression (guide sample, reproduced live). Attribute `act` is wrapped as {\'sub\': ...} so it is an object.' : 'OUR CHOICE: the expression is our illustration of mapping this issuer\'s claim name; its syntax is the MEASURED form.', evidence: m.evidence === 'measured' ? 'measured' : 'derived',
    }));
  });
  add(setup, (nn) => ({
    id: `s${nn}`, key: 'app', label: 'POST /applications (WEB_APP, token exchange, client secret basic)', phase: 'setup', method: 'POST', url: `${API_BASE}/applications`, reqHeaders: post([]),
    requestBody: JSON.stringify({ name: cast.castApp, enabled: true, type: 'WEB_APP', protocol: 'OPENID_CONNECT', grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'], tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' }),
    status: 201, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ id: APP_CLIENT_ID, environment: { id: ENV_ID }, name: cast.castApp, enabled: true, type: 'WEB_APP', protocol: 'OPENID_CONNECT', grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'], tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC', createdAt: ts, updatedAt: ts }),
    notes: 'MEASURED: a WEB_APP with grant types CLIENT_CREDENTIALS and TOKEN_EXCHANGE and CLIENT_SECRET_BASIC. The application id is its client id. MOCK response.', evidence: 'measured',
  }));
  add(setup, (nn) => ({
    id: `s${nn}`, key: 'secret', label: 'GET /applications/{id}/secret', phase: 'setup', method: 'GET', url: `${API_BASE}/applications/${APP_CLIENT_ID}/secret`, reqHeaders: mgmt([]), status: 200, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ secret: MOCK_APP_SECRET }), notes: 'MOCK client secret, shown in full because it is a mock credential. In LIVE mode a real secret is never shown: it is redacted here.', evidence: 'measured',
  }));
  add(setup, (nn) => ({
    id: `s${nn}`, key: 'grant', label: 'POST /applications/{id}/grants (scope on the resource)', phase: 'setup', method: 'POST', url: `${API_BASE}/applications/${APP_CLIENT_ID}/grants`, reqHeaders: post([]),
    requestBody: JSON.stringify({ resource: { id: IDS.resource }, scopes: [{ id: IDS.scope }] }), status: 201, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ id: IDS.grant, resource: { id: IDS.resource }, scopes: [{ id: IDS.scope }], createdAt: ts, updatedAt: ts }), notes: 'The scope is granted to the application. MOCK response.', evidence: 'measured',
  }));
  add(setup, (nn) => ({
    id: `s${nn}`, key: 'assign', label: 'POST /applications/{id}/trustedIssuerAssignments', phase: 'setup', method: 'POST', url: `${API_BASE}/applications/${APP_CLIENT_ID}/trustedIssuerAssignments`, reqHeaders: post([]),
    requestBody: JSON.stringify({ trustedIssuer: { id: IDS.issuer } }), status: 201, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ id: IDS.assign, trustedIssuer: { id: IDS.issuer }, createdAt: ts, updatedAt: ts }),
    notes: run.assigned ? 'MEASURED: create returns 201 (delete returns 204 at .../trustedIssuerAssignments/{id}).' : 'The Exchange tab has "Assigned to the application" OFF, so in this run this call is NOT made; it is shown so you can see what is missing.', evidence: 'measured',
  }));

  const wire = [];
  const subjectJwt = run.jwts.subject;
  add(wire, (nn) => ({
    id: `w${nn}`, key: 'cc', label: 'PingOne subject token (client credentials)', phase: 'runtime', method: 'POST', url: `https://${AUTH_HOST}/${ENV_ID}/as/token`,
    reqHeaders: [['Authorization', basic(APP_CLIENT_ID, MOCK_APP_SECRET)], ['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json'], ['User-Agent', UA], ...(traceparents[0] ? [['traceparent', traceparents[0]]] : [])],
    requestBody: form([['grant_type', 'client_credentials'], ['scope', RESOURCE_SCOPE]]), status: 200, resHeaders: jsonRes(nn),
    responseBody: JSON.stringify({ access_token: subjectJwt, token_type: 'Bearer', expires_in: 3600, scope: RESOURCE_SCOPE }),
    notes: 'The subject token, a MOCK PingOne access token (real RS256, signed by a mock key). The live run used a client-credentials token as the subject; a signed-in user token works the same way. UNVERIFIED: which claims a client-credentials token carries, so this mock gives it user-style claims to show the issued sub.', evidence: 'measured',
  }));
  const vt = vendorTokenCall(vendor, run.jwts.actor);
  add(wire, (nn) => ({
    id: `w${nn}`, key: 'vendor-token', label: `${vendor.name}: token request to the third-party issuer`, phase: 'runtime', method: 'POST', url: vt.url,
    reqHeaders: [...vt.headers, ['User-Agent', UA], ...(traceparents[1] ? [['traceparent', traceparents[1]]] : [])], requestBody: vt.body, status: 200, resHeaders: jsonRes(nn), responseBody: vt.res,
    notes: `The third-party issuer's own token endpoint (path follows that vendor's usual convention; mock credentials). The access token or ID token in the response is the ACTOR token, a real RS256 JWT signed by the mock third-party key. State: ${run.tokenState}. UNVERIFIED: this vendor request is illustrative; only the token claims come from the vendor's sample.`, evidence: 'sample',
  }));
  let errorOut = null;
  const exchangeBody = form([['grant_type', GRANT_TYPE], ['subject_token', subjectJwt], ['subject_token_type', ACCESS_TYPE], ['actor_token', run.jwts.actor], ['actor_token_type', JWT_TYPE], ['scope', RESOURCE_SCOPE]]);
  add(wire, (nn) => ({
    id: `w${nn}`, key: 'exchange', label: 'Token exchange (subject + third-party actor)', phase: 'runtime', method: 'POST', url: `https://${AUTH_HOST}/${ENV_ID}/as/token`,
    reqHeaders: [['Authorization', basic(APP_CLIENT_ID, MOCK_APP_SECRET)], ['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json'], ['User-Agent', UA], ...(traceparents[2] ? [['traceparent', traceparents[2]]] : [])],
    requestBody: exchangeBody, status: run.ok ? 200 : 400, resHeaders: jsonRes(nn),
    responseBody: run.ok
      ? JSON.stringify({ access_token: run.jwts.issued, issued_token_type: ACCESS_TYPE, token_type: 'Bearer', expires_in: 3600, scope: RESOURCE_SCOPE })
      : JSON.stringify(errorOut = { status: run.error.status, error: run.error.error, error_description: `${run.error.error_description} (Correlation ID: ${corrId(nn)})` }, ['error', 'error_description']),
    notes: run.ok ? 'MEASURED shape: HTTP 200, no audience or resource parameter needed (the issued aud is the custom resource that owns the scope). The access token is a MOCK signed by the mock PingOne key.'
      : 'MEASURED text: every refusal is HTTP 400 invalid_request with the common prefix, the reason, and a Correlation ID (a fake one here). The order PingOne evaluates checks in when several fail is UNVERIFIED.', evidence: 'measured',
  }));
  return { setup, wire, error: errorOut };
}

export function mockWorkerJwt(now) {
  return signJwt({ client_id: MOCK_WORKER_ID, iss: P1_ISSUER, aud: [`https://${API_HOST}`], scope: 'mock-admin', jti: 'mock-jti-worker', iat: now, exp: now + 3600, env: ENV_ID }, { privateKey: p1Key().privateKey, kid: KIDS.p1 });
}
export const DEFAULTS = TRUSTED_ISSUER_DEFAULTS;
