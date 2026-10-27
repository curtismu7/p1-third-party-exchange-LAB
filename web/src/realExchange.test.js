import { describe, expect, it } from "vitest";
import { buildRequest, hintFor, inspectToken, parseTokenEndpoint, requestView, trustedIssuerNote, wireItemFor } from "./realExchange";

const ENV = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const host = (tld) => ["auth", "pingone", tld].join(".");
const ep = (tld, path = `/${ENV}/as/token`) => `https://${host(tld)}${path}`;
const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (payload, header = { alg: "RS256", kid: "k1" }) => `${b64(header)}.${b64(payload)}.${"S".repeat(100)}`;

describe("token endpoint validation (strict)", () => {
  it("accepts exactly https://auth.pingone.<region>/<uuid>/as/token for the six regions and reports env and region", () => {
    for (const tld of ["com", "eu", "asia", "ca", "com.au", "sg"]) { const r = parseTokenEndpoint(ep(tld)); expect(r.ok, tld).toBe(true); expect(r.envId).toBe(ENV); expect(r.region).toBe(tld); }
    expect(parseTokenEndpoint(ep("com").toUpperCase().replace("HTTPS", "https")).ok).toBe(false);
    expect(parseTokenEndpoint(`  ${ep("eu")}  `).ok).toBe(true);
  });
  it("refuses hostile hosts, userinfo tricks, ports, http, punycode, path traversal, queries and odd characters", () => {
    const bad = [
      ep("com.evil.example"), `https://${host("com")}.evil.example/${ENV}/as/token`, `https://evil.example/${ENV}/as/token`, `https://evil.example/${host("com")}/${ENV}/as/token`,
      `https://${host("com")}@evil.example/${ENV}/as/token`, `https://${host("com")}:pw@evil.example/${ENV}/as/token`, `https://evil.example\\@${host("com")}/${ENV}/as/token`, `https://evil.example#@${host("com")}/${ENV}/as/token`,
      `https://${host("com")}:8443/${ENV}/as/token`, `https://${host("com")}:443/${ENV}/as/token`, `http://${host("com")}/${ENV}/as/token`, `ftp://${host("com")}/${ENV}/as/token`,
      `https://xn--${host("com")}/${ENV}/as/token`, `https://${host("com")}./${ENV}/as/token`, `https://sub.${host("com")}/${ENV}/as/token`, `https://${host("xx")}/${ENV}/as/token`, `https://${host("COM.evil")}/${ENV}/as/token`,
      ep("com", `/${ENV}/as/../as/token`), ep("com", `/${ENV}/as/token/`), ep("com", `/${ENV}/as/token?x=1`), ep("com", `/${ENV}/as/token#frag`), ep("com", `/${ENV}/as/authorize`), ep("com", "/as/token"), ep("com", `/not-a-uuid/as/token`),
      ep("com", `/${ENV}/as/token%2f..`), ep("com", `//${ENV}/as/token`), `${ep("com")}\n`.replace(/\s+$/, "") + " x", "", "   ", "not a url", "javascript:alert(1)", `https://${host("com")}/${ENV}/as/token\u0000`, `${"a".repeat(400)}`,
    ];
    for (const u of bad) expect(parseTokenEndpoint(u).ok, JSON.stringify(u).slice(0, 80)).toBe(false);
    expect(parseTokenEndpoint(null).ok).toBe(false);
  });
});

describe("request building and secret handling", () => {
  const form = { endpoint: ep("eu"), clientId: "app1", clientSecret: "S3cr3t&v=alue", authStyle: "basic", scope: "p.read", audience: "", subjectToken: "sub.tok.en", subjectType: "urn:ietf:params:oauth:token-type:access_token", actorToken: "act.tok.en", actorType: "urn:ietf:params:oauth:token-type:jwt", extra: "note=hello world" };
  it("builds the RFC 8693 form with the full tokens and the extra parameter", () => {
    const r = buildRequest(form);
    const p = new URLSearchParams(r.body);
    expect(p.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect([p.get("subject_token"), p.get("actor_token"), p.get("scope"), p.get("note")]).toEqual(["sub.tok.en", "act.tok.en", "p.read", "hello world"]);
    expect(r.headers.find(([k]) => k === "Authorization")[1]).toBe(`Basic ${btoa("app1:S3cr3t&v=alue")}`);
    expect(r.body).not.toContain("client_secret");
  });
  it("body style puts client_id and client_secret in the form and sends no Authorization header", () => {
    const r = buildRequest({ ...form, authStyle: "body" });
    expect(new URLSearchParams(r.body).get("client_secret")).toBe("S3cr3t&v=alue");
    expect(r.headers.some(([k]) => k === "Authorization")).toBe(false);
  });
  it("the displayed request and the copied curl redact the secret by default; reveal and include-secret are explicit", () => {
    for (const authStyle of ["basic", "body"]) {
      const r = buildRequest({ ...form, authStyle });
      const v = requestView(r, false);
      for (const text of [v.text, v.curl, v.body]) { expect(text).not.toContain("S3cr3t"); expect(text).not.toContain(btoa("app1:S3cr3t&v=alue")); expect(text).not.toContain(encodeURIComponent("S3cr3t&v=alue")); }
      expect(v.text).toContain(authStyle === "basic" ? "Basic <redacted: client secret is write-only>" : "client_secret=%3Credacted");
      expect(v.text).toContain("sub.tok.en");
      const shown = requestView(r, true);
      expect(shown.text).toContain(authStyle === "basic" ? btoa("app1:S3cr3t&v=alue") : encodeURIComponent("S3cr3t&v=alue"));
      const item = wireItemFor(r, { status: 200, statusText: "OK", headers: [["content-type", "application/json"]], text: "{}" }, { reveal: false, includeSecretInCurl: false });
      expect(JSON.stringify(item)).not.toContain("S3cr3t");
      const withCurl = wireItemFor(r, { status: 200, statusText: "OK", headers: [], text: "{}" }, { reveal: false, includeSecretInCurl: true });
      expect(withCurl.curl).toContain(authStyle === "basic" ? btoa("app1:S3cr3t&v=alue") : encodeURIComponent("S3cr3t&v=alue"));
      expect(withCurl.requestText).not.toContain("S3cr3t");
    }
  });
  it("refuses bad input before anything is built: endpoint, missing fields, extra parameter abuse", () => {
    expect(buildRequest({ ...form, endpoint: "https://evil.example/x" }).error).toBeTruthy();
    expect(buildRequest({ ...form, clientSecret: "" }).error).toBeTruthy();
    expect(buildRequest({ ...form, scope: " " }).error).toBeTruthy();
    expect(buildRequest({ ...form, subjectToken: "" }).error).toBeTruthy();
    for (const extra of ["grant_type=x", "actor_token=x", "client_secret=x", "bad name=x", "__proto__=x", "novalue", Array.from({ length: 11 }, (_, i) => `k${i}=v`).join("\n")]) expect(buildRequest({ ...form, extra }).error, extra).toBeTruthy();
    expect(buildRequest({ ...form, actorToken: "" }).pairs.some(([k]) => k === "actor_token")).toBe(false);
  });
});

describe("token inspector", () => {
  const now = Math.floor(Date.now() / 1000);
  it("reports iss, sub, aud, exp/iat/nbf, kid and x5t, and whether act is an object", () => {
    const i = inspectToken(jwt({ iss: "https://pf.vendor.example", sub: "u", aud: ["a", "b"], exp: now + 600, iat: now, act: { sub: "x" } }));
    expect(i).toMatchObject({ ok: true, iss: "https://pf.vendor.example", sub: "u", aud: ["a", "b"], hasExp: true, hasIat: true, hasNbf: false, kid: "k1", x5t: null, act: "object", expired: false });
    expect(i.notes).toEqual([]);
  });
  it("flags the PingFederate trap (x5t, no kid), a missing or past exp, and act that is text", () => {
    const pf = inspectToken(jwt({ iss: "https://pf.vendor.example", exp: now - 10, act: "{}" }, { alg: "RS256", x5t: "abc" }));
    expect(pf.kid).toBeNull();
    expect(pf.x5t).toBe("abc");
    expect(pf.act).toBe("not an object");
    expect(pf.expired).toBe(true);
    expect(pf.notes.join(" ")).toMatch(/x5t and no kid/);
    expect(pf.notes.join(" ")).toMatch(/exp is in the past/);
    expect(pf.notes.join(" ")).toMatch(/act is not an object/);
    expect(inspectToken(jwt({ iss: "i" })).notes.join(" ")).toMatch(/No exp claim/);
    expect(inspectToken(jwt({ iss: "i", exp: now + 5 }, { alg: "RS256" })).notes.join(" ")).toMatch(/neither kid nor x5t/);
    expect(inspectToken(jwt({ exp: now + 5, act: [] })).act).toBe("not an object");
  });
  it("rejects what is not a JWT and never throws on hostile text", () => {
    for (const t of ["", "x", "a.b", "a.b.c", "{}.{}.{}", "x".repeat(9000), "<script>.<b>.<i>", `${b64([1])}.${b64([2])}.${b64(3)}`]) expect(inspectToken(t).ok, t.slice(0, 20)).toBe(false);
  });
  it("tells you what to configure in PingOne, and maps PingOne's refusal reasons to hints", () => {
    expect(trustedIssuerNote(inspectToken(jwt({ iss: "https://pf.vendor.example/", exp: now + 5 })))).toMatch(/Issuer = https:\/\/pf\.vendor\.example\/ .*\/pf\/JWKS/);
    expect(hintFor(JSON.stringify({ error: "invalid_request", error_description: "The request could not be completed. The request was malformed or invalid.: JWT signature verification failed (Correlation ID: x)" })).hint).toMatch(/publish/i);
    expect(hintFor("{}")).toBeNull();
  });
});
