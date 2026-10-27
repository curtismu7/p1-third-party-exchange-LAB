// x5t (SHA-1 thumbprint of the certificate, base64url) of a JWK's x5c entries, so a token's x5t header can be matched to a published key.
import { createHash } from 'node:crypto';
export function thirdPartyJwksFromX5c(jwk) {
  if (!jwk || !Array.isArray(jwk.x5c)) return [];
  const out = [];
  for (const c of jwk.x5c.slice(0, 3)) { try { out.push(createHash('sha1').update(Buffer.from(String(c), 'base64')).digest('base64url')); } catch { /* skip */ } }
  return out;
}
