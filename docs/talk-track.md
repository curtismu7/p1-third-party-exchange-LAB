# Talk track

<!-- Generated from server/src/exchangeData.js by `npm run talk-track`. Do not edit by hand. -->

## The idea

Everything here is simulated: the tokens, the checks and the issued token are invented by this app. Northwind Retail is a made-up customer. PingOne token exchange used to accept only tokens from the same environment. Now orders-app can present a PingOne user token as the subject and a JWT from another issuer as the actor, with actor_token_type urn:ietf:params:oauth:token-type:jwt. The capability is behind a feature flag and the guide gives no flag name, so check with Ping that it is on in your environment. Four things to set up: trust, assign, map, send.

## Pick an issuer

Pick PingFederate, another PingOne environment, Okta, Auth0, an RFC 9068 issuer or Microsoft. The sample token is shown whole and decoded: a real RS256 JWT signed by a mock key. Notice which time claims it has. The guide labels the first two samples GUIDE; the rest are vendor samples (SAMPLE).

## Set the trust

The admin defines a trusted issuer (its inline JWKS, which claims must be present, clock skew up to 60 seconds, maximum future validity, audiences) and assigns it to an OIDC non-worker application. The request body on screen is the real POST /trustedIssuers. The nbf trap: pick Okta and turn on nbf required: it is refused, because an Okta token has no nbf. Microsoft passes, because Entra tokens carry nbf.

## Send it

One request. Walk the sequence: the app gets a PingOne token, gets the third-party token, sends both, PingOne verifies the actor signature against the trusted issuer keys and runs its checks, then reads the attribute mapping on the custom resource address. Every call is shown whole on the Wire tab, with a curl for each. The request shape was measured live; the order PingOne evaluates checks in is UNVERIFIED.

## Read the result

Success gives a PingOne token with the mapped claim, for example act.sub from the actor sub. A refusal shows PingOne's own text, measured live (HTTP 400 invalid_request), with a fake Correlation ID. If the source claim is absent the mapped claim is simply missing, and the token is still issued.

## Compare

The calling application has a different claim name at each issuer: client_id, azp, cid or appid. That is the claim you map into act.sub, so it is the one to check first.

## What to know

A third-party SUBJECT token is not simulated: the guide only shows actor tokens, and live it leaves the issued token with no sub. Clock skew (0 to 60 seconds) and maximum future validity are simulated as measured. To try it for real: Real exchange (your browser) works in every build and sends from your own browser to your own PingOne, nothing through this server; Real exchange (local) and the Live mode exist only on the owner's machine and write to a real environment. Your PingFederate token works as the third-party token if PingOne trusts its issuer and the PingFederate access token manager publishes its keys. Reset clears your workspace and puts the diagram back.

## The issuers to try

1. **PingFederate: client credentials.** Token 2 of the guide's sample A. A machine identity: the agent app's own PingFederate token. No iat or nbf, only exp.
2. **PingFederate: ID token.** Token 2 of the guide's sample B. A user ID token carrying a custom securityLevel claim.
3. **PingOne (another environment).** The comparison sheet column for a PingOne token from a different environment. Claim set taken from the sheet and the guide's PingOne token 1.
4. **Okta.** Okta access token. Application id is cid, scopes are scp, user id is uid. Has no nbf.
5. **Auth0.** Auth0 access token (its default profile). Application id is azp, no jti, no auth_time. Has no nbf.
6. **RFC 9068 (and Auth0 RFC 9068 profile).** The standard JWT access-token profile. Required: iss, exp, aud, sub, client_id, iat, jti. Auth0 can issue this shape too.
7. **Microsoft v1.0.** Entra ID v1.0 access token. Application id is appid, user object id is oid, jti is uti. Has iat, nbf and exp.
8. **Microsoft v2.0.** Entra ID v2.0 access token. Application id is azp, no amr, jti is uti. Has iat, nbf and exp.
