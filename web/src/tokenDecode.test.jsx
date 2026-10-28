import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import WireItem from "./components/WireItem";
import RealBrowserTab from "./components/RealBrowserTab";
import { DecodeProvider, DecodeSwitch } from "./components/DecodeContext";
import { claimRows, collapseTokens, describeToken, expBadge, findTokens, jwksFromWire, placeholder, readDecodePref, timeNote, verifyAgainstJwks } from "./tokenDecode";

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const mk = (claims, priv = keys.privateKey, kid = "k1") => { const s = `${b64({ alg: "RS256", typ: "JWT", kid })}.${b64(claims)}`; return `${s}.${sign("RSA-SHA256", Buffer.from(s), priv).toString("base64url")}`; };
const jwks = { keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "k1" }] };
const subject = mk({ iss: "https://p1.example", sub: "user-1", aud: ["https://api.example"], scope: "a.read", exp: now + 3540, iat: now - 60, auth_time: now - 120 });
const actor = mk({ iss: "https://okta.example", sub: "cc", exp: now - 120, nbf: now + 30 });
const issued = mk({ act: { sub: "app" }, sub: "user-1" }, other.privateKey, "mock-p1-key");
const form = (o) => new URLSearchParams(o).toString();
const item = (over = {}) => ({
  n: 3, id: "w3", key: "exchange", label: "Token exchange", phase: "runtime", method: "POST", url: "https://auth.pingone.example/x/as/token", notes: "n", evidence: "measured", status: 200, statusText: "OK",
  requestHeaders: [{ name: "Host", value: "h" }, { name: "Authorization", value: "Basic abc" }], responseHeaders: [{ name: "Cache-Control", value: "no-store" }],
  requestBody: form({ grant_type: "x", subject_token: subject, actor_token: actor }), responseBody: JSON.stringify({ access_token: issued, token_type: "Bearer" }),
  curl: `curl -d 'subject_token=${subject}'`, requestText: `POST /x HTTP/1.1\n\n${form({ subject_token: subject, actor_token: actor })}`, responseText: `HTTP/1.1 200 OK\n\n${JSON.stringify({ access_token: issued }, null, 2)}`, ...over,
});
const ev = { measured: { label: "MEASURED", note: "n" } };

describe("finding and decoding tokens", () => {
  it("finds every token in a run: urlencoded request fields, JSON response fields, header values and stray strings, with where-labels", () => {
    const f = findTokens(item({ requestHeaders: [{ name: "Authorization", value: `Bearer ${subject}` }] }));
    expect(f.map((x) => x.where)).toEqual(expect.arrayContaining(["request header Authorization", "request.subject_token", "request.actor_token", "response.access_token"]));
    const nested = findTokens({ requestBody: "", responseBody: JSON.stringify({ a: { b: [{ id_token: subject }] } }) });
    expect(nested.map((x) => x.where)).toEqual(["response.a.b.0.id_token"]);
    expect(findTokens({ requestBody: "plain text", responseBody: `see ${actor} here` })[0].where).toBe("response body");
    expect(findTokens({ requestBody: "", responseBody: "{}" })).toEqual([]);
  });
  it("decodes every token of a run; claims table has ISO time and relative notes, highlights act, sub, aud, scope, iss", () => {
    for (const t of findTokens(item())) { const d = describeToken(t.token, now); expect(d.ok, t.where).toBe(true); }
    const d = describeToken(subject, now);
    const rows = Object.fromEntries(d.rows.map((r) => [r.claim, r]));
    expect(rows.exp.note).toMatch(/^\d{4}-\d\d-\d\dT.*Z \(in 59 min\)$/);
    expect(rows.iat.note).toMatch(/\(1 min ago\)$/);
    expect(rows.auth_time.note).toMatch(/\(2 min ago\)$/);
    expect(d.rows.slice(0, 4).map((r) => r.claim)).toEqual(["iss", "sub", "aud", "scope"]);
    expect(d.rows.filter((r) => r.highlight).map((r) => r.claim).sort()).toEqual(["aud", "iss", "scope", "sub"]);
    expect(describeToken(issued, now).rows[0]).toMatchObject({ claim: "sub" });
    expect(describeToken(issued, now).rows.find((r) => r.claim === "act")).toMatchObject({ highlight: true, value: '{"sub":"app"}' });
  });
  it("exp badge: valid, expired, none; time notes are plain English and tolerate nonsense", () => {
    expect(expBadge({ exp: now + 3540 }, now)).toEqual({ state: "valid", text: "valid, expires in 59 min" });
    expect(expBadge({ exp: now - 120 }, now)).toEqual({ state: "expired", text: "expired 2 min ago" });
    expect(expBadge({}, now).state).toBe("none");
    expect(expBadge({ exp: "soon" }, now).state).toBe("none");
    expect(timeNote("exp", now - 3 * 86400, now)).toMatch(/expired 3 days ago/);
    expect(timeNote("nbf", now + 30, now)).toMatch(/in 30 s/);
    expect(timeNote("exp", 1e20, now)).toBe("not a valid time");
    expect(timeNote("exp", "x", now)).toBe("not a valid time");
  });
  it("malformed input never throws: not a valid JWT, base64url with or without padding, oversized, hostile claims", () => {
    for (const t of ["eyJ.eyJ.x", "eyJhbGciOiJub25lIn0.!!!.x", `${b64([1])}.${b64([2])}.x`, "a.b", "x".repeat(9000), "<script>alert(1)</script>"]) expect(describeToken(t, now).ok, t.slice(0, 20)).toBe(false);
    const padded = `${Buffer.from('{"alg":"RS256"}').toString("base64")}.${Buffer.from('{"sub":"é✓"}').toString("base64")}.sig`;
    expect(describeToken(padded, now)).toMatchObject({ ok: true, payload: { sub: "é✓" } });
    const evil = describeToken(mk({ "__proto__": { x: 1 }, constructor: "c", a: "x".repeat(5000), n: { d: { e: { f: { g: 1 } } } } }), now);
    expect(evil.ok).toBe(true);
    expect(({}).x).toBeUndefined();
    expect(findTokens({ requestBody: "{".repeat(100000), responseBody: JSON.stringify(Array.from({ length: 5 }, () => ({ a: [[[[[[[[subject]]]]]]]] }))) })).toBeDefined();
  });
  it("signature: verifies for real against the JWKS, fails for another key, reports other-key and unchecked states", async () => {
    const sub = webcrypto.subtle;
    expect((await verifyAgainstJwks(subject, jwks, sub)).state).toBe("verified");
    expect((await verifyAgainstJwks(issued, jwks, sub)).state).toBe("other-key");
    expect((await verifyAgainstJwks(mk({ a: 1 }, other.privateKey, "k1"), jwks, sub)).state).toBe("failed");
    const [h, p, s] = subject.split(".");
    expect((await verifyAgainstJwks(`${h}.${b64({ sub: "attacker" })}.${s}`, jwks, sub)).state).toBe("failed");
    expect((await verifyAgainstJwks(subject, null, sub)).text).toBe("signature not checked here");
    expect((await verifyAgainstJwks(subject, jwks, null)).state).toBe("unchecked");
    expect((await verifyAgainstJwks("garbage", jwks, sub)).state).toBe("unchecked");
    expect(p).toBeTruthy();
  });
  it("jwksFromWire reads the inline JWKS of the trusted-issuer call, and the collapse placeholder never drops the raw text elsewhere", () => {
    const j = jwksFromWire([{ key: "issuer", requestBody: JSON.stringify({ jwks: JSON.stringify(jwks) }) }]);
    expect(j.keys[0].kid).toBe("k1");
    expect(jwksFromWire([{ key: "issuer", requestBody: "not json" }, { key: "other" }])).toBeNull();
    const toks = findTokens(item());
    const text = item().requestText;
    const short = collapseTokens(text, toks);
    expect(short).toContain(placeholder(subject));
    expect(short).not.toContain(subject);
    expect(text).toContain(subject);
    expect(placeholder(subject)).toMatch(/^eyJhbGci…\(\d+ chars, shown decoded below\)$/);
    expect(claimRows({ a: 1 }, now)).toHaveLength(1);
  });
});

describe("inline decoding in the wire views", () => {
  beforeEach(() => { try { window.localStorage.clear(); } catch { /* none */ } });
  const renderItem = (it = item(), j = jwks) => render(<DecodeProvider><DecodeSwitch /><WireItem item={it} evidence={ev} open jwks={j} /></DecodeProvider>);

  it("ON by default: each token is decoded under the body with claims, exp badge and a real signature verdict; the on-screen body is collapsed", async () => {
    renderItem();
    const cards = await screen.findAllByTestId("decoded-token");
    expect(cards).toHaveLength(3);
    const sub = cards.find((c) => c.dataset.where === "request.subject_token");
    expect(within(sub).getByTestId("exp-badge")).toHaveTextContent(/valid, expires in 59 min/);
    expect(within(sub).getByTestId("claims-table")).toHaveTextContent("user-1");
    await waitFor(() => expect(within(sub).getByTestId("sig-badge")).toHaveTextContent(/verifies against the JWKS/));
    const act = cards.find((c) => c.dataset.where === "request.actor_token");
    expect(within(act).getByTestId("exp-badge")).toHaveTextContent(/expired 2 min ago/);
    const iss = cards.find((c) => c.dataset.where === "response.access_token");
    await waitFor(() => expect(within(iss).getByTestId("sig-badge")).toHaveTextContent(/not in the JWKS/));
    expect(screen.getByTestId("wire-exchange-request").textContent).toContain("shown decoded below");
    expect(screen.getByTestId("wire-exchange-request").textContent).not.toContain(subject);
    expect(screen.getByTestId("wire-exchange-response").textContent).not.toContain(issued);
  });
  it("show raw restores the full string on screen; Copy buttons always copy the full raw text; copy decoded payload copies the pretty payload", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderItem();
    await userEvent.click(screen.getByTestId("raw-exchange"));
    expect(screen.getByTestId("wire-exchange-request").textContent).toContain(subject);
    await userEvent.click(screen.getByTestId("raw-exchange"));
    await userEvent.click(screen.getByRole("button", { name: "Copy request" }));
    expect(writeText).toHaveBeenLastCalledWith(item().requestText);
    expect(writeText.mock.calls.at(-1)[0]).toContain(subject);
    await userEvent.click(screen.getByRole("button", { name: "Copy curl" }));
    expect(writeText.mock.calls.at(-1)[0]).toContain(subject);
    await userEvent.click(screen.getByRole("button", { name: "Copy response" }));
    expect(writeText.mock.calls.at(-1)[0]).toContain(issued);
    const cards = screen.getAllByTestId("decoded-token");
    await userEvent.click(within(cards[0]).getAllByRole("button", { name: "Copy token" })[0]);
    expect(findTokens(item()).map((t) => t.token)).toContain(writeText.mock.calls.at(-1)[0]);
    await userEvent.click(within(cards[0]).getByRole("button", { name: "Copy decoded payload" }));
    expect(JSON.parse(writeText.mock.calls.at(-1)[0])).toBeTypeOf("object");
  });
  it("a malformed token shows 'not a valid JWT' with the raw string; the per-call toggle hides the decoding; the global switch is remembered", async () => {
    renderItem(item({ responseBody: JSON.stringify({ access_token: "eyJabcdef.eyJabcdef.zz" }), requestBody: "", requestText: "POST /x" }));
    expect(await screen.findByText("not a valid JWT")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("decode-exchange"));
    expect(screen.queryByTestId("decoded")).toBeNull();
    await userEvent.click(screen.getByTestId("decode-exchange"));
    expect(screen.getByTestId("decoded")).toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId("decode-switch")).getByRole("checkbox"));
    expect(window.localStorage.getItem("p1tpx.decode")).toBe("0");
    expect(readDecodePref()).toBe(false);
  });
  it("a missing or blocked localStorage does not break the switch or the decoding", async () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    try {
      renderItem();
      expect(await screen.findAllByTestId("decoded-token")).toHaveLength(3);
      await userEvent.click(within(screen.getByTestId("decode-switch")).getByRole("checkbox"));
      expect(screen.queryByTestId("decoded")).toBeNull();
      expect(readDecodePref()).toBe(true);
    } finally { Object.defineProperty(window, "localStorage", real); }
  });
  it("starts OFF when the remembered preference is off", () => {
    window.localStorage.setItem("p1tpx.decode", "0");
    renderItem();
    expect(screen.queryByTestId("decoded")).toBeNull();
    expect(screen.getByTestId("wire-exchange-request").textContent).toContain(subject);
  });
});

describe("Real exchange (your browser): no secret or token goes anywhere but the typed PingOne endpoint", () => {
  const host = ["auth", "pingone", "com"].join(".");
  const ENV = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
  const SECRET = ["browser", "probe", "value"].join("-");
  const fill = async () => {
    await userEvent.type(screen.getByTestId("rb-endpoint"), `https://${host}/${ENV}/as/token`);
    await userEvent.type(screen.getByTestId("rb-client"), "app1");
    await userEvent.type(screen.getByTestId("rb-secret"), SECRET);
    await userEvent.type(screen.getByTestId("rb-scope"), "p.read");
    await userEvent.click(screen.getByTestId("rb-subject")); await userEvent.paste(subject);
    await userEvent.click(screen.getByTestId("rb-actor")); await userEvent.paste(actor);
  };
  const reply = (status, body, headers = { "content-type": "application/json" }) => new Response(body, { status, headers });
  // The tab asks THIS server once for an optional local prefill; every other fetch goes to `inner` (the PingOne send).
  const PREFILL = "/api/real-prefill";
  const route = (inner, prefill = reply(404, "{}")) => vi.fn((url, init) => (url === PREFILL ? Promise.resolve(prefill.clone()) : inner(url, init)));

  it("sends ONE fetch to the typed endpoint (cors, no credentials, no redirect), shows the redacted request and the full response, decodes the access token", async () => {
    const calls = [];
    globalThis.fetch = route(async (url, init) => { calls.push([url, init]); return reply(200, JSON.stringify({ access_token: issued, token_type: "Bearer" })); });
    const storageSet = vi.spyOn(Storage.prototype, "setItem");
    render(<DecodeProvider><RealBrowserTab resetSignal={0} /></DecodeProvider>);
    expect(screen.getByTestId("real-browser-banner")).toHaveTextContent("REAL: this sends a real request from your browser to your PingOne. Nothing goes through this server.");
    await fill();
    expect(screen.getByTestId("rb-parsed")).toHaveTextContent(`Environment ${ENV}, region com`);
    expect(screen.getByTestId("rb-send-btn")).toBeDisabled();
    await userEvent.click(screen.getByTestId("rb-confirm"));
    await userEvent.click(screen.getByTestId("rb-send-btn"));
    await screen.findByTestId("rb-result");
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`https://${host}/${ENV}/as/token`);
    expect([init.mode, init.credentials, init.redirect, init.method]).toEqual(["cors", "omit", "manual", "POST"]);
    expect(init.signal).toBeTruthy();
    expect(init.headers.Authorization).toBe(`Basic ${btoa(`app1:${SECRET}`)}`);
    expect(new URLSearchParams(init.body).get("actor_token")).toBe(actor);
    const shown = document.body.textContent;
    expect(shown).not.toContain(SECRET);
    expect(shown).not.toContain(btoa(`app1:${SECRET}`));
    expect(screen.getByTestId("wire-browser-exchange-request")).toHaveTextContent("Basic <redacted: client secret is write-only>");
    expect(screen.getByTestId("rb-issued-raw").textContent).toBe(issued);
    expect(storageSet.mock.calls.every(([k, v]) => !String(v).includes(SECRET) && !String(k).includes("secret"))).toBe(true);
    await userEvent.click(screen.getByTestId("rb-reveal"));
    expect(screen.getByTestId("wire-browser-exchange-request")).toHaveTextContent(btoa(`app1:${SECRET}`));
    storageSet.mockRestore();
  });
  it("a PingOne refusal shows the status, the body and a hint; a blocked fetch explains CORS and the network; a bad endpoint never fetches", async () => {
    const f = vi.fn();
    globalThis.fetch = route(f);
    f.mockResolvedValueOnce(reply(400, JSON.stringify({ error: "invalid_request", error_description: "The request could not be completed. The request was malformed or invalid.: JWT signature verification failed (Correlation ID: x)" })));
    render(<DecodeProvider><RealBrowserTab resetSignal={0} /></DecodeProvider>);
    await fill(); await userEvent.click(screen.getByTestId("rb-confirm")); await userEvent.click(screen.getByTestId("rb-send-btn"));
    expect(await screen.findByTestId("rb-hint")).toHaveTextContent(/publish/i);
    expect(screen.getByTestId("wire-browser-exchange-response")).toHaveTextContent("HTTP 400");
    f.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await userEvent.click(screen.getByTestId("rb-send-btn"));
    expect(await screen.findByTestId("rb-error")).toHaveTextContent(/CORS or the network/);
    expect(f).toHaveBeenCalledTimes(2);
    await userEvent.clear(screen.getByTestId("rb-endpoint"));
    await userEvent.type(screen.getByTestId("rb-endpoint"), "https://evil.example/x");
    expect(screen.getByTestId("rb-send-btn")).toBeDisabled();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("Reset and leaving the tab clear the secret and the tokens", async () => {
    globalThis.fetch = route(vi.fn());
    const { rerender, unmount } = render(<DecodeProvider><RealBrowserTab resetSignal={0} /></DecodeProvider>);
    await fill();
    expect(screen.getByTestId("rb-secret")).toHaveValue(SECRET);
    rerender(<DecodeProvider><RealBrowserTab resetSignal={1} /></DecodeProvider>);
    expect(screen.getByTestId("rb-secret")).toHaveValue("");
    expect(screen.getByTestId("rb-subject")).toHaveValue("");
    unmount();
    render(<DecodeProvider><RealBrowserTab resetSignal={0} /></DecodeProvider>);
    expect(screen.getByTestId("rb-secret")).toHaveValue("");
    expect(globalThis.fetch.mock.calls.every(([u]) => u === PREFILL)).toBe(true);
  });
  it("a local prefill fills the form (never the secret) and Reset re-applies it; a hosted 404 leaves it empty", async () => {
    globalThis.fetch = route(vi.fn(), reply(200, JSON.stringify({ endpoint: `https://${host}/${ENV}/as/token`, clientId: "app9", scope: "p.read", actorType: "urn:ietf:params:oauth:token-type:jwt" })));
    const { rerender } = render(<DecodeProvider><RealBrowserTab resetSignal={0} /></DecodeProvider>);
    await waitFor(() => expect(screen.getByTestId("rb-client")).toHaveValue("app9"));
    expect(screen.getByTestId("rb-scope")).toHaveValue("p.read");
    expect(screen.getByTestId("rb-parsed")).toHaveTextContent(`Environment ${ENV}`);
    expect(screen.getByTestId("rb-secret")).toHaveValue("");
    await userEvent.type(screen.getByTestId("rb-secret"), SECRET);
    rerender(<DecodeProvider><RealBrowserTab resetSignal={1} /></DecodeProvider>);
    expect(screen.getByTestId("rb-secret")).toHaveValue("");
    await waitFor(() => expect(screen.getByTestId("rb-client")).toHaveValue("app9"));
  });
  it("without a prefill (hosted 404) the form starts empty", async () => {
    globalThis.fetch = route(vi.fn());
    render(<DecodeProvider><RealBrowserTab resetSignal={0} /></DecodeProvider>);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.getByTestId("rb-client")).toHaveValue("");
    expect(screen.getByTestId("rb-endpoint")).toHaveValue("");
  });
});
