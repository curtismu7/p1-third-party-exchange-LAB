// The domain as data: PingOne OAuth token exchange (RFC 8693) that accepts a THIRD-PARTY signed JWT as the actor token.
// Sources: Ping's UAT guide "Token Exchange to support third-party signed JWTs as subject and actor tokens" (23 Oct 2026,
// for Ping staff and selected customers; feature-flagged; called GUIDE below) and the "Token claims from Auth0, Okta,
// Microsoft, RFC9068, and PingOne" comparison sheets (public vendor sample tokens; called SAMPLE). Nothing here calls PingOne:
// it is a mock. Every issuer, client id, user id and host is a placeholder ending in .example; real ids are NOT copied.
// Text is {{token}} templated (see cast.js) so the brand, application and resource come from a vertical pack.

export const BANNER = 'SIMULATED: a mock of PingOne token exchange with a third-party actor token. Nothing here calls PingOne, a third-party issuer or any tenant.';
export const HOSTED_BANNER = 'HOSTED SIMULATION: a mock of PingOne token exchange with a third-party actor token. Nothing here calls PingOne, a third-party issuer or any tenant.';

export const TITLE = 'PingOne token exchange with third-party tokens';
export const INTRO = 'PingOne can trust a JWT signed by another issuer (PingFederate, Okta, Auth0, Microsoft, another PingOne environment) and accept it as the actor token in an RFC 8693 token exchange. Claims from that token can then be mapped into the access token PingOne issues. Pick an issuer, change the trusted-issuer settings and see which check decides.';

export const EVIDENCE = {
  measured: { label: 'MEASURED', note: 'Run live against a PingOne environment (North America) on 2026-10-27, with a trusted issuer whose key we generated ourselves. Exact error text is what PingOne returned. This app itself makes no live call.' },
  guide: { label: 'GUIDE', note: "Stated in Ping's UAT guide (23 Oct 2026)." },
  sample: { label: 'SAMPLE', note: "A vendor's published sample token or the comparison sheet. Ids, hosts and times are placeholders." },
  derived: { label: 'OUR CHOICE', note: 'Our illustration of how a mapping could look. Not from the guide.' },
  unverified: { label: 'UNVERIFIED', note: 'Not stated in the guide or not captured (the guide shows its token requests as images). Check before quoting.' },
};

export const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const JWT_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
export const ACCESS_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
export const P1_ISSUER = 'https://auth.pingone.example/00000000-0000-0000-0000-000000000001/as';
export const P1_TOKEN_URL = `${P1_ISSUER}/token`;
export const RESOURCE_AUD = 'https://api.{{castHost}}.example/{{castResource}}';
export const RESOURCE_SCOPE = 'a.read.all';
export const APP_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
export const USER_ID = '22222222-2222-2222-2222-222222222222';

export function subjectClaims(now) {
  return {
    client_id: APP_CLIENT_ID, iss: P1_ISSUER, jti: 'mock-jti-subject', iat: now - 120, exp: now + 3480,
    aud: ['https://api.pingone.example'], scope: 'openid', sub: USER_ID, sid: 'mock-session-id', auth_time: now - 120,
    acr: 'Single_Factor', env: '00000000-0000-0000-0000-000000000001', org: '00000000-0000-0000-0000-0000000000aa',
  };
}

// Each vendor: the issuer string its token carries and a claims builder. A claim a vendor does not issue is simply absent
// (that is what the iat/nbf switches expose).
export const VENDORS = [
  {
    id: 'pf-cc', name: 'PingFederate: client credentials', evidence: 'guide', issuer: 'https://pf.vendor.example:9031',
    note: "Token 2 of the guide's sample A. A machine identity: the agent app's own PingFederate token. No iat or nbf, only exp.",
    claims: (now) => ({ jatm_scope: '', jatm_client_id: 'cc_client', iss: 'https://pf.vendor.example:9031', aud: 'cc_client', jti: 'mock-jti-pf-cc', sub: 'cc_client', subj: 'PF admin maps what PF admin wants', exp: now + 3600 }),
    mappings: [
      { id: 'act', label: 'act.sub from the actor token sub', target: 'act', source: 'sub', wrap: 'act', evidence: 'measured', note: "Guide sample A, reproduced live. Expression on the resource: ${{'sub': #root.context.requestData.actorToken.sub}}. A client-credentials token with no actor gets act.sub null, so expect that on tokens issued without an actor." },
    ],
  },
  {
    id: 'pf-oidc', name: 'PingFederate: ID token', evidence: 'guide', issuer: 'https://pf.vendor.example:9031',
    note: "Token 2 of the guide's sample B. A user ID token carrying a custom securityLevel claim.",
    claims: (now) => ({ sub: 'jsmith', aud: 'oic_client', jti: 'mock-jti-pf-id', iss: 'https://pf.vendor.example:9031', iat: now - 60, exp: now + 3540, sid: 'mock-sid', amr: ['oidcPolicy'], auth_time: now - 60, acr: 'oidcPolicy', securityLevel: 'Class 3' }),
    mappings: [
      { id: 'sec', label: 'security from the securityLevel claim', target: 'security', source: 'securityLevel', evidence: 'measured', note: 'Guide sample B, reproduced live. Expression: ${#root.context.requestData.actorToken.securityLevel}. If the actor token has no such claim, PingOne leaves the attribute out and still issues the token (measured).' },
    ],
  },
  {
    id: 'p1', name: 'PingOne (another environment)', evidence: 'sample', issuer: 'https://auth.pingone.example/00000000-0000-0000-0000-000000000002/as',
    note: "The comparison sheet column for a PingOne token from a different environment. Claim set taken from the sheet and the guide's PingOne token 1.",
    claims: (now) => ({ iss: 'https://auth.pingone.example/00000000-0000-0000-0000-000000000002/as', sub: 'mock-user-in-other-env', aud: ['https://api.other-env.example'], client_id: 'mock-client-other-env', iat: now - 60, exp: now + 3540, jti: 'mock-jti-p1', auth_time: now - 60, acr: 'Single_Factor', scope: 'openid', 'p1.userId': 'mock-user-in-other-env' }),
    mappings: [{ id: 'act', label: 'act.sub from client_id', target: 'act', source: 'client_id', wrap: 'act', evidence: 'derived', note: 'Our illustration: name the calling application of the other environment.' }],
  },
  {
    id: 'okta', name: 'Okta', evidence: 'sample', issuer: 'https://okta.example/oauth2/aus1example',
    note: 'Okta access token. Application id is cid, scopes are scp, user id is uid. Has no nbf.',
    claims: (now) => ({ ver: 1, jti: 'AT.mock-jti-okta', iss: 'https://okta.example/oauth2/aus1example', aud: 'https://api.okta-sample.example', sub: '00uexampleuser', iat: now - 60, exp: now + 3540, cid: '0oaexampleapp', uid: '00uexampleuser', scp: ['openid', 'email', 'flights', 'custom'], auth_time: now - 120, custom_claim: 'CustomValue' }),
    mappings: [{ id: 'act', label: 'act.sub from cid', target: 'act', source: 'cid', wrap: 'act', evidence: 'derived', note: 'Our illustration: cid is the calling Okta application.' }],
  },
  {
    id: 'auth0', name: 'Auth0', evidence: 'sample', issuer: 'https://my-domain.auth0.example/',
    note: 'Auth0 access token (its default profile). Application id is azp, no jti, no auth_time. Has no nbf.',
    claims: (now) => ({ iss: 'https://my-domain.auth0.example/', sub: 'auth0|123456', aud: ['https://health-api.example/', 'https://my-domain.auth0.example/userinfo'], azp: 'my_client_id', iat: now - 60, exp: now + 3540, scope: 'openid profile read:patients read:admin', my_custom_claim: 'my_custom_value' }),
    mappings: [{ id: 'act', label: 'act.sub from azp', target: 'act', source: 'azp', wrap: 'act', evidence: 'derived', note: 'Our illustration: azp is the authorized party, the calling application.' }],
  },
  {
    id: 'rfc9068', name: 'RFC 9068 (and Auth0 RFC 9068 profile)', evidence: 'sample', issuer: 'https://authorization-server.example/',
    note: 'The standard JWT access-token profile. Required: iss, exp, aud, sub, client_id, iat, jti. Auth0 can issue this shape too.',
    claims: (now) => ({ iss: 'https://authorization-server.example/', sub: '5ba552d67', aud: 'https://rs.example/', exp: now + 3600, iat: now - 60, jti: 'mock-jti-rfc9068', client_id: 's6BhdRkqt3', scope: 'openid profile reademail' }),
    mappings: [{ id: 'act', label: 'act.sub from client_id', target: 'act', source: 'client_id', wrap: 'act', evidence: 'derived', note: 'Our illustration: client_id is required by RFC 9068, so it is always there.' }],
  },
  {
    id: 'ms1', name: 'Microsoft v1.0', evidence: 'sample', issuer: 'https://sts.windows.example/aaaaaaaa-0000-0000-0000-000000000001/',
    note: 'Entra ID v1.0 access token. Application id is appid, user object id is oid, jti is uti. Has iat, nbf and exp.',
    claims: (now) => ({ aud: 'api://example-app', iss: 'https://sts.windows.example/aaaaaaaa-0000-0000-0000-000000000001/', iat: now - 60, nbf: now - 60, exp: now + 3540, acr: '1', aio: '<opaque>', amr: ['wia'], appid: 'bbbbbbbb-0000-0000-0000-000000000002', appidacr: '0', email: 'abe@mail.example', family_name: 'Lincoln', given_name: 'Abe', idp: 'https://sts.windows.example/aaaaaaaa-0000-0000-0000-000000000003/', name: 'abeli', oid: 'cccccccc-0000-0000-0000-000000000004', scp: 'user_impersonation', sub: 'mock-sub-ms1', tid: 'aaaaaaaa-0000-0000-0000-000000000001', uti: 'mock-uti-ms1', ver: '1.0' }),
    mappings: [{ id: 'act', label: 'act.sub from appid', target: 'act', source: 'appid', wrap: 'act', evidence: 'derived', note: 'Our illustration: appid is the calling application.' }],
  },
  {
    id: 'ms2', name: 'Microsoft v2.0', evidence: 'sample', issuer: 'https://login.microsoftonline.example/aaaaaaaa-0000-0000-0000-000000000001/v2.0',
    note: 'Entra ID v2.0 access token. Application id is azp, no amr, jti is uti. Has iat, nbf and exp.',
    claims: (now) => ({ aud: 'dddddddd-0000-0000-0000-000000000005', iss: 'https://login.microsoftonline.example/aaaaaaaa-0000-0000-0000-000000000001/v2.0', iat: now - 60, nbf: now - 60, exp: now + 3540, aio: '<opaque>', azp: 'dddddddd-0000-0000-0000-000000000005', azpacr: '0', name: 'Abe Lincoln', oid: 'eeeeeeee-0000-0000-0000-000000000006', preferred_username: 'abe@mail.example', scp: 'access_as_user', sub: 'mock-sub-ms2', tid: 'aaaaaaaa-0000-0000-0000-000000000001', uti: 'mock-uti-ms2', ver: '2.0' }),
    mappings: [{ id: 'act', label: 'act.sub from azp', target: 'act', source: 'azp', wrap: 'act', evidence: 'derived', note: 'Our illustration: azp is the calling application.' }],
  },
];

// Trusted issuer fields from the guide's admin API sample.
// clockSkew (seconds, MEASURED: PingOne rejects more than 60) loosens exp and nbf. maxFutureValidity (seconds, 0 = no limit,
// MEASURED) refuses an exp that is further ahead than that. Both are in the guide's API sample (value 0) but unexplained there.
export const TRUSTED_ISSUER_DEFAULTS = { expRequired: true, iatRequired: false, nbfRequired: false, audiences: '', clockSkew: 0, maxFutureValidity: 0 };
export const MAX_CLOCK_SKEW = 60;
export const MAX_FUTURE_VALIDITY_LIMIT = 31536000;

export const TOKEN_STATES = [
  { id: 'valid', label: 'Valid' },
  { id: 'expired', label: 'Expired' },
  { id: 'wrong-issuer', label: 'Issuer not trusted' },
  { id: 'bad-signature', label: 'Bad signature' },
];

export const STEPS = [
  { n: 1, title: 'Define a trusted issuer', body: 'Name, issuer, and either a JWKS URL or the JWKS itself. Optional audience list: blank accepts any aud. Per-issuer switches say whether exp, iat and nbf must be present.', where: '/trustedIssuers', evidence: 'guide' },
  { n: 2, title: 'Assign it to an application', body: 'Only OIDC-based, non-worker applications that may use the token exchange grant. Assignments to AI agents are marked coming soon.', where: '/applications/<appId>/trustedIssuerAssignments', evidence: 'guide' },
  { n: 3, title: 'Map attributes on the custom resource', body: 'An existing capability: an expression on the resource that is the audience of the new token reads a claim from the subject or actor token. The guide shows act from the actor sub and security from securityLevel.', where: 'custom resource, attribute mapping', evidence: 'guide' },
  { n: 4, title: 'Send the token exchange', body: 'Same grant as today. The subject_token_type or actor_token_type is urn:ietf:params:oauth:token-type:jwt for the third-party token.', where: 'POST /as/token', evidence: 'guide' },
];

export const API_SAMPLES = {
  trustedIssuer: { name: 'Example', issuer: 'https://issuer.example', expRequired: true, iatRequired: false, nbfRequired: false, audiences: ['one', 'two'], jwksUrl: 'https://issuer.example/jwks' },
  assignment: { trustedIssuer: { id: '<trusted issuer id>' } },
};

export const ADMIN_FACTS = [
  ['Permissions: trusted issuers', 'trustedIssuers:create|read|update|delete:trustedIssuer. Create, update, delete: Environment Admin. Read: also Client Application Developer, Application Owner, Configuration Read Only.'],
  ['Permissions: assignments', 'applications:create|read|update|delete:trustedIssuerAssignment, same role split.'],
  ['Audit and webhook events', 'Trusted Issuer and Trusted Issuer Assignment, each with Created, Read, Update, Delete (eight events).'],
  ['License packages (any one)', 'TRIAL, ENHANCED TRIAL, AGENT IAM CORE, WORKFORCE PLUS, WORKFORCE PREMIUM, CIAM PLUS, CIAM PASSWORDLESS, CIAM PREMIUM. Four internal packages also have it.'],
  ['Measured limits (2026-10-27)', 'clockSkew is in seconds and PingOne rejects more than 60 (it loosens exp and nbf). maxFutureValidity is in seconds, 0 means no limit, and refuses an exp further ahead than that. Inline JWKS is the jwks field, a JSON string.'],
  ['Coming soon (per the guide)', 'Trusted issuer assignments to AI agents, and configuration management and promotion.'],
];

export const NOT_SHOWN = [
  'Third-party token as the SUBJECT token. The guide says it is accepted, but its two samples only use a third-party actor token, so this app does not simulate it and does not guess what the issued sub becomes.',
  'The order PingOne evaluates the checks in. Each refusal text is real, but when two things are wrong at once PingOne may name a different one first. We tested one fault at a time.',
  'A third-party JWT as the SUBJECT token. PingOne accepts it (measured), and you can map its claims with subjectToken, but the issued token then has no sub of its own. This app simulates the actor case only.',
  'A signed-in USER as the subject. Our live runs used a client-credentials PingOne access token as the subject, because a user sign-in needs a browser.',
  'The feature flag name (the guide gives no flag name); the flag was on in the environment we tested.',
];

// Comparison sheet (claims each issuer puts in its access token). null = "Not included" / "Not defined" on the sheet.
export const COMPARE_COLUMNS = ['PingOne', 'RFC 9068', 'Auth0 (RFC 9068)', 'Auth0', 'Okta', 'Microsoft v1.0', 'Microsoft v2.0'];
export const COMPARE_ROWS = [
  ['Issuer', 'iss', 'iss (Required)', 'iss', 'iss', 'iss', 'iss', 'iss'],
  ['Expiry', 'exp', 'exp (Required)', 'exp', 'exp', 'exp', 'exp', 'exp'],
  ['Audience', 'aud', 'aud (Required)', 'aud', 'aud', null, 'aud', 'aud'],
  ['Subject', 'sub', 'sub (Required)', 'sub', 'sub', 'sub (in sample)', 'sub', 'sub'],
  ['Client / app id', 'client_id', 'client_id (Required)', 'client_id', 'azp', 'cid', 'appid', 'azp'],
  ['Issued at', 'iat', 'iat (Required)', 'iat', 'iat', 'iat', 'iat (stands in for auth_time)', 'iat (stands in for auth_time)'],
  ['Token id', 'jti', 'jti (Required)', 'jti', null, 'jti', 'uti', 'uti'],
  ['Authentication time', 'auth_time', 'auth_time (Optional)', null, null, 'auth_time', 'iat', 'iat'],
  ['acr', 'acr', 'acr (Optional)', null, null, null, 'acrs', 'acr'],
  ['amr', null, 'amr (Optional)', null, null, null, 'amr', null],
  ['Scope', 'scope', 'scope (Conditional)', 'scope', 'scope', 'scp', 'scp', 'scp'],
  ['User id', 'p1.userId', null, null, null, 'uid', 'oid', 'oid'],
  ['Grant type used', 'Custom?', null, null, 'gty', null, null, null],
  ['Permissions', 'PingOne AuthZ', null, 'permissions', 'permissions', null, null, null],
  ['Rich authorization (RAR)', 'Not natively', null, 'authorization_details', 'authorization_details', null, null, null],
  ['mTLS binding', 'Not natively', null, 'cnf', 'cnf', null, null, null],
  ['Identity provider', 'Custom?', null, null, null, null, 'idp', null],
  ['nbf', null, null, null, null, null, 'nbf', 'nbf'],
  ['Client auth method', 'Custom', null, null, null, null, 'appidacr', 'azpacr'],
];
export const COMPARE_NOTE = "From the comparison sheet. A dash means the sheet says not included or not defined. The sheet lists Okta aud as not found, though Okta's sample token has aud, so the sample is what the picker uses.";

// The talk track, as data, so the web talk-track view and presenter mode read the same words as docs/talk-track.md.
export const TALK_TRACK = [
  { id: 'say-first', title: 'Say first', say: 'Everything here is simulated. The tokens, the checks and the issued token are invented by this app. The capability is behind a feature flag and the guide gives no flag name, so check with Ping that it is on in your environment. {{castBrand}} is a made-up customer.' },
  { id: 'what', title: 'What it does', say: 'PingOne token exchange used to accept only tokens from the same environment. With this capability {{castApp}} can present a PingOne user token as the subject and a JWT from another issuer as the actor, with actor_token_type urn:ietf:params:oauth:token-type:jwt. The guide says so (GUIDE); the request shape and the PingOne error texts we show were MEASURED live on 2026-10-27, and the order PingOne evaluates checks in is UNVERIFIED.' },
  { id: 'setup', title: 'Four steps', say: 'Define a trusted issuer, assign it to an OIDC non-worker application, map claims on the custom resource {{castResource}}, then send the exchange. The Setup guide tab has the same steps with every GUIDE and UNVERIFIED label.' },
  { id: 'nbf', title: 'The nbf trap', say: 'Pick Okta and turn on nbf required: it is refused with the text PingOne returns (Missing nbf claim), because an Okta token has no nbf. Pick Microsoft and it passes, because Entra tokens carry nbf. The same switch, a different answer, decided by the third-party token.' },
  { id: 'mapping', title: 'Claim mapping', say: 'The attribute mapping on the custom resource reads a claim from the actor token. Each vendor names the calling application differently: client_id, azp, cid or appid. If the source claim is absent, the mapped claim is simply missing from the issued token.' },
  { id: 'wire', title: 'The wire', say: 'The Wire tab shows every HTTP call whole: the admin calls that set it up (trusted issuer with its inline JWKS, resource, scope, attributes, application, grant, assignment) and the three runtime calls. Full URLs, every header, the exact bodies, a curl for each, and the complete tokens with Copy buttons. The tokens are real RS256 JWTs signed by mock keys, the actor token verifies against the JWKS in the trusted-issuer call, and a bad-signature token really fails. All hosts end in .example and every credential is a MOCK one.' },
  { id: 'live', title: 'Live mode (owner-run)', say: 'Only on the owner\'s machine, never in the hosted build: MODE=live with P1TPX_ALLOW_LIVE=1. It writes to a real PingOne environment: it creates throwaway p1x-live-* objects with its own key, runs the scenarios, compares each result with what this mock predicted (MATCH or MISMATCH), and deletes everything again. The worker secret is write-only and is never shown.' },
  { id: 'real', title: 'Real exchange tabs', say: 'Two tabs make a REAL exchange. In every build, including this hosted one, Real exchange (your browser) sends the request from your own browser straight to your own PingOne: nothing goes through this server, and the secret and tokens stay in the page. On the owner\'s machine only, Real exchange (local) sends one real exchange from the local server, optionally fetching the third-party token for you; it creates and deletes nothing. Your PingFederate token works as the third-party token if PingOne trusts its issuer and the PingFederate access token manager publishes its keys.' },
  { id: 'limits', title: 'What we do not claim', say: 'A third-party SUBJECT token is not simulated: the guide only shows actor tokens, and live it leaves the issued token with no sub. The refusal texts are what PingOne returned; the order it evaluates checks in when several things are wrong is UNVERIFIED. Clock skew (0 to 60 seconds) and maximum future validity are simulated as measured.' },
  { id: 'close', title: 'Close', say: 'Reset clears your workspace and puts the diagram back. Nothing was sent anywhere.' },
];
