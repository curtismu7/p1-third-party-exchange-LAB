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
  talkTrack: [{ id: "say-first", title: "Say first", say: "Everything is simulated." }, { id: "nbf", title: "The nbf trap", say: "Pick Okta." }, { id: "setup", title: "Four steps", say: "Setup." }],
};
const hop = (n) => ({ n, from: "app", to: "p1", label: `hop ${n}`, traceparent: `00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, request: `traceparent: 00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, response: "ok" });
const CHECK = (id, label, ok, detail = "d") => ({ id, label, ok, detail });
function runFor(body) {
  const nbf = body.settings.nbfRequired && body.vendorId === "okta";
  const checks = [CHECK("assigned", "Trusted issuer is assigned to the application", true), CHECK("nbf", body.settings.nbfRequired ? "nbf present and reached" : "nbf not required", !nbf, nbf ? "token has no nbf" : "present")];
  const failed = checks.find((c) => !c.ok) || null;
  return {
    ok: !failed, failed, checks, vendor: { id: body.vendorId, name: body.vendorId === "okta" ? "Okta" : "PingFederate: client credentials" }, request: "POST https://auth.pingone.example/x/as/token",
    subject: { sub: "user-1" }, actor: { iss: "https://okta.example/x" }, mapping: [{ id: "act", label: "act.sub from cid", evidence: "derived", note: "n", source: "cid", present: true, claim: { act: { sub: "app" } } }],
    issued: failed ? null : { act: { sub: "app" }, sub: "user-1" }, error: failed ? { status: 400, error: "invalid_request", error_description: "The request could not be completed. The request was malformed or invalid.: Missing nbf claim; the Trusted Issuer requires a not-before time" } : null,
    jwts: { subject: "a.b.MOCK-SIGNATURE-NOT-VALID", actor: "a.b.MOCK-SIGNATURE-NOT-VALID", issued: failed ? null : "a.b.MOCK-SIGNATURE-NOT-VALID" }, traceId: "a".repeat(32), hops: [hop(1), hop(2)],
  };
}
const DOC = {
  schema: "diagram-studio/1", id: "exchange-success", title: "Accepted", lede: "diagram intro",
  groups: { actor: { label: "A", color: "dark" } },
  nodes: [{ id: "app", label: "Application (orders-app)", group: "actor", x: 0, y: 0 }, { id: "p1", label: "PingOne token endpoint", group: "gateway", x: 300, y: 0 }],
  edges: [{ source: "app", target: "p1", label: "Token exchange" }, { source: "p1", target: "app", label: "Access token", dashed: true }],
  steps: [{ title: "Token exchange request", what: "The app sends the exchange.", why: "POST /token\nactor_token_type=jwt", edges: [0] }, { title: "Access token issued", what: "PingOne issues.", why: "{ \"act\": 1 }", edges: [1] }],
};
const SETUP = {
  markdown: "# Setup guide\n\nIntro with `code` and **bold**.\n\n<script>alert(1)</script> <img src=x onerror=alert(2)>\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | <b>2</b> |\n\n```\nPOST /x <i>raw</i>\n```\n",
  steps: [], adminFacts: [["Permissions", "Environment Admin"]], apiSamples: { trustedIssuer: { name: "Example" }, assignment: { trustedIssuer: { id: "x" } } }, notShown: ["Third-party token as the SUBJECT token."],
};

let calls;
let override = {};
function mockFetch() {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith("/api/vendors")) return override.vendors ? override.vendors() : json(CONFIG);
    if (url === "/api/info") return override.info ? override.info() : json({ mode: "mock", simulated: true, hosted: false });
    if (url === "/api/compare") return json({ columns: ["PingOne", "Okta"], rows: [["Issuer", "iss", "iss"], ["Audience", "aud", null]], note: "From the sheet.", evidence: EVIDENCE.sample });
    if (url === "/api/setup") return json(SETUP);
    if (url.startsWith("/api/diagram")) return json(DOC);
    if (url === "/api/reset") return json({ reset: "ok" });
    if (url === "/api/exchange") return json(runFor(JSON.parse(opts.body)));
    return json({}, 404);
  });
}
beforeEach(() => { override = {}; mockFetch(); window.location.hash = ""; });

const ready = async () => { render(<App />); await screen.findByTestId("vendor-okta"); await screen.findByTestId("verdict"); };

describe("shell", () => {
  it("shows the banner, the mode, and sends X-Workspace on API calls", async () => {
    await ready();
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock (local)");
    const ex = calls.find((c) => c.url === "/api/exchange");
    expect(ex.opts.headers["x-workspace"]).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("has six tabs including the setup guide", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Exchange", "Diagram", "Claims compared", "Setup guide", "Admin and limits", "Talk track"]);
  });
});

describe("exchange tab", () => {
  it("the default exchange succeeds and shows the checks, the request, the three tokens, the mapping and the hops", async () => {
    await ready();
    expect(screen.getByTestId("verdict")).toHaveAttribute("data-ok", "true");
    expect(screen.getByTestId("verdict")).toHaveTextContent("Exchange succeeds");
    expect(within(screen.getByTestId("checks")).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByTestId("request")).toHaveTextContent("POST https://auth.pingone.example");
    expect(screen.getByTestId("issued")).toHaveTextContent('"act"');
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
    await waitFor(() => expect(screen.getByTestId("actor")).toHaveTextContent("okta.example"));
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
    expect(screen.getByTestId("pattern-payload")).toHaveTextContent("actor_token_type=jwt");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull());
  });
  it("fromStudio only maps the document: boxes, arrows, order, titles and payloads come from it", () => {
    const p = fromStudio(DOC);
    expect(p.nodes.map((n) => n.id)).toEqual(["app", "p1"]);
    expect(p.steps.map((s) => [s.from, s.to, s.label, s.title, s.payload])).toEqual([["app", "p1", "Token exchange", "Token exchange request", "POST /token\nactor_token_type=jwt"], ["p1", "app", "Access token", "Access token issued", "{ \"act\": 1 }"]]);
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
    await userEvent.click(screen.getByRole("tab", { name: "Exchange" }));
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
    expect(screen.getByTestId("mode")).toHaveTextContent("(hosted)");
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
    await userEvent.click(screen.getByRole("tab", { name: "Exchange" }));
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
    await waitFor(() => expect(screen.getByTestId("actor")).toHaveTextContent("okta.example"));
  });
  it("an unknown or hostile id keeps the default issuer", async () => {
    for (const h of ["#vendor-nope", "#vendor-__proto__", "#vendor-" + "a".repeat(80)]) {
      window.location.hash = h;
      const { unmount } = render(<App />);
      await screen.findByTestId("vendor-okta");
      expect(screen.getByTestId("vendor-pf-cc")).toHaveAttribute("aria-pressed", "true");
      unmount();
    }
  });
});

describe("accessibility structure and display safety", () => {
  it("has one main landmark, one banner status inside the header, and a tabpanel that is not the main", async () => {
    await ready();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("banner")).toContainElement(screen.getByTestId("banner"));
    expect(screen.getByRole("tabpanel")).not.toBe(screen.getByRole("main"));
  });
  it("control and bidi characters are shown as visible escapes", () => {
    expect(visible("a" + String.fromCharCode(0x202e) + "b")).toBe("a\\u202eb");
  });
});
