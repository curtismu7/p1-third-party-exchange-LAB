// Pure logic of the mock: no I/O, no clocks (the caller passes `now`), no eval. Hostile input is bounded and walked
// iteratively (Node 22 has a small stack). The checks and their settings come from the GUIDE; the refusal texts were MEASURED
// live against PingOne (2026-10-27) and are copied here; the ORDER of the checks is ours (UNVERIFIED).
import { Buffer } from 'node:buffer';
import { fill } from './cast.js';
import { cleanText } from './safety.js';
import {
  ACCESS_TYPE, APP_CLIENT_ID, GRANT_TYPE, JWT_TYPE, MAX_CLOCK_SKEW, MAX_FUTURE_VALIDITY_LIMIT, P1_ISSUER, P1_TOKEN_URL, RESOURCE_AUD, RESOURCE_SCOPE, TOKEN_STATES,
  TRUSTED_ISSUER_DEFAULTS, VENDORS, subjectClaims,
} from './exchangeData.js';

export const LIMITS = { depth: 4, nodes: 60, string: 500, audiences: 8, audience: 120, audiencesText: 600, query: 12 };
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const TOP_KEYS = new Set(['vendorId', 'tokenState', 'settings', 'assigned']);
const SETTING_KEYS = new Set(['expRequired', 'iatRequired', 'nbfRequired', 'audiences', 'clockSkew', 'maxFutureValidity']);

export class ExchangeInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Iterative walk: depth, node count, string length, and prototype-pollution keys. Throws ExchangeInputError. */
export function guardBody(root) {
  const stack = [{ value: root, depth: 0 }];
  let seen = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (typeof value === 'string') {
      if (value.length > LIMITS.string) throw new ExchangeInputError('too_long', `a text value is longer than ${LIMITS.string}`);
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (depth >= LIMITS.depth) throw new ExchangeInputError('too_deep', `nesting deeper than ${LIMITS.depth}`);
    for (const [k, v] of Object.entries(value)) {
      if (++seen > LIMITS.nodes) throw new ExchangeInputError('too_many', `more than ${LIMITS.nodes} values`);
      if (FORBIDDEN_KEYS.has(k)) throw new ExchangeInputError('forbidden_key', 'a key is not allowed');
      stack.push({ value: v, depth: depth + 1 });
    }
  }
}

const bool = (v, name) => {
  if (typeof v !== 'boolean') throw new ExchangeInputError('bad_setting', `${name} must be true or false`);
  return v;
};

const int = (v, name, max) => {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new ExchangeInputError('bad_setting', `${name} must be a whole number from 0 to ${max}`);
  return v;
};

export function parseAudiences(text) {
  const list = String(text).split(',').map((s) => cleanText(s, LIMITS.audience)).filter(Boolean);
  if (list.length > LIMITS.audiences) throw new ExchangeInputError('too_many', `at most ${LIMITS.audiences} audiences`);
  return list;
}

/** Validate a request. Returns { vendor, state, settings, assigned } or throws ExchangeInputError. */
export function normalizeInput(raw) {
  if (!isObj(raw)) throw new ExchangeInputError('bad_request', 'body must be a JSON object');
  guardBody(raw);
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) throw new ExchangeInputError('unknown_field', `unknown field ${cleanText(k, 30)}`);
  const vendor = typeof raw.vendorId === 'string' ? VENDORS.find((v) => v.id === raw.vendorId) : undefined;
  if (!vendor) throw new ExchangeInputError('unknown_vendor', 'vendorId is not one of the listed issuers');
  const stateId = raw.tokenState === undefined ? 'valid' : raw.tokenState;
  if (typeof stateId !== 'string' || !TOKEN_STATES.some((t) => t.id === stateId)) throw new ExchangeInputError('unknown_state', 'tokenState is not one of the listed states');
  const s = raw.settings === undefined ? {} : raw.settings;
  if (!isObj(s)) throw new ExchangeInputError('bad_setting', 'settings must be an object');
  for (const k of Object.keys(s)) if (!SETTING_KEYS.has(k)) throw new ExchangeInputError('unknown_field', `unknown setting ${cleanText(k, 30)}`);
  const d = TRUSTED_ISSUER_DEFAULTS;
  const audiencesText = s.audiences === undefined ? d.audiences : s.audiences;
  if (typeof audiencesText !== 'string') throw new ExchangeInputError('bad_setting', 'audiences must be text');
  if (audiencesText.length > LIMITS.audiencesText) throw new ExchangeInputError('too_long', `audiences is longer than ${LIMITS.audiencesText}`);
  const settings = {
    expRequired: s.expRequired === undefined ? d.expRequired : bool(s.expRequired, 'expRequired'),
    iatRequired: s.iatRequired === undefined ? d.iatRequired : bool(s.iatRequired, 'iatRequired'),
    nbfRequired: s.nbfRequired === undefined ? d.nbfRequired : bool(s.nbfRequired, 'nbfRequired'),
    audiences: parseAudiences(audiencesText),
    clockSkew: s.clockSkew === undefined ? d.clockSkew : int(s.clockSkew, 'clockSkew', MAX_CLOCK_SKEW),
    maxFutureValidity: s.maxFutureValidity === undefined ? d.maxFutureValidity : int(s.maxFutureValidity, 'maxFutureValidity', MAX_FUTURE_VALIDITY_LIMIT),
  };
  const assigned = raw.assigned === undefined ? true : bool(raw.assigned, 'assigned');
  return { vendor, state: stateId, settings, assigned };
}

/** GET query strings are all text: true/false become booleans, then the same validation as the body. */
export function inputFromQuery(q) {
  if (!isObj(q)) throw new ExchangeInputError('bad_request', 'bad query');
  const known = ['vendorId', 'tokenState', 'expRequired', 'iatRequired', 'nbfRequired', 'audiences', 'clockSkew', 'maxFutureValidity', 'assigned', 'vertical'];
  for (const k of Object.keys(q)) if (!known.includes(k)) throw new ExchangeInputError('unknown_field', `unknown query field ${cleanText(k, 30)}`);
  for (const k of known) if (q[k] !== undefined && typeof q[k] !== 'string') throw new ExchangeInputError('bad_request', `${k} must be text`);
  const b = (name) => (q[name] === undefined ? undefined : q[name] === 'true' ? true : q[name] === 'false' ? false : q[name]);
  const settings = {};
  for (const k of ['expRequired', 'iatRequired', 'nbfRequired']) if (q[k] !== undefined) settings[k] = b(k);
  if (q.audiences !== undefined) settings.audiences = q.audiences;
  for (const k of ['clockSkew', 'maxFutureValidity']) if (q[k] !== undefined) settings[k] = /^\d{1,10}$/.test(q[k]) ? Number(q[k]) : q[k];
  const body = { vendorId: q.vendorId, settings };
  if (q.tokenState !== undefined) body.tokenState = q.tokenState;
  if (q.assigned !== undefined) body.assigned = b('assigned');
  return normalizeInput(body);
}

const audList = (aud) => (aud === undefined ? [] : Array.isArray(aud) ? aud : [aud]);

/** Apply a token state to a vendor's claims. Returns the claims the exchange will see. */
export function stateClaims(vendor, state, now) {
  const c = vendor.claims(now);
  if (state === 'expired') return { ...c, ...(c.exp !== undefined ? { exp: now - 600 } : {}) };
  if (state === 'wrong-issuer') return { ...c, iss: 'https://not-trusted.example/' };
  return c;
}

// Every `message` is the text PingOne returned when the same case was run live on 2026-10-27 (HTTP 400, invalid_request);
// this app only copies it. The ORDER PingOne evaluates the checks in is UNVERIFIED: only one fault at a time was tested.
const P1_ERROR_PREFIX = 'The request could not be completed. The request was malformed or invalid.: ';

export function validateExchange({ vendor, state, settings, assigned, now }) {
  const claims = stateClaims(vendor, state, now);
  const aud = audList(claims.aud);
  const wanted = settings.audiences;
  const skew = Math.min(Math.max(settings.clockSkew || 0, 0), MAX_CLOCK_SKEW);
  const maxFuture = Math.max(settings.maxFutureValidity || 0, 0);
  const checks = [
    { id: 'assigned', label: 'Trusted issuer is assigned to the application', ok: assigned, detail: assigned ? 'assigned' : 'not assigned to the calling application', message: 'The token issuer does not match any Trusted Issuer for the requesting application' },
    { id: 'issuer', label: 'iss equals the trusted issuer', ok: claims.iss === vendor.issuer, detail: `token iss: ${claims.iss}`, message: 'The token issuer does not match any Trusted Issuer assigned to the application' },
    { id: 'signature', label: 'Signature verifies against the issuer JWKS', ok: state !== 'bad-signature', detail: state === 'bad-signature' ? 'signature does not match any key in the JWKS' : 'verified against JWKS (mock)', message: 'JWT signature verification failed' },
    { id: 'exp', label: settings.expRequired ? 'exp present and not past' : 'exp not required', ok: claims.exp === undefined ? !settings.expRequired : claims.exp > now - skew, detail: claims.exp === undefined ? 'token has no exp' : claims.exp > now - skew ? 'in the future' : 'in the past', message: claims.exp === undefined ? 'Missing exp claim; the Trusted Issuer requires an expiration time' : 'The provided JWT has expired' },
    { id: 'maxfuture', label: maxFuture ? `exp no more than ${maxFuture}s ahead` : 'maximum future validity off', ok: !maxFuture || claims.exp === undefined || claims.exp - now <= maxFuture, detail: claims.exp === undefined ? 'no exp' : `exp is ${claims.exp - now}s ahead`, message: 'The exp claim exceeds the maximum allowed future validity' },
    { id: 'iat', label: settings.iatRequired ? 'iat present' : 'iat not required', ok: !settings.iatRequired || claims.iat !== undefined, detail: claims.iat === undefined ? 'token has no iat' : 'present', message: 'Missing iat claim; the Trusted Issuer requires an issued-at time' },
    { id: 'nbf', label: settings.nbfRequired ? 'nbf present and reached' : 'nbf not required', ok: claims.nbf === undefined ? !settings.nbfRequired : claims.nbf <= now + skew, detail: claims.nbf === undefined ? 'token has no nbf' : 'present', message: claims.nbf === undefined ? 'Missing nbf claim; the Trusted Issuer requires a not-before time' : 'The nbf claim is in the future beyond the allowed clock skew' },
    { id: 'aud', label: wanted.length ? 'aud has one of the trusted audiences' : 'Trusted audiences blank: any aud accepted', ok: !wanted.length || aud.some((a) => wanted.includes(a)), detail: `token aud: ${aud.length ? aud.join(', ') : 'none'}`, message: "None of the token's aud values match the Trusted Issuer's configured audiences" },
  ];
  const failed = checks.find((c) => !c.ok) || null;
  return { claims, checks, ok: !failed, failed, error: failed ? { status: 400, error: 'invalid_request', error_description: P1_ERROR_PREFIX + failed.message } : null };
}

/** Run a mapping against the actor token claims. A source claim the vendor does not issue adds nothing. */
export function applyMapping(mapping, actorClaims) {
  if (!Object.hasOwn(actorClaims, mapping.source)) return { present: false, claim: null };
  const v = actorClaims[mapping.source];
  return { present: true, claim: { [mapping.target]: mapping.wrap === 'act' ? { sub: v } : v } };
}

export function resultClaims(subject, mapped, now, cast) {
  return {
    client_id: subject.client_id, iss: P1_ISSUER, jti: 'mock-jti-result', iat: now, exp: now + 3600, aud: [fill(RESOURCE_AUD, cast)],
    scope: RESOURCE_SCOPE, sub: subject.sub, sid: subject.sid, auth_time: subject.auth_time, acr: subject.acr,
    ...(mapped?.claim || {}), env: subject.env, org: subject.org,
  };
}

export function requestText(cast) {
  return [
    `POST ${P1_TOKEN_URL}`,
    'Content-Type: application/x-www-form-urlencoded',
    '',
    `grant_type=${GRANT_TYPE}`,
    'subject_token=<PingOne access token>',
    `subject_token_type=${ACCESS_TYPE}`,
    'actor_token=<third-party JWT>',
    `actor_token_type=${JWT_TYPE}`,
    `scope=${RESOURCE_SCOPE}`,
    `(client authentication: the application's client id and secret, HTTP Basic, as for any PingOne token request; application ${cast.castApp}, client_id ${APP_CLIENT_ID})`,
  ].join('\n');
}

/** Unsigned, labelled mock JWT: header.payload.MOCK-SIGNATURE-NOT-VALID. Never verifiable. */
export function mockJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT', kid: 'mock-key' })}.${b64(claims)}.MOCK-SIGNATURE-NOT-VALID`;
}

/** The whole mock exchange for one validated input. */
export function runExchange(input, { now, cast }) {
  const { vendor, state, settings, assigned } = input;
  const run = validateExchange({ vendor, state, settings, assigned, now });
  const subject = subjectClaims(now);
  const mapping = vendor.mappings.map((m) => ({ id: m.id, label: m.label, target: m.target, source: m.source, evidence: m.evidence, note: m.note, ...applyMapping(m, run.claims) }));
  const mappedClaim = Object.assign({}, ...mapping.map((m) => m.claim || {}));
  const issued = run.ok ? resultClaims(subject, { claim: mappedClaim }, now, cast) : null;
  return {
    ok: run.ok,
    failed: run.failed,
    checks: run.checks,
    vendor: { id: vendor.id, name: vendor.name, issuer: vendor.issuer, evidence: vendor.evidence },
    tokenState: state,
    settings,
    assigned,
    now,
    request: requestText(cast),
    subject,
    actor: run.claims,
    mapping,
    issued,
    // PingOne's real refusal text, MEASURED live 2026-10-27 (copied, not fetched). The body is a mock of the response, not a live one.
    error: run.error,
    jwtLabel: 'MOCK JWT: unsigned, never verifiable',
    jwts: { subject: mockJwt(subject), actor: mockJwt(run.claims), issued: issued ? mockJwt(issued) : null },
  };
}
