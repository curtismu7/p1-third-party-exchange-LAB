// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDORS } from '../server/src/exchangeData.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  return {
    schema: 'demo-content-pack/1',
    id: 'p1-third-party-exchange',
    title: 'P1 Third-Party Exchange',
    version,
    demo: { id: 'p1-third-party-exchange', name: 'P1 Third-Party Exchange', catalog: 'D98', baseUrl: 'http://localhost:5200', doctor: '/api/health', tags: ['pingone', 'token-exchange', 'rfc8693', 'trusted-issuer', 'mock-only'] },
    glossary: [
      { id: 'token-exchange', term: 'Token exchange (RFC 8693)', definition: 'An OAuth grant that swaps tokens: the application sends a subject token (and optionally an actor token) and gets a new access token for a resource. Third-party JWTs as the actor token are the new part here (GUIDE).', aliases: ['RFC 8693', 'actor token'] },
      { id: 'trusted-issuer', term: 'Trusted issuer', definition: 'A PingOne setting that names another issuer (issuer string plus JWKS URL or inline JWKS), optional audiences, and whether exp, iat and nbf must be present. It must be assigned to an OIDC non-worker application (GUIDE).', aliases: ['trustedIssuers'] },
      { id: 'attribute-mapping', term: 'Attribute mapping', definition: 'An expression on the custom resource that copies a claim from the subject or actor token into the issued access token, for example act.sub from the actor sub. The expressions shown were MEASURED live on 2026-10-27.', aliases: ['custom resource mapping'] },
      { id: 'clock-skew', term: 'Clock skew', definition: 'Seconds, 0 to 60 (PingOne rejects more), that loosen the exp and nbf checks on the third-party token (MEASURED).', aliases: ['clockSkew'] },
    ],
    sources: [
      { id: 'rfc8693', title: 'RFC 8693: OAuth 2.0 Token Exchange', url: 'https://www.rfc-editor.org/rfc/rfc8693', kind: 'standard', use: 'Defines the token exchange grant and the act (actor) claim.', status: 'not-read', checked: '2026-10-27' },
    ],
    cards: [
      ...VENDORS.map((v, i) => ({ id: `try-${v.id}`, label: `Try ${v.name}`, description: v.note, group: 'try-it', action: { type: 'route', href: `/#vendor-${v.id}` }, terms: ['trusted-issuer', 'attribute-mapping'], story: sid(i + 1) })),
      { id: 'concept-exchange', label: 'Token exchange with a third-party actor token', description: 'The four steps: define a trusted issuer, assign it, map claims, send the exchange. GUIDE and MEASURED, with UNVERIFIED where it is not confirmed.', group: 'concept', action: { type: 'route', href: '/#exchange' }, terms: ['token-exchange', 'clock-skew'] },
      { id: 'concept-setup', label: 'Setup guide', description: 'The setup guide with measured error texts and expressions.', group: 'concept', action: { type: 'route', href: '/#setup' }, terms: ['trusted-issuer'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: VENDORS.map((v, i) => ({ id: sid(i + 1), title: `${v.name}`, say: `${v.note} Turn on nbf required and watch which issuers PingOne refuses.` })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
