// The keys that matter in THIS lab's payloads, passed as `hot` to the JsonPane. It already stands out sub, act, aud, scope, client_id,
// azp, iss, cnf, grant_type, the tokens, and error / decision keys; these are the extras.
// Token claims: the three times the trusted issuer's gate reads, and the other names a vendor gives the client id (client_id and azp are default).
export const TOKEN_HOT = ["nbf", "exp", "iat", "cid", "appid"];
// The trusted issuer's switches: they decide which third-party tokens get through.
export const ISSUER_HOT = ["issuer", "trustedIssuer", "expRequired", "iatRequired", "nbfRequired", "audiences", "clockSkew", "maxFutureValidity"];
export const WIRE_HOT = [...TOKEN_HOT, ...ISSUER_HOT];
