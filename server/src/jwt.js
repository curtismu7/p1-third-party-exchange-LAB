// Real RS256 JWTs: sign, decode and verify. Bounded input; only RS256 is accepted (no "none", no HS256 key confusion).
import { createPublicKey, sign, verify } from 'node:crypto';

export const MAX_JWT = 8192;
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function signJwt(claims, { privateKey, kid, typ = 'JWT' }) {
  const signing = `${b64({ alg: 'RS256', typ, kid })}.${b64(claims)}`;
  return `${signing}.${sign('RSA-SHA256', Buffer.from(signing), privateKey).toString('base64url')}`;
}

export function decodeJwt(token) {
  if (typeof token !== 'string' || token.length > MAX_JWT) throw new Error('not a JWT');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new Error('a JWT has three base64url parts');
  const json = (p) => JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return { header: json(parts[0]), payload: json(parts[1]), signature: parts[2] };
}

/** { ok, reason }: the signature is REALLY verified against the key in `jwks` (an object { keys: [...] }) with the token's kid. */
export function verifyJwt(token, jwks) {
  let d;
  try { d = decodeJwt(token); } catch (e) { return { ok: false, reason: e.message }; }
  if (d.header.alg !== 'RS256') return { ok: false, reason: 'only RS256 is accepted' };
  const jwk = (jwks && Array.isArray(jwks.keys) ? jwks.keys : []).find((k) => k && k.kid === d.header.kid && k.kty === 'RSA');
  if (!jwk) return { ok: false, reason: 'no key in the JWKS has this kid' };
  try {
    const [h, p, s] = token.split('.');
    const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
    return ok ? { ok: true, reason: 'signature verified' } : { ok: false, reason: 'signature does not match the key' };
  } catch { return { ok: false, reason: 'signature could not be verified' }; }
}
