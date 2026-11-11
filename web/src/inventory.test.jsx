// INVENTORY: everything the original tabs (Exchange lab, Diagram, Wire, Claims compared, Setup guide, Admin and limits, Talk track) show.
// Each item must be reachable (1) on the one-page view (#walk=all) and (2) on at least one of the seven steps, or (for the items that live
// on an Advanced tab) on that tab, which must stay one click from step 7 and from the Advanced menu. It FAILS when an item is removed.
// The data comes from the real server modules, so a new issuer, fact, limit or call must show up here too.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { inject } from "vitest";

const FX = inject("inventory");
const D = FX.D;
const NOW = () => Math.floor(Date.now() / 1000);
let lastRun = null;
function install() {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    const u = new URL(url, "http://x");
    if (u.pathname === "/api/vendors") return json({ title: D.TITLE, intro: D.INTRO, banner: D.BANNER, hosted: false, simulated: true, tokenLabel: "MOCK-ISSUED teaching tokens", evidence: D.EVIDENCE, vendors: D.VENDORS, tokenStates: D.TOKEN_STATES, defaults: D.DEFAULTS, steps: D.STEPS, notShown: D.NOT_SHOWN, talkTrack: FX.talk, verticals: FX.verticals, cast: FX.cast });
    if (u.pathname === "/api/info") return json({ mode: "mock", simulated: true, hosted: false });
    if (u.pathname === "/api/compare") return json({ columns: D.COMPARE_COLUMNS, rows: D.COMPARE_ROWS, note: D.COMPARE_NOTE, evidence: D.EVIDENCE.sample });
    if (u.pathname === "/api/setup") return json(FX.setup);
    if (u.pathname === "/api/exchange") { const body = JSON.parse(opts.body); lastRun = FX.runs[body.tokenState === "expired" ? "expired" : "valid"].run; return json(lastRun); }
    if (u.pathname === "/api/wire") return json({ runId: lastRun.runId, setup: lastRun.setup, wire: lastRun.wire });
    if (u.pathname === "/api/diagram") return json(FX.runs[u.searchParams.get("tokenState") === "expired" ? "expired" : "valid"].diagram);
    if (u.pathname === "/api/reset") return json({ reset: "ok" });
    return json({}, 404);
  });
}
beforeEach(() => { try { window.localStorage.clear(); } catch { /* none */ } document.documentElement.style.fontSize = ""; install(); lastRun = null; });

// ---- the inventory --------------------------------------------------------------------------------------------------------------
const q = (root, sel) => root.querySelector(sel);
const text = (root) => root.textContent || "";
const has = (root, s) => text(root).includes(s);
const tid = (root, id) => Boolean(q(root, `[data-testid="${id}"]`));
const where = (root, w) => Boolean(q(root, `[data-testid="decoded-token"][data-where^="${w}"]`));
const vendor0 = D.VENDORS[0];
// scenario "ok": the default run. scenario "refused": token state Expired. `where`: "walk" = on the walk itself; otherwise the Advanced tab id.
export const INVENTORY = [
  ["banner (simulated)", "ok", "walk", (r) => /SIMULATED/.test(text(q(r, '[data-testid="banner"]') || document.createElement("i")))],
  ["Reset button", "ok", "walk", (r) => tid(r, "reset")],
  ["Presenter button", "ok", "walk", (r) => tid(r, "presenter")],
  ["text size control", "ok", "walk", (r) => tid(r, "font-select")],
  ["mode chip", "ok", "walk", (r) => tid(r, "mode-select")],
  ...D.VENDORS.map((v) => [`issuer chip: ${v.name}`, "ok", "walk", (r) => has(q(r, `[data-testid="walk-vendor-${v.id}"]`) || document.createElement("i"), v.name)]),
  ["heading: Try an issuer", "ok", "walk", (r) => has(r, "Try an issuer")],
  ["issuer note", "ok", "walk", (r) => has(r, vendor0.note)],
  ["issuer string", "ok", "walk", (r) => has(r, vendor0.issuer)],
  ["heading: How it is set up", "ok", "walk", (r) => has(r, "How it is set up")],
  ...D.STEPS.map((s) => [`setup step: ${s.title}`, "ok", "walk", (r) => has(q(r, '[data-testid="setup-steps"]') || document.createElement("i"), s.title)]),
  ...Object.values(D.EVIDENCE).map((e) => [`evidence label: ${e.label}`, "ok", "walk", (r) => has(q(r, '[data-testid="legend"]') || document.createElement("i"), e.label)]),
  ["heading: Trusted issuer settings", "ok", "walk", (r) => has(r, "Trusted issuer settings")],
  ...["exp", "iat", "nbf", "aud", "assigned", "skew", "maxfut"].map((k) => [`trusted issuer setting: ${k}`, "ok", "walk", (r) => tid(r, `walk-${k}`)]),
  ["heading: Actor token state", "ok", "walk", (r) => has(r, "Actor token state")],
  ...D.TOKEN_STATES.map((t) => [`token state: ${t.label}`, "ok", "walk", (r) => tid(r, `walk-state-${t.id}`)]),
  ["POST /trustedIssuers request body", "ok", "walk", (r) => has(q(r, '[data-testid="walk-issuer-body"]') || document.createElement("i"), '"jwks"')],
  ["verdict", "ok", "walk", (r) => tid(r, "verdict")],
  ["heading: Result", "ok", "walk", (r) => has(r, "Result")],
  ["checks table (all 8 checks)", "ok", "walk", (r) => (q(r, '[data-testid="checks"]') || { querySelectorAll: () => [] }).querySelectorAll("tbody tr").length === 8],
  ["heading: The calls of this run, in full", "ok", "walk", (r) => has(r, "The calls of this run, in full")],
  ["exchange request (full text)", "ok", "walk", (r) => has(q(r, '[data-testid="wire-exchange-request"]') || document.createElement("i"), "actor_token=")],
  ["exchange curl", "ok", "walk", (r) => [...r.querySelectorAll('[data-testid="wire-exchange"] pre')].some((p) => /^curl -i -X POST/.test(p.textContent))],
  ["heading: Subject token (PingOne, MOCK)", "ok", "walk", (r) => has(r, "Subject token (PingOne, MOCK)")],
  ["subject token raw and decoded", "ok", "walk", (r) => where(r, "subject token") && [...r.querySelectorAll('[data-testid="decoded-raw"]')].some((p) => p.textContent.split(".").length === 3)],
  [`heading: Actor token: ${vendor0.name}`, "ok", "walk", (r) => has(r, `Actor token: ${vendor0.name}`)],
  ["actor token raw and decoded", "ok", "walk", (r) => where(r, "sample token")],
  ["actor signature line", "ok", "walk", (r) => tid(r, "signature-line")],
  ["heading: Attribute mapping on the custom resource", "ok", "walk", (r) => has(r, "Attribute mapping on the custom resource")],
  ["mapping list", "ok", "walk", (r) => has(q(r, '[data-testid="maps"]') || document.createElement("i"), vendor0.mappings[0].label)],
  ["heading: Issued access token", "ok", "walk", (r) => has(r, "Issued access token")],
  ["issued token raw and decoded", "ok", "walk", (r) => where(r, "issued access token")],
  ["hops with W3C traceparent", "ok", "walk", (r) => has(r, "Hops (W3C traceparent)") && tid(r, "hops")],
  ["diagram canvas", "ok", "walk", (r) => tid(r, "pattern-canvas")],
  ["diagram nodes", "ok", "walk", (r) => has(r, "Application (orders-app)") && has(r, "PingOne token endpoint")],
  ["diagram Simulate", "ok", "walk", (r) => [...r.querySelectorAll("button")].some((b) => /simulate/i.test(b.textContent))],
  ["diagram speed control", "ok", "walk", (r) => Boolean(q(r, '[aria-label*="Step time"], [data-testid*="step-time"], .dstep-time, select[aria-label*="speed" i]')) || has(r, "Step time")],
  ["diagram Reset", "ok", "walk", (r) => tid(r, "pattern-reset")],
  ...D.COMPARE_COLUMNS.map((c) => [`compare column: ${c}`, "ok", "walk", (r) => has(q(r, '[data-testid="compare"]') || document.createElement("i"), c)]),
  ...D.COMPARE_ROWS.map((row) => [`compare row: ${row[0]}`, "ok", "walk", (r) => has(q(r, '[data-testid="compare"]') || document.createElement("i"), row[0])]),
  ["heading: What each issuer puts in its token", "ok", "walk", (r) => has(r, "What each issuer puts in its token")],
  ["heading: Admin API", "ok", "walk", (r) => has(r, "Admin API")],
  ["admin API samples", "ok", "walk", (r) => tid(r, "api-issuer") && tid(r, "api-assignment")],
  ["heading: Permissions, events and licensing", "ok", "walk", (r) => has(r, "Permissions, events and licensing")],
  ...D.ADMIN_FACTS.map(([k]) => [`admin fact: ${k}`, "ok", "walk", (r) => has(q(r, '[data-testid="admin-facts"]') || document.createElement("i"), k)]),
  ["measured limits fact (clockSkew, maxFutureValidity)", "ok", "walk", (r) => /clockSkew is in seconds/.test(text(q(r, '[data-testid="admin-facts"]') || document.createElement("i")))],
  ["heading: What this app does not show", "ok", "walk", (r) => has(r, "What this app does not show")],
  ...D.NOT_SHOWN.map((t, i) => [`not shown #${i + 1}`, "ok", "walk", (r) => has(q(r, '[data-testid="not-shown"]') || document.createElement("i"), t.slice(0, 40))]),
  ["limits line (SUBJECT token not simulated)", "ok", "walk", (r) => tid(r, "limits-line")],
  ["Real exchange (your browser) button", "ok", "walk", (r) => tid(r, "try-browser")],
  ["error body (PingOne's full 400 text)", "refused", "walk", (r) => has(q(r, '[data-testid="error-body"]') || document.createElement("i"), "invalid_request") && has(r, "Error body (text MEASURED live, HTTP 400)")],
  ["nothing issued", "refused", "walk", (r) => tid(r, "nothing-issued") && has(r, "Nothing issued")],
  ["refused verdict", "refused", "walk", (r) => q(r, '[data-testid="verdict"]')?.getAttribute("data-ok") === "false"],
  // These live on an Advanced tab (one click from step 7 and from the Advanced menu).
  ["Setup guide (markdown)", "ok", "setup", (r) => tid(r, "markdown") && has(r, "PingOne token exchange with third-party signed JWTs")],
  ...D.TALK_TRACK.map((t) => [`talk track: ${t.title}`, "ok", "talk", (r) => has(q(r, '[data-testid="talk-track"]') || document.createElement("i"), t.title)]),
  ["Wire tab: runtime and setup calls with a decode box", "ok", "wire", (r) => tid(r, "wire-tab") && tid(r, "decode-input") && D.STEPS.length > 0],
  ["Exchange lab: the whole original page", "ok", "exchange", (r) => tid(r, "verdict") && tid(r, "checks") && tid(r, "subject") && tid(r, "actor") && tid(r, "legend")],
];
const TAB_BUTTON = { setup: "open-setup", talk: "open-talk", wire: "open-wire-7", exchange: "open-lab" };
const TAB_NAME = { setup: "Setup guide", talk: "Talk track", wire: "Wire", exchange: "Exchange lab" };

const settle = async () => { await screen.findByTestId("verdict"); await screen.findByTestId("compare"); await screen.findByTestId("admin-facts"); await waitFor(() => expect(document.querySelector('[data-testid="pattern-canvas"]')).not.toBeNull()); };
const failing = (scenario, root, only) => INVENTORY.filter(([, sc, w]) => sc === scenario && w === "walk" && (!only || only.has)).filter(([, , , chk]) => { try { return !chk(root); } catch { return true; } }).map(([n]) => n);

describe("inventory of the original tabs", () => {
  it("is not vacuous: on an empty page every item fails, so removing one makes the test fail", () => {
    const empty = document.createElement("div");
    const passing = INVENTORY.filter(([, , , chk]) => { try { return chk(empty); } catch { return false; } }).map(([n]) => n);
    expect(passing).toEqual([]);
    expect(INVENTORY.length).toBeGreaterThan(95);
  });
  it("the one-page view (#walk=all) shows every item, for a successful run and for a refused one", async () => {
    window.location.hash = "#walk=all";
    render(<App />);
    await screen.findByTestId("walk-all");
    await settle();
    expect(failing("ok", document.body)).toEqual([]);
    await userEvent.click(screen.getByTestId("walk-state-expired"));
    await waitFor(() => expect(document.querySelector('[data-testid="verdict"]').getAttribute("data-ok")).toBe("false"));
    await waitFor(() => expect(failing("refused", document.body)).toEqual([]));
  }, 30000);
  it("each walk item is on at least one of the seven steps", async () => {
    window.location.hash = "#walk=1";
    render(<App />);
    await screen.findByTestId("walk-heading");
    const need = new Set(INVENTORY.filter(([, sc, w]) => sc === "ok" && w === "walk").map(([n]) => n));
    const byName = Object.fromEntries(INVENTORY.map((i) => [i[0], i[3]]));
    for (let n = 1; n <= 7; n++) {
      if (n === 6) await screen.findByTestId("compare");
      if (n === 7) await screen.findByTestId("admin-facts");
      if (n === 4) { await screen.findByTestId("pattern-canvas"); await screen.findByTestId("wire-exchange"); const d = await screen.findByTestId("all-calls"); d.open = true; d.dispatchEvent(new Event("toggle")); }
      await waitFor(() => expect(screen.getByTestId("kicker")).toHaveTextContent(`Step ${n} of 7`));
      if ([2, 4, 5].includes(n)) await screen.findAllByTestId("decoded-token");
      for (const name of [...need]) { try { if (byName[name](document.body)) need.delete(name); } catch { /* not on this step */ } }
      if (n < 7) await userEvent.click(screen.getByTestId("walk-next"));
    }
    expect([...need]).toEqual([]);
    // the refused-only items: set the state on step 3, read them on step 5
    await userEvent.click(screen.getByTestId("rail-3"));
    await userEvent.click(screen.getByTestId("walk-state-expired"));
    await userEvent.click(screen.getByTestId("rail-5"));
    await waitFor(() => expect(document.querySelector('[data-testid="verdict"]').getAttribute("data-ok")).toBe("false"));
    expect(failing("refused", document.body)).toEqual([]);
  }, 40000);
  it("every item that lives on an Advanced tab stays one click from step 7 and from the Advanced menu, and is complete there", async () => {
    for (const tab of Object.keys(TAB_BUTTON)) {
      window.location.hash = "#walk=7";
      const { unmount } = render(<App />);
      await screen.findByTestId("admin-facts");
      await userEvent.click(screen.getByTestId(TAB_BUTTON[tab]));
      await screen.findByRole("tab", { name: TAB_NAME[tab], selected: true });
      await waitFor(() => { for (const [n, , w, chk] of INVENTORY) if (w === tab) expect(chk(document.body), n).toBe(true); }, { timeout: 8000 });
      // and from the Advanced menu
      await userEvent.click(screen.getByRole("tab", { name: "Guided walk" }));
      await userEvent.click(screen.getByRole("tab", { name: "Advanced" }));
      expect(screen.getByRole("tab", { name: TAB_NAME[tab] })).toBeInTheDocument();
      unmount();
    }
  }, 40000);
  it("keeps the original headings' wording on the walk", async () => {
    window.location.hash = "#walk=all";
    render(<App />);
    await settle();
    for (const h of ["How it is set up", "Try an issuer", "Trusted issuer settings", "Actor token state", "Result", "The calls of this run, in full", "Subject token (PingOne, MOCK)", "Attribute mapping on the custom resource", "Issued access token", "What each issuer puts in its token", "Admin API", "Permissions, events and licensing", "What this app does not show"]) expect(document.body.textContent, h).toContain(h);
  }, 30000);
});
