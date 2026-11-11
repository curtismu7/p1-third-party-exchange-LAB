import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { BANNER_UNKNOWN, TABS } from "./App";
import { labelOffsets } from "./components/PatternDiagram";
import { diagramQuery } from "./components/DiagramTab";
import { fromStudio } from "./studio";
import { visible } from "./safeText";

const EVIDENCE = {
  measured: { label: "MEASURED", note: "Run live." }, guide: { label: "GUIDE", note: "Stated in the guide." }, sample: { label: "SAMPLE", note: "A sample." },
  derived: { label: "OUR CHOICE", note: "Ours." }, unverified: { label: "UNVERIFIED", note: "Not confirmed." },
};
const VENDORS = [
  { id: "pf-cc", name: "PingFederate: client credentials", evidence: "guide", issuer: "https://pf.vendor.example:9031", note: "Sample A.", mappings: [] },
  { id: "okta", name: "Okta", evidence: "sample", issuer: "https://okta.example/x", note: "Okta token. Has no nbf.", mappings: [] },
];
const CONFIG = {
  title: "t", intro: "intro text", banner: "SIMULATED: a mock of PingOne token exchange", hosted: false, simulated: true, tokenLabel: "MOCK-ISSUED teaching tokens",
  evidence: EVIDENCE, vendors: VENDORS, verticals: ["retail", "health"], cast: { castApp: "orders-app" },
  tokenStates: [{ id: "valid", label: "Valid" }, { id: "expired", label: "Expired" }],
  defaults: { expRequired: true, iatRequired: false, nbfRequired: false, audiences: "", clockSkew: 0, maxFutureValidity: 0, assigned: true },
  steps: [{ n: 1, title: "Define a trusted issuer", body: "Name and issuer.", where: "/trustedIssuers", evidence: "guide" }],
  notShown: ["Third-party token as the SUBJECT token."],
  talkTrack: [{ id: "idea", title: "The idea", say: "Everything is simulated." }, { id: "trust", title: "Set the trust", say: "Pick Okta." }, { id: "result", title: "Read the result", say: "Refusal." }, ...["issuer", "send", "compare", "know"].map((id) => ({ id, title: id, say: `beat ${id}` }))],
};
const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims, kid = "mock-key") => `${b64({ alg: "RS256", typ: "JWT", kid })}.${b64(claims)}.${"S".repeat(342)}`;
const item = (n, key, extra = {}) => ({ n, id: `w${n}`, key, label: `call ${key}`, phase: "runtime", method: "POST", url: `https://auth.pingone.example/x/${key}`, requestHeaders: [{ name: "Host", value: "auth.pingone.example" }], requestBody: "a=b", requestBodyPretty: "a=b", curl: `curl -i -X POST 'https://auth.pingone.example/x/${key}'`, status: 200, statusText: "OK", responseHeaders: [{ name: "Cache-Control", value: "no-store" }], responseBody: "{}", responseBodyPretty: "{}", requestText: `POST /x/${key} HTTP/1.1\nHost: auth.pingone.example\n\na=b`, responseText: "HTTP/1.1 200 OK\nCache-Control: no-store\n\n{}", notes: `notes ${key}`, evidence: "measured", ...extra });
const hop = (n) => ({ n, from: "app", to: "p1", label: `hop ${n}`, traceparent: `00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, request: `traceparent: 00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, response: "ok" });
const CHECK = (id, label, ok, detail = "d") => ({ id, label, ok, detail });
function runFor(body) {
  const nbf = body.settings.nbfRequired && body.vendorId === "okta";
  const checks = [CHECK("assigned", "Trusted issuer is assigned to the application", true), CHECK("nbf", body.settings.nbfRequired ? "nbf present and reached" : "nbf not required", !nbf, nbf ? "token has no nbf" : "present")];
  const failed = checks.find((c) => !c.ok) || null;
  return {
    ok: !failed, failed, checks, vendor: { id: body.vendorId, name: body.vendorId === "okta" ? "Okta" : "PingFederate: client credentials" }, request: "POST https://auth.pingone.example/x/as/token",
    subject: { sub: "user-1" }, actor: { iss: "https://okta.example/x" }, runId: "0123456789abcdef", signature: { ok: true, reason: "signature verified" },
    wire: [item(10, "cc"), item(11, "vendor-token"), item(12, "exchange")], setup: [item(1, "issuer", { phase: "setup" }), item(5, "attr-1", { phase: "setup" })], mapping: [{ id: "act", label: "act.sub from cid", evidence: "derived", note: "n", source: "cid", present: true, claim: { act: { sub: "app" } } }],
    issued: failed ? null : { act: { sub: "app" }, sub: "user-1" }, error: failed ? { status: 400, error: "invalid_request", error_description: "The request could not be completed. The request was malformed or invalid.: Missing nbf claim; the Trusted Issuer requires a not-before time" } : null,
    jwts: { subject: jwt({ sub: "user-1" }, "mock-p1-key"), actor: jwt({ iss: "https://okta.example/x" }), issued: failed ? null : jwt({ act: { sub: "app" } }, "mock-p1-key") }, traceId: "a".repeat(32), hops: [hop(1), hop(2)],
  };
}
const DOC = {
  schema: "diagram-studio/1", id: "exchange-success", title: "Accepted", lede: "diagram intro",
  groups: { actor: { label: "A", color: "dark" } },
  nodes: [{ id: "app", label: "Application (orders-app)", group: "actor", x: 0, y: 0 }, { id: "p1", label: "PingOne token endpoint", group: "gateway", x: 300, y: 0 }],
  edges: [{ source: "app", target: "p1", label: "Token exchange" }, { source: "p1", target: "app", label: "Access token", dashed: true }],
  steps: [{ title: "Token exchange request", what: "The app sends the exchange.", why: "Wire call 12 request: POST x", hop: "exchange:req", edges: [0] }, { title: "Access token issued", what: "PingOne issues.", why: "{ \"act\": 1 }", edges: [1] }],
};
const SETUP = {
  markdown: "# Setup guide\n\nIntro with `code` and **bold**.\n\n<script>alert(1)</script> <img src=x onerror=alert(2)>\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | <b>2</b> |\n\n```\nPOST /x <i>raw</i>\n```\n",
  steps: [], adminFacts: [["Permissions", "Environment Admin"]], apiSamples: { trustedIssuer: { name: "Example" }, assignment: { trustedIssuer: { id: "x" } } }, notShown: ["Third-party token as the SUBJECT token."],
};

let calls;
let override = {};
let liveSaved; let liveRun;
function mockFetch() {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith("/api/vendors")) return override.vendors ? override.vendors() : json(CONFIG);
    if (url === "/api/info") return override.info ? override.info() : json({ mode: "mock", simulated: true, hosted: false, source: "mock", realAvailable: false });
    if (url === "/api/mode") return override.mode ? override.mode() : json({ mode: "mock", simulated: true, hosted: false, source: "mock", realAvailable: false });
    if (url === "/api/compare") return json({ columns: ["PingOne", "Okta"], rows: [["Issuer", "iss", "iss"], ["Audience", "aud", null]], note: "From the sheet.", evidence: EVIDENCE.sample });
    if (url === "/api/setup") return json(SETUP);
    if (url.startsWith("/api/diagram")) return json(DOC);
    if (url.startsWith("/api/wire") && override.wire) return override.wire(url);
    if (url.startsWith("/api/wire")) return json({ runId: "0123456789abcdef", wire: [item(10, "cc"), item(11, "vendor-token"), item(12, "exchange")], setup: [item(1, "issuer", { phase: "setup" })] });
    if (url === "/api/live/status") return json({ enabled: true, banner: "LIVE: this writes to a real PingOne environment", stub: true, scenarios: [{ id: "valid", title: "Valid" }, { id: "nbf-required", title: "nbfRequired" }], settings: { environmentId: "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb", region: "com", clientId: "w1", clientSecret: "set", configured: true, file: "/x/pingone.json" } });
    if (url === "/api/live/settings") { liveSaved = JSON.parse(opts.body); return json({ settings: {} }); }
    if (url === "/api/live/run") { liveRun = JSON.parse(opts.body); return json({ runName: "p1x-live-abc123", error: null, banner: "LIVE", scenarios: [{ id: "valid", title: "Valid", prediction: { status: 200, expect: { act: "a", security: "Class 3", hasSub: true } }, live: { status: 200, summary: { act: "a", security: "Class 3", hasSub: true } }, match: true }, { id: "nbf-required", title: "nbfRequired", prediction: { status: 400, reason: "Missing nbf claim" }, live: { status: 400, description: "Other text" }, match: false }], mismatches: [{ scenario: "nbf-required", field: "error_description", predicted: "Missing nbf claim", live: "Other text" }], cleanup: { ok: true, thisRunClean: true }, wire: [item(1, "issuer", { phase: "setup" })] }); }
    if (url === "/api/reset") return json({ reset: "ok" });
    if (url === "/api/exchange") return json({ ...runFor(JSON.parse(opts.body)), ...(override.runId ? { runId: override.runId() } : {}) });
    return json({}, 404);
  });
}
beforeEach(() => { override = {}; mockFetch(); window.location.hash = "#exchange"; });

const ready = async () => { render(<App />); await screen.findByTestId("vendor-okta"); await screen.findByTestId("verdict"); };

describe("shell", () => {
  it("shows the banner, the mode, and sends X-Workspace on API calls", async () => {
    await ready();
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(screen.getByTestId("mode-select")).toHaveValue("mock");
    const ex = calls.find((c) => c.url === "/api/exchange");
    expect(ex.opts.headers["x-workspace"]).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("has seven tabs including the wire and the setup guide", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Exchange lab", "Wire", "Diagram", "Claims compared", "Setup guide", "Admin and limits", "Talk track"]);
  });
});

describe("exchange tab", () => {
  it("the default exchange succeeds and shows the checks, the request, the three tokens, the mapping and the hops", async () => {
    await ready();
    expect(screen.getByTestId("verdict")).toHaveAttribute("data-ok", "true");
    expect(screen.getByTestId("verdict")).toHaveTextContent("Exchange succeeds");
    expect(within(screen.getByTestId("checks")).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByTestId("wire-exchange-request")).toHaveTextContent("POST /x/exchange");
    expect(screen.getByTestId("issued-payload")).toHaveTextContent('"act"');
    expect(screen.getByTestId("subject")).toBeInTheDocument();
    expect(screen.getByTestId("actor")).toBeInTheDocument();
    expect(screen.getByTestId("maps")).toHaveTextContent("OUR CHOICE");
    expect(screen.getByTestId("hops")).toHaveTextContent(/traceparent: 00-a{32}-1{16}-01/);
    expect(screen.getByTestId("legend")).toHaveTextContent("UNVERIFIED");
    for (const l of ["MEASURED", "GUIDE", "SAMPLE", "OUR CHOICE"]) expect(screen.getByTestId("legend")).toHaveTextContent(l);
    expect(screen.getByTestId("limits-line")).toHaveTextContent("SUBJECT token is not simulated");
  });
  it("requiring nbf flips Okta to refused with the failed check named; Reset restores the default", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("vendor-okta"));
    await waitFor(() => expect(screen.getByTestId("actor-payload")).toHaveTextContent("okta.example"));
    expect(screen.getByTestId("verdict")).toHaveAttribute("data-ok", "true");
    await userEvent.click(screen.getByTestId("nbf"));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveAttribute("data-ok", "false"));
    expect(screen.getByTestId("verdict")).toHaveTextContent("Exchange refused: nbf present and reached");
    expect(screen.getByTestId("checks").querySelector('[data-check="nbf"]')).toHaveTextContent("fail");
    expect(screen.getByTestId("nothing-issued")).toBeInTheDocument();
    expect(screen.queryByTestId("issued")).toBeNull();
    expect(screen.getByTestId("error-body")).toHaveTextContent("invalid_request");
    expect(screen.getByTestId("error-body")).toHaveTextContent("Missing nbf claim; the Trusted Issuer requires a not-before time");
    expect(screen.getByTestId("verdict")).toHaveTextContent("MEASURED");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveAttribute("data-ok", "true"));
    expect(screen.getByTestId("nbf")).not.toBeChecked();
    expect(screen.getByTestId("vendor-pf-cc")).toHaveAttribute("aria-pressed", "true");
    expect(calls.some((c) => c.url === "/api/reset" && c.opts.method === "POST")).toBe(true);
  });
  it("sends the controls to the server as typed settings", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("iat"));
    await userEvent.type(screen.getByTestId("aud"), "one,two");
    await userEvent.click(screen.getByTestId("assigned"));
    await userEvent.click(screen.getByTestId("state-expired"));
    await waitFor(() => {
      const last = JSON.parse(calls.filter((c) => c.url === "/api/exchange").at(-1).opts.body);
      expect(last).toEqual({ vendorId: "pf-cc", tokenState: "expired", assigned: false, settings: { expRequired: true, iatRequired: true, nbfRequired: false, audiences: "one,two", clockSkew: 0, maxFutureValidity: 0 } });
    });
  });
  it("sends clock skew and maximum future validity as numbers", async () => {
    await ready();
    await userEvent.clear(screen.getByTestId("skew"));
    await userEvent.type(screen.getByTestId("skew"), "30");
    await userEvent.type(screen.getByTestId("maxfut"), "3600");
    await waitFor(() => {
      const last = JSON.parse(calls.filter((c) => c.url === "/api/exchange").at(-1).opts.body);
      expect(last.settings.clockSkew).toBe(30);
      expect(last.settings.maxFutureValidity).toBe(3600);
    });
  });
  it("shows every token whole: raw string, header and payload decoded from it, and Copy buttons that copy the full string", async () => {
    await ready();
    const raw = screen.getByTestId("actor-raw").textContent;
    expect(raw.split(".")).toHaveLength(3);
    expect(raw.split(".")[2]).toHaveLength(342);
    expect(raw).not.toMatch(/\.\.\.|…/);
    expect(screen.getByTestId("actor-payload")).toHaveTextContent("okta.example");
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByTestId("actor-copy"));
    expect(writeText).toHaveBeenCalledWith(raw);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Copy request|Copy curl|Copy response/ }).length).toBeGreaterThanOrEqual(9);
    expect(screen.getByTestId("signature-line")).toHaveTextContent("verified for real");
  });
  it("a server 400 shows an inline error, not a crash", async () => {
    await ready();
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, opts) => (url === "/api/exchange" ? { ok: false, status: 400, json: async () => ({ error: "too_long", detail: "audiences is longer than 600" }) } : orig(url, opts)));
    await userEvent.click(screen.getByTestId("state-expired"));
    expect(await screen.findByRole("alert")).toHaveTextContent("too_long: audiences is longer than 600");
  });
});

describe("diagram tab", () => {
  it("draws the boxes from the diagram-studio document and Simulate shows the step and its payload; Reset clears it", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Diagram" }));
    expect(await screen.findByText("Application (orders-app)")).toBeInTheDocument();
    const call = calls.find((c) => c.url.startsWith("/api/diagram?"));
    expect(call.url).toContain("vendorId=pf-cc");
    expect(call.url).toContain("nbfRequired=false");
    expect(screen.getByTestId("banner")).toBeInTheDocument();
    expect(screen.getByLabelText(/Step time/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /simulate/i }));
    expect(await screen.findByTestId("pattern-now")).toHaveTextContent("Step 1: Token exchange request");
    expect(screen.getByTestId("pattern-payload")).toHaveTextContent("POST /x/exchange HTTP/1.1");
    expect(screen.getByTestId("pattern-payload")).toHaveTextContent("Host: auth.pingone.example");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull());
  });
  it("fromStudio only maps the document: boxes, arrows, order, titles and payloads come from it", () => {
    const p = fromStudio(DOC);
    expect(p.nodes.map((n) => n.id)).toEqual(["app", "p1"]);
    expect(p.steps.map((s) => [s.from, s.to, s.label, s.title, s.payload])).toEqual([["app", "p1", "Token exchange", "Token exchange request", "Wire call 12 request: POST x"], ["p1", "app", "Access token", "Access token issued", "{ \"act\": 1 }"]]);
  });
  it("the diagram query carries every control", () => {
    const q = new URLSearchParams(diagramQuery({ vendorId: "okta", tokenState: "expired", assigned: false, settings: { expRequired: true, iatRequired: false, nbfRequired: true, audiences: "a b", clockSkew: 30, maxFutureValidity: 3600 } }, "health"));
    expect(Object.fromEntries(q)).toEqual({ vendorId: "okta", tokenState: "expired", assigned: "false", audiences: "a b", vertical: "health", expRequired: "true", iatRequired: "false", nbfRequired: "true", clockSkew: "30", maxFutureValidity: "3600" });
  });
  it("nudges the two labels of a back-and-forth pair in opposite directions and leaves the rest alone", () => {
    expect(labelOffsets([{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "c" }])).toEqual([-16, 16, 0]);
    expect(labelOffsets([])).toEqual([]);
  });
});

describe("wire tab", () => {
  it("lists the setup and runtime calls in full from /api/wire, shows whole tokens, and the decode box reads the pasted string", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Wire" }));
    const tab = await screen.findByTestId("wire-tab");
    expect(calls.some((c) => c.url === "/api/wire?runId=0123456789abcdef")).toBe(true);
    expect(within(tab).getByTestId("wire-exchange")).toBeInTheDocument();
    expect(within(tab).getByTestId("wire-issuer")).toBeInTheDocument();
    expect(within(tab).getByTestId("wire-token-actor-raw").textContent.split(".")).toHaveLength(3);
    expect(screen.getByTestId("banner")).toBeVisible();
    await userEvent.click(screen.getByTestId("decode-input"));
    await userEvent.paste(within(tab).getByTestId("wire-token-actor-raw").textContent);
    expect(screen.getByTestId("decode-out")).toHaveTextContent("okta.example");
    await userEvent.clear(screen.getByTestId("decode-input"));
    await userEvent.paste("not a token");
    expect(screen.getByTestId("decode-error")).toBeInTheDocument();
  });
});

describe("compare, setup and admin tabs", () => {
  it("compare shows the sheet with a dash for a missing claim", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Claims compared" }));
    const t = await screen.findByTestId("compare");
    expect(within(t).getByText("Audience")).toBeInTheDocument();
    expect(within(t).getByLabelText("not included")).toBeInTheDocument();
  });
  it("the setup guide renders headings, lists, a table and code, and shows hostile markup as inert text", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Setup guide" }));
    const md = await screen.findByTestId("markdown");
    expect(within(md).getByRole("heading", { name: "Setup guide" })).toBeInTheDocument();
    expect(md.querySelectorAll("li")).toHaveLength(2);
    expect(md.querySelector("table")).not.toBeNull();
    expect(md.querySelector("strong")).toHaveTextContent("bold");
    expect(md.querySelector("script")).toBeNull();
    expect(md.querySelector("img")).toBeNull();
    expect(md.querySelector("b")).toBeNull();
    expect(md.querySelector("i")).toBeNull();
    expect(md).toHaveTextContent("<script>alert(1)</script>");
    expect(md).toHaveTextContent("<b>2</b>");
    expect(md).toHaveTextContent("POST /x <i>raw</i>");
  });
  it("admin and limits keeps the not-shown list, labelled UNVERIFIED", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Admin and limits" }));
    expect(await screen.findByTestId("not-shown")).toHaveTextContent("UNVERIFIED");
    expect(screen.getByTestId("not-shown")).toHaveTextContent("SUBJECT token");
    expect(screen.getByTestId("admin-facts")).toHaveTextContent("Environment Admin");
    expect(screen.getByTestId("api-issuer")).toHaveTextContent("Example");
  });
});

describe("talk track and presenter mode", () => {
  it("lists the talk track; presenter mode keeps the banner and shows the say-text; Esc leaves", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Talk track" }));
    expect(screen.getByTestId("talk-track")).toHaveTextContent("Everything is simulated.");
    await userEvent.click(screen.getByRole("tab", { name: "Exchange lab" }));
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("Pick Okta.");
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(document.querySelector(".app--presenter")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
  });
  it("the hosted build says HOSTED SIMULATION in the banner", async () => {
    override.vendors = async () => ({ ok: true, status: 200, json: async () => ({ ...CONFIG, banner: "HOSTED SIMULATION: x", hosted: true }) });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/^HOSTED SIMULATION/));
    expect(screen.getByRole("option", { name: "Real" })).toBeDisabled();
  });
});

describe("banner visibility on every tab, presenter mode and hosted mode", () => {
  it("is visible (not hidden, not display:none) on every tab and in presenter mode", async () => {
    await ready();
    for (const t of TABS) {
      await userEvent.click(screen.getByRole("tab", { name: t.label }));
      expect(screen.getByTestId("banner")).toBeVisible();
      expect(screen.getByTestId("banner")).not.toHaveAttribute("hidden");
    }
    await userEvent.click(screen.getByRole("tab", { name: "Exchange lab" }));
    await userEvent.keyboard("p");
    await screen.findByTestId("presenter-say");
    expect(screen.getByTestId("banner")).toBeVisible();
  });
  it("hosted: shows HOSTED SIMULATION from /api/info even before /api/vendors answers, never plain SIMULATED", async () => {
    override.info = async () => ({ ok: true, status: 200, json: async () => ({ mode: "mock", simulated: true, hosted: true }) });
    override.vendors = () => new Promise(() => {});
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/^HOSTED SIMULATION/));
    expect(screen.getByTestId("banner")).toBeVisible();
  });
  it("while nothing has answered, and when both calls fail, the banner says both and stays visible", async () => {
    override.info = () => new Promise(() => {});
    override.vendors = () => new Promise(() => {});
    const { unmount } = render(<App />);
    expect(screen.getByTestId("banner")).toHaveTextContent(BANNER_UNKNOWN);
    expect(BANNER_UNKNOWN).toMatch(/HOSTED SIMULATION/);
    unmount();
    override.info = async () => ({ ok: false, status: 500, json: async () => ({}) });
    override.vendors = async () => ({ ok: false, status: 500, json: async () => ({}) });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the app");
    expect(screen.getByTestId("banner")).toHaveTextContent(BANNER_UNKNOWN);
  });
});

describe("links from the content pack: /#vendor-<id>", () => {
  it("opens the Exchange tab on that issuer", async () => {
    window.location.hash = "#vendor-okta";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("vendor-okta")).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(screen.getByTestId("actor-payload")).toHaveTextContent("okta.example"));
  });
  it("an unknown id keeps the default issuer; a hostile or oversized id is not a vendor link and lands on the walk", async () => {
    window.location.hash = "#vendor-nope";
    const { unmount } = render(<App />);
    await screen.findByTestId("vendor-okta");
    expect(screen.getByTestId("vendor-pf-cc")).toHaveAttribute("aria-pressed", "true");
    unmount();
    for (const h of ["#vendor-__proto__", "#vendor-" + "a".repeat(80)]) {
      window.location.hash = h;
      const r = render(<App />);
      expect(await screen.findByTestId("walk")).toBeInTheDocument();
      r.unmount();
    }
  });
});

describe("accessibility structure and display safety", () => {
  it("has one main landmark, the banner as the first content in main, one page h1, and a tabpanel that is not the main", async () => {
    await ready();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByTestId("banner"));
    expect(main.querySelector(".page-title")).toBeTruthy();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).not.toBe(main);
  });
  it("control and bidi characters are shown as visible escapes", () => {
    expect(visible("a" + String.fromCharCode(0x202e) + "b")).toBe("a\\u202eb");
  });
});

describe("live tab (owner-run)", () => {
  it("does not exist in a mock or hosted build", async () => {
    await ready();
    expect(screen.queryByRole("tab", { name: "Live" })).toBeNull();
    expect(calls.some((c) => c.url.startsWith("/api/live"))).toBe(false);
  });
  it("when MODE=live was requested but refused, the tab says why and calls nothing", async () => {
    override.info = async () => ({ ok: true, status: 200, json: async () => ({ mode: "mock", simulated: true, hosted: false, live: { requested: true, enabled: false, reasons: ["P1TPX_ALLOW_LIVE is not 1"] } }) });
    await ready();
    await userEvent.click(await screen.findByRole("tab", { name: "Live" }));
    expect(await screen.findByTestId("live-refused")).toHaveTextContent("P1TPX_ALLOW_LIVE is not 1");
    expect(screen.getByTestId("banner")).toBeVisible();
    expect(calls.some((c) => c.url.startsWith("/api/live"))).toBe(false);
  });
  it("enabled: LIVE banner, write-only secret, the Run button needs the exact environment id typed, results show match and mismatch with a pasteable list", async () => {
    override.info = async () => ({ ok: true, status: 200, json: async () => ({ mode: "live", simulated: true, hosted: false, live: { requested: true, enabled: true, reasons: [] } }) });
    await ready();
    await userEvent.click(await screen.findByRole("tab", { name: "Live" }));
    expect(await screen.findByTestId("live-banner")).toHaveTextContent(/LIVE: this writes to a real PingOne environment and deletes it again/);
    expect(screen.getByTestId("live-secret-state")).toHaveTextContent("set");
    expect(screen.getByTestId("live-secret")).toHaveValue("");
    expect(document.body.textContent).not.toContain("STUB-WORKER-SECRET");
    expect(screen.getByTestId("live-run-btn")).toBeDisabled();
    await userEvent.type(screen.getByTestId("live-confirm"), "aaaaaaaa-1111-4222-8333-bbbbbbbbbbb");
    expect(screen.getByTestId("live-run-btn")).toBeDisabled();
    await userEvent.type(screen.getByTestId("live-confirm"), "b");
    expect(screen.getByTestId("live-run-btn")).toBeEnabled();
    await userEvent.type(screen.getByTestId("live-secret"), "new-secret-value");
    await userEvent.click(screen.getByTestId("live-save"));
    await waitFor(() => expect(liveSaved.clientSecret).toBe("new-secret-value"));
    await userEvent.click(screen.getByTestId("live-run-btn"));
    expect(await screen.findByTestId("live-table")).toBeInTheDocument();
    expect(liveRun).toEqual({ confirm: "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb", scenarios: ["valid", "nbf-required"] });
    expect(screen.getByTestId("badge-valid")).toHaveTextContent("MATCH");
    expect(screen.getByTestId("badge-nbf-required")).toHaveTextContent("MISMATCH");
    expect(screen.getByTestId("live-mismatches")).toHaveValue("nbf-required | error_description | mock predicted: Missing nbf claim | live: Other text");
    expect(screen.getByTestId("live-cleanup-result")).toHaveTextContent("nothing named p1x-live remains");
    expect(screen.getByTestId("banner")).toBeVisible();
    await userEvent.keyboard("{Escape}");
  });
});

describe("wire tab recovers from a run the server no longer has", () => {
  const WIRE = (id) => ({ runId: id, wire: [item(10, "cc"), item(11, "vendor-token"), item(12, "exchange")], setup: [item(1, "issuer", { phase: "setup" })] });
  const ok = (b) => ({ ok: true, status: 200, json: async () => b });
  const nf = () => ({ ok: false, status: 404, json: async () => ({ error: "run_not_found", hint: "POST /api/exchange first" }) });

  it("opened first on a fresh workspace (no Exchange visit) it renders the default run's calls with no error", async () => {
    window.location.hash = "#wire";
    render(<App />);
    expect(await screen.findByTestId("wire-tab")).toBeInTheDocument();
    expect(screen.getByTestId("wire-exchange")).toBeInTheDocument();
    expect(screen.queryByText(/Could not load the wire/)).toBeNull();
    expect(screen.queryByTestId("wire-failed")).toBeNull();
  });
  it("after a server restart (the run id is unknown) it refreshes the run with the CURRENT controls and shows the calls, never a 404", async () => {
    let n = 0;
    override.runId = () => (n++ === 0 ? "aaaaaaaaaaaaaaaa" : "bbbbbbbbbbbbbbbb");
    override.wire = (url) => (url.includes("aaaaaaaaaaaaaaaa") ? nf() : ok(WIRE("bbbbbbbbbbbbbbbb")));
    await ready();
    await userEvent.click(screen.getByTestId("vendor-okta"));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/exchange").length).toBeGreaterThan(1));
    n = 0; // the server "restarts": the next run it hands out is the first of a new life, the old id is gone
    override.runId = () => "cccccccccccccccc";
    override.wire = (url) => (url.includes("cccccccccccccccc") ? ok(WIRE("cccccccccccccccc")) : nf());
    await userEvent.click(screen.getByRole("tab", { name: "Wire" }));
    expect(await screen.findByTestId("wire-tab")).toBeInTheDocument();
    expect(screen.queryByText(/404/)).toBeNull();
    expect(screen.queryByTestId("wire-failed")).toBeNull();
    const posts = calls.filter((c) => c.url === "/api/exchange").map((c) => JSON.parse(c.opts.body));
    expect(posts.at(-1).vendorId).toBe("okta");
    expect(calls.some((c) => c.url === "/api/wire?runId=cccccccccccccccc")).toBe(true);
  });
  it("if the retry also fails it shows a friendly message with a Run it again button and the status in a details line, not the bare code", async () => {
    override.wire = () => nf();
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Wire" }));
    const box = await screen.findByTestId("wire-failed");
    expect(box).toHaveTextContent("The run is not available right now");
    expect(box).toHaveTextContent("Run it again");
    expect(within(box).getByText("Details").closest("details")).toHaveTextContent("HTTP 404");
    expect(screen.queryByText("Could not load the wire (HTTP 404).")).toBeNull();
    const before = calls.filter((c) => c.url === "/api/exchange").length;
    override.wire = (url) => ok(WIRE(url.split("=")[1]));
    await userEvent.click(screen.getByTestId("wire-again"));
    expect(await screen.findByTestId("wire-tab")).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/exchange").length).toBeGreaterThan(before);
  });
  it("works in the hosted build too", async () => {
    override.vendors = async () => ({ ok: true, status: 200, json: async () => ({ ...CONFIG, banner: "HOSTED SIMULATION: x", hosted: true }) });
    override.wire = (url) => (url.includes("0123456789abcdef") ? nf() : ok(WIRE("zzzzzzzzzzzzzzzz")));
    override.runId = () => "dddddddddddddddd";
    window.location.hash = "#wire";
    render(<App />);
    expect(await screen.findByTestId("wire-tab")).toBeInTheDocument();
    expect(screen.getByTestId("banner")).toHaveTextContent(/^HOSTED SIMULATION/);
  });
});
