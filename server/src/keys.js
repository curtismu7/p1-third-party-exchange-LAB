// Per-process RSA keys for the mock (RS256 only; no EC, which aborted on Node 20 in CI). Generated lazily, once per process.
// thirdParty: signs the third-party actor tokens and is the key published as the JWKS in the trusted-issuer call.
// bad: a second key with the SAME kid, used by the "bad signature" state, so verification fails for real.
// p1: signs the PingOne-issued tokens (subject, issued, worker). All of it is MOCK: the private keys never leave the process.
import { generateKeyPairSync } from 'node:crypto';

export const KIDS = { thirdParty: 'mock-key', p1: 'mock-p1-key' };
const cache = {};
const rsa = (name) => { if (!cache[name]) cache[name] = generateKeyPairSync('rsa', { modulusLength: 2048 }); return cache[name]; };

export const thirdPartyKey = () => rsa('thirdParty');
export const badKey = () => rsa('bad');
export const p1Key = () => rsa('p1');

export const jwkOf = (publicKey, kid) => ({ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' });
export const thirdPartyJwks = () => ({ keys: [jwkOf(thirdPartyKey().publicKey, KIDS.thirdParty)] });
// The trusted-issuer `jwks` field is a JSON STRING (MEASURED), not an object.
export const thirdPartyJwksString = () => JSON.stringify(thirdPartyJwks());
