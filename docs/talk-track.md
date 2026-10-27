# Talk track

<!-- Generated from server/src/exchangeData.js by `npm run talk-track`. Do not edit by hand. -->

## Say first

Everything here is simulated. The tokens, the checks and the issued token are invented by this app. The capability is behind a feature flag and the guide gives no flag name, so check with Ping that it is on in your environment. Northwind Retail is a made-up customer.

## What it does

PingOne token exchange used to accept only tokens from the same environment. With this capability orders-app can present a PingOne user token as the subject and a JWT from another issuer as the actor, with actor_token_type urn:ietf:params:oauth:token-type:jwt. The guide says so (GUIDE); the request shape and the PingOne error texts we show were MEASURED live on 2026-10-27, and the order PingOne evaluates checks in is UNVERIFIED.

## Four steps

Define a trusted issuer, assign it to an OIDC non-worker application, map claims on the custom resource address, then send the exchange. The Setup guide tab has the same steps with every GUIDE and UNVERIFIED label.

## The nbf trap

Pick Okta and turn on nbf required: it is refused with the text PingOne returns (Missing nbf claim), because an Okta token has no nbf. Pick Microsoft and it passes, because Entra tokens carry nbf. The same switch, a different answer, decided by the third-party token.

## Claim mapping

The attribute mapping on the custom resource reads a claim from the actor token. Each vendor names the calling application differently: client_id, azp, cid or appid. If the source claim is absent, the mapped claim is simply missing from the issued token.

## What we do not claim

A third-party SUBJECT token is not simulated: the guide only shows actor tokens, and live it leaves the issued token with no sub. The refusal texts are what PingOne returned; the order it evaluates checks in when several things are wrong is UNVERIFIED. Clock skew (0 to 60 seconds) and maximum future validity are simulated as measured.

## Close

Reset clears your workspace and puts the diagram back. Nothing was sent anywhere.

## The issuers to try

1. **PingFederate: client credentials.** Token 2 of the guide's sample A. A machine identity: the agent app's own PingFederate token. No iat or nbf, only exp.
2. **PingFederate: ID token.** Token 2 of the guide's sample B. A user ID token carrying a custom securityLevel claim.
3. **PingOne (another environment).** The comparison sheet column for a PingOne token from a different environment. Claim set taken from the sheet and the guide's PingOne token 1.
4. **Okta.** Okta access token. Application id is cid, scopes are scp, user id is uid. Has no nbf.
5. **Auth0.** Auth0 access token (its default profile). Application id is azp, no jti, no auth_time. Has no nbf.
6. **RFC 9068 (and Auth0 RFC 9068 profile).** The standard JWT access-token profile. Required: iss, exp, aud, sub, client_id, iat, jti. Auth0 can issue this shape too.
7. **Microsoft v1.0.** Entra ID v1.0 access token. Application id is appid, user object id is oid, jti is uti. Has iat, nbf and exp.
8. **Microsoft v2.0.** Entra ID v2.0 access token. Application id is azp, no amr, jti is uti. Has iat, nbf and exp.
