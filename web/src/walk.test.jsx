import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import FontSize, { readFontSize } from "./components/FontSize";

const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (c, kid = "mock-key") => `${b64({ alg: "RS256", typ: "JWT", kid })}.${b64(c)}.${"S".repeat(342)}`;
const now = Math.floor(Date.now() / 1000);
const EV = { measured: { label: "MEASURED", note: "m" }, guide: { label: "GUIDE", note: "g" }, sample: { label: "SAMPLE", note: "s" }, derived: { label: "OUR CHOICE", note: "d" }, unverified: { label: "UNVERIFIED", note: "u" } };
const VENDORS = [{ id: "pf-cc", name: "PingFederate: client credentials", evidence: "guide", issuer: "https://pf.vendor.example:9031", note: "Sample A.", mappings: [] }, { id: "okta", name: "Okta", evidence: "sample", issuer: "https://okta.example/x", note: "Okta token. Has no nbf.", mappings: [] }];
const CONFIG = { intro: "intro", banner: "SIMULATED: a mock", hosted: false, tokenLabel: "MOCK", evidence: EV, vendors: VENDORS, verticals: ["retail"], cast: { castApp: "orders-app" },
  tokenStates: [{ id: "valid", label: "Valid" }, { id: "expired", label: "Expired" }], defaults: { expRequired: true, iatRequired: false, nbfRequired: false, audiences: "", clockSkew: 0, maxFutureValidity: 0, assigned: true },
  steps: [], notShown: [], talkTrack: ["idea", "issuer", "trust", "send", "result", "compare", "know"].map((id) => ({ id, title: `T ${id}`, say: `Say ${id}` })) };
const item = (n, key, phase = "runtime", extra = {}) => ({ n, id: `w${n}`, key, label: key, phase, method: "POST", url: "https://auth.pingone.example/x", requestHeaders: [{ name: "Host", value: "h" }], requestBody: "a=b", requestBodyPretty: '{\n  "name": "issuer"\n}', curl: "curl x", status: 200, statusText: "OK", responseHeaders: [], responseBody: "{}", responseBodyPretty: "{}", requestText: `POST /x\n\na=b`, responseText: "HTTP/1.1 200 OK", notes: "n", evidence: "measured", ...extra });
function runFor(body) {
  const nbfFail = body.settings.nbfRequired && body.vendorId === "okta";
  const failed = !body.assigned ? { id: "assigned", label: "Trusted issuer is assigned to the application" } : nbfFail ? { id: "nbf", label: "nbf present and reached" } : null;
  const actor = jwt({ iss: body.vendorId === "okta" ? "https://okta.example/x" : "https://pf.vendor.example:9031", sub: "cc", exp: now + 3000 });
  return { ok: !failed, failed, checks: [{ id: "a", label: "Check A", ok: !failed, detail: "d" }], vendor: { id: body.vendorId, name: body.vendorId }, mapping: [{ id: "m", label: "act.sub from cid", evidence: "derived", note: "n", source: "cid", present: true }],
    jwks: JSON.stringify({ keys: [] }), runId: "0123456789abcdef", jwts: { subject: jwt({ sub: "u" }), actor, issued: failed ? null : jwt({ act: { sub: "app" } }, "mock-p1-key") },
    error: failed ? { status: 400, error: "invalid_request", error_description: "Missing nbf claim" } : null, signature: { ok: true, reason: "r" }, traceId: "a".repeat(32), hops: [],
    setup: [item(1, "issuer", "setup", { requestBodyPretty: `{\n  "nbfRequired": ${body.settings.nbfRequired}\n}` })], wire: [item(10, "cc"), item(11, "vendor-token"), item(12, "exchange")] };
}
let calls;
beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* none */ }
  document.documentElement.style.fontSize = "";
  window.location.hash = "";
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push(url);
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (url.startsWith("/api/vendors")) return json(CONFIG);
    if (url === "/api/info") return json({ mode: "mock", simulated: true, hosted: false });
    if (url === "/api/exchange") return json(runFor(JSON.parse(opts.body)));
    if (url === "/api/compare") return json({ columns: ["PingOne"], rows: [["Issuer", "iss"]], note: "n", evidence: EV.sample });
    if (url === "/api/setup") return json({ markdown: "# x", steps: [], adminFacts: [["Permissions", "Environment Admin"]], apiSamples: { trustedIssuer: {}, assignment: {} }, notShown: ["Third-party SUBJECT"] });
    if (url.startsWith("/api/diagram")) return json({ schema: "diagram-studio/1", id: "d", title: "Accepted", lede: "l", groups: {}, nodes: [{ id: "a", label: "Application", group: "actor", x: 0, y: 0 }, { id: "b", label: "PingOne", group: "gateway", x: 300, y: 0 }], edges: [{ source: "a", target: "b", label: "x" }], steps: [{ title: "T", what: "w", why: "y", edges: [0] }] });
    if (url.startsWith("/api/wire")) return json({ runId: "0123456789abcdef", setup: [], wire: [] });
    if (url === "/api/reset") return json({ reset: "ok" });
    return json({}, 404);
  });
});
const ready = async () => { render(<App />); await screen.findByTestId("walk-heading"); };

describe("Guided walk", () => {
  it("is the landing page: step 1 with kicker, heading, before/now and four cards; the advanced tools are tucked under Advanced", async () => {
    await ready();
    expect(screen.getByTestId("kicker")).toHaveTextContent("Step 1 of 7 · ~1 min");
    expect(screen.getByTestId("walk-heading")).toHaveTextContent("Let PingOne trust a token it didn't issue");
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(within(screen.getByTestId("four-steps")).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Trust", "Assign", "Map", "Send"]);
    expect(screen.getByText(/Why you care/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Guided walk" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Wire" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(await screen.findByRole("tab", { name: "Wire" })).toBeInTheDocument();
    for (const n of ["Exchange lab", "Diagram", "Claims compared", "Setup guide", "Admin and limits", "Talk track", "Real exchange (your browser)"]) expect(screen.getByRole("tab", { name: n })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Live" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Real exchange (local)" })).toBeNull();
    expect(screen.getByTestId("banner")).toBeVisible();
  });
  it("has seven steps with the right kickers, reachable with Next and Back; Next becomes Start over on the last step", async () => {
    await ready();
    const titles = [];
    for (let n = 1; n <= 7; n++) {
      expect(screen.getByTestId("kicker").textContent).toMatch(new RegExp(`^Step ${n} of 7 · ~\\d min$`));
      titles.push(screen.getByTestId("walk-heading").textContent);
      if (n < 7) await userEvent.click(screen.getByTestId("walk-next"));
    }
    expect(new Set(titles).size).toBe(7);
    expect(screen.getByTestId("walk-next")).toHaveTextContent("Start over");
    await userEvent.click(screen.getByTestId("walk-back"));
    expect(screen.getByTestId("kicker")).toHaveTextContent("Step 6 of 7");
    await userEvent.click(screen.getByTestId("walk-next")); await userEvent.click(screen.getByTestId("walk-next"));
    expect(screen.getByTestId("kicker")).toHaveTextContent("Step 1 of 7");
    expect(screen.getByTestId("walk-back")).toBeDisabled();
  });
  it("step 2 shows the issuer chips, the sample token RAW in full and DECODED, and the inline-decode switch hides the decoding", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("rail-2"));
    expect(await screen.findAllByRole("radio")).toHaveLength(2);
    const card = await screen.findByTestId("decoded-token");
    expect(within(card).getByTestId("decoded-raw").textContent.split(".")).toHaveLength(3);
    expect(within(card).getByTestId("claims-table")).toHaveTextContent("https://pf.vendor.example:9031");
    expect(within(card).getByTestId("exp-badge")).toHaveTextContent(/valid, expires in/);
    await userEvent.click(within(screen.getByTestId("decode-switch")).getByRole("checkbox"));
    expect(screen.queryByTestId("decoded-token")).toBeNull();
    expect(screen.getByTestId("walk-raw-token").textContent.split(".")[2]).toHaveLength(342);
  });
  it("choices are shared state: the issuer and a switch chosen in the walk are what the Exchange lab sends, and the verdict follows", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("rail-2"));
    await userEvent.click(screen.getByTestId("walk-vendor-okta"));
    await userEvent.click(screen.getByTestId("rail-3"));
    await userEvent.click(screen.getByTestId("walk-nbf"));
    await waitFor(() => expect(screen.getByTestId("walk-issuer-body").textContent).toContain('"nbfRequired": true'));
    expect(screen.getByTestId("walk-state-valid")).toBeChecked();
    await userEvent.click(screen.getByTestId("rail-5"));
    expect(await screen.findByTestId("verdict")).toHaveAttribute("data-ok", "false");
    expect(screen.getByTestId("walk-heading")).toHaveTextContent("PingOne refused it");
    expect(screen.getByTestId("error-body")).toHaveTextContent("Missing nbf claim");
    await userEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Exchange lab" }));
    expect(screen.getByTestId("vendor-okta")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("nbf")).toBeChecked();
    await userEvent.click(screen.getByRole("tab", { name: "Guided walk" }));
    expect(screen.getByTestId("kicker")).toHaveTextContent("Step 5 of 7");
  });
  it("step 4 has the diagram, the full exchange request and a disclosure listing every API call; step 5 shows the issued token raw and decoded", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("rail-4"));
    expect(await screen.findByText("Application")).toBeInTheDocument();
    expect(await screen.findByTestId("wire-exchange")).toBeInTheDocument();
    const d = await screen.findByTestId("all-calls");
    expect(d).toHaveTextContent("Show all 4 API calls");
    d.open = true; fireEvent(d, new Event("toggle"));
    await waitFor(() => expect(within(d).getByTestId("wire-issuer")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("rail-5"));
    expect(await screen.findByTestId("verdict")).toHaveAttribute("data-ok", "true");
    expect((await screen.findAllByTestId("decoded-token")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("maps")).toBeInTheDocument();
    expect(screen.getByTestId("checks")).toBeInTheDocument();
  });
  it("step 7 offers the browser tab, and the local tab only when live is on; in a hosted/mock build there is no Live and no local-real option", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("rail-7"));
    expect(await screen.findByTestId("try-browser")).toBeInTheDocument();
    expect(screen.queryByTestId("try-local")).toBeNull();
    await userEvent.click(screen.getByTestId("try-browser"));
    expect(await screen.findByTestId("real-browser-tab")).toBeInTheDocument();
  });
  it("step 7 offers the local tab in the live build", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u, o) => (u === "/api/info" ? { ok: true, status: 200, json: async () => ({ mode: "live", simulated: true, hosted: false, live: { requested: true, enabled: true, reasons: [] } }) } : orig(u, o)));
    window.location.hash = "#walk=7";
    render(<App />);
    expect(await screen.findByTestId("try-local")).toBeInTheDocument();
  });
  it("deep link #walk=3 opens step 3 and the hash follows the step; a bad number falls back to step 1", async () => {
    window.location.hash = "#walk=3";
    const { unmount } = render(<App />);
    expect(await screen.findByTestId("kicker")).toHaveTextContent("Step 3 of 7");
    await userEvent.click(screen.getByTestId("walk-next"));
    expect(window.location.hash).toBe("#walk=4");
    unmount();
    for (const h of ["#walk=9", "#walk=0", "#walk=x", "#walk=3;alert(1)"]) { window.location.hash = h; const r = render(<App />); await screen.findByTestId("walk-heading"); expect(screen.getByTestId("kicker")).toHaveTextContent("Step 1 of 7"); r.unmount(); }
  });
  it("keyboard: arrows move between steps unless focus is in an input; focus moves to the new heading", async () => {
    await ready();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("kicker")).toHaveTextContent("Step 2 of 7"));
    await waitFor(() => expect(screen.getByTestId("walk-heading")).toHaveFocus());
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByTestId("kicker")).toHaveTextContent("Step 1 of 7"));
    await userEvent.click(screen.getByTestId("rail-3"));
    const input = screen.getByTestId("walk-aud");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getByTestId("kicker")).toHaveTextContent("Step 3 of 7");
    fireEvent.keyDown(document.body, { key: "ArrowLeft", ctrlKey: true });
    expect(screen.getByTestId("kicker")).toHaveTextContent("Step 3 of 7");
  });
  it("presenter mode keeps working and shows the walk with its talk-track beat; the banner stays", async () => {
    await ready();
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("Say idea");
    expect(screen.getByTestId("walk")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("walk-next"));
    expect(screen.getByTestId("presenter-say")).toHaveTextContent("Say issuer");
    expect(screen.getByTestId("banner")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
  });
  it("the rail marks done and current steps", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("rail-3"));
    expect(screen.getByTestId("rail-1")).toHaveClass("done");
    expect(screen.getByTestId("rail-3")).toHaveClass("on");
    expect(screen.getByTestId("rail-3")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("rail-4")).not.toHaveClass("done");
  });
});

describe("text size control", () => {
  it("steps 80 to 170 in tens, disables at the limits, scales the root, announces the percentage, resets", async () => {
    render(<FontSize />);
    const out = screen.getByTestId("fs-value");
    expect(out).toHaveTextContent("100%");
    expect(out).toHaveAttribute("aria-live", "polite");
    for (let i = 0; i < 7; i++) await userEvent.click(screen.getByTestId("fs-up"));
    expect(out).toHaveTextContent("170%");
    expect(document.documentElement.style.fontSize).toBe("170%");
    expect(screen.getByTestId("fs-up")).toBeDisabled();
    for (let i = 0; i < 9; i++) await userEvent.click(screen.getByTestId("fs-down"));
    expect(out).toHaveTextContent("80%");
    expect(screen.getByTestId("fs-down")).toBeDisabled();
    expect(document.documentElement.style.fontSize).toBe("80%");
    await userEvent.click(screen.getByTestId("fs-reset"));
    expect(out).toHaveTextContent("100%");
    expect(document.documentElement.style.fontSize).toBe("100%");
  });
  it("is remembered, ignores junk in storage, and a blocked localStorage does not break it", async () => {
    window.localStorage.setItem("p1tpx.fontsize", "130");
    const { unmount } = render(<FontSize />);
    expect(screen.getByTestId("fs-value")).toHaveTextContent("130%");
    await userEvent.click(screen.getByTestId("fs-up"));
    expect(window.localStorage.getItem("p1tpx.fontsize")).toBe("140");
    unmount();
    for (const junk of ["5", "999", "abc", "135", "-10"]) { window.localStorage.setItem("p1tpx.fontsize", junk); expect(readFontSize(), junk).toBe(100); }
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    try {
      render(<FontSize />);
      expect(screen.getByTestId("fs-value")).toHaveTextContent("100%");
      await userEvent.click(screen.getByTestId("fs-up"));
      expect(screen.getByTestId("fs-value")).toHaveTextContent("110%");
    } finally { Object.defineProperty(window, "localStorage", real); }
  });
  it("is in the header of the app on every tab", async () => {
    await ready();
    expect(screen.getByTestId("fontctl")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByTestId("fontctl")).toBeVisible();
  });
});
