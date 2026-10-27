import { useCallback, useEffect, useRef, useState } from "react";
import ExchangePanel from "./components/ExchangePanel";
import DiagramTab from "./components/DiagramTab";
import CompareTab from "./components/CompareTab";
import SetupTab from "./components/SetupTab";
import AdminTab from "./components/AdminTab";
import TalkTrack from "./components/TalkTrack";
import WireTab from "./components/WireTab";
import { exchange, getJson, resetWorkspace } from "./api";

export const TABS = [
  { id: "exchange", label: "Exchange" },
  { id: "wire", label: "Wire" },
  { id: "diagram", label: "Diagram" },
  { id: "compare", label: "Claims compared" },
  { id: "setup", label: "Setup guide" },
  { id: "admin", label: "Admin and limits" },
  { id: "talk", label: "Talk track" },
];
// Which talk-track items presenter mode shows on each tab.
const SAY = { exchange: ["say-first", "what", "nbf", "mapping", "limits"], wire: ["wire"], diagram: ["what"], compare: ["mapping"], setup: ["setup"], admin: ["limits"] };
// The banner is never blank and never claims "not hosted" before it knows: until /api/info or /api/vendors answers (or if both fail)
// it says both, honestly.
const TAIL = "Nothing here calls PingOne, a third-party issuer or any tenant.";
export const BANNER_UNKNOWN = `SIMULATED / HOSTED SIMULATION: a mock of PingOne token exchange with a third-party actor token. ${TAIL}`;
const BANNER_LOCAL = `SIMULATED: a mock of PingOne token exchange with a third-party actor token. ${TAIL}`;
const BANNER_HOSTED = `HOSTED SIMULATION: a mock of PingOne token exchange with a third-party actor token. ${TAIL}`;
const FALLBACK = { vendorId: "pf-cc", tokenState: "valid", assigned: true, settings: { expRequired: true, iatRequired: false, nbfRequired: false, audiences: "", clockSkew: 0, maxFutureValidity: 0 } };
const initialSel = (defaults, vendorId) => ({ vendorId: vendorId || FALLBACK.vendorId, tokenState: "valid", assigned: defaults ? defaults.assigned : true, settings: defaults ? { expRequired: defaults.expRequired, iatRequired: defaults.iatRequired, nbfRequired: defaults.nbfRequired, audiences: defaults.audiences, clockSkew: defaults.clockSkew, maxFutureValidity: defaults.maxFutureValidity } : { ...FALLBACK.settings } });

// #exchange, #diagram ... select a tab; #vendor-<id> selects the Exchange tab and an issuer (checked against the server's list).
const hashParts = () => {
  const h = window.location.hash.replace("#", "");
  const m = /^vendor-([a-z0-9-]{1,40})$/.exec(h);
  if (m) return { tab: "exchange", vendor: m[1] };
  return { tab: TABS.some((t) => t.id === h) ? h : "exchange", vendor: null };
};

export default function App() {
  const [vertical, setVertical] = useState("retail");
  const [config, setConfig] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined = loading, null = failed
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(hashParts().tab);
  const [sel, setSel] = useState(() => initialSel(null, null));
  const [presenter, setPresenter] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const tabsRef = useRef(null);
  const wantVendor = useRef(hashParts().vendor);

  // One mock exchange per change of the controls, debounced so typing in the audience box does not flood the server. The result is
  // shared by the Exchange, Wire and Diagram tabs.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const res = await exchange({ vendorId: sel.vendorId, tokenState: sel.tokenState, settings: sel.settings, assigned: sel.assigned }).catch(() => ({ ok: false, status: 0, body: {} }));
      if (!live) return;
      if (res.ok) { setRun(res.body); setFail(null); } else setFail(`Could not run the exchange (${res.body.error || res.status}${res.body.detail ? `: ${res.body.detail}` : ""}).`);
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [sel, resetSignal]);
  useEffect(() => { getJson("/api/info").then(setInfo, () => setInfo(null)); }, []);
  useEffect(() => {
    getJson(`/api/vendors?vertical=${encodeURIComponent(vertical)}`).then((j) => {
      setConfig(j); setError(null);
      setSel((s) => {
        const wanted = wantVendor.current && j.vendors.some((v) => v.id === wantVendor.current) ? wantVendor.current : null;
        wantVendor.current = null;
        return wanted ? { ...s, vendorId: wanted } : s;
      });
    }, (e) => setError(e.message));
  }, [vertical]);
  useEffect(() => {
    const on = () => {
      const p = hashParts(); setTab(p.tab);
      if (p.vendor && config && config.vendors.some((v) => v.id === p.vendor)) setSel((s) => ({ ...s, vendorId: p.vendor }));
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [config]);
  const select = (id) => { setTab(id); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };

  // Keep the active tab fully in view in the scrolling tab strip (375px).
  useEffect(() => {
    const strip = tabsRef.current; const el = document.getElementById(`tab-${tab}`);
    if (!strip || !el) return;
    const left = el.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 8);
  }, [tab]);

  useEffect(() => {
    const on = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // Reset: the server forgets this workspace's exchanges, the controls go back to the guide defaults, and the diagram is back in place.
  const reset = useCallback(async () => {
    const ok = await resetWorkspace().catch(() => false);
    setSel(initialSel(config && config.defaults, null));
    setResetSignal((n) => n + 1);
    setResetMsg(ok ? "Reset: your workspace's exchanges are cleared, the settings are back to the defaults and the diagram is back in place." : "Reset failed on the server; the view was reset.");
  }, [config]);

  const onKeyTab = (e, i) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const hosted = config ? !!config.hosted : info ? !!info.hosted : null;
  const banner = config ? config.banner : hosted === true ? BANNER_HOSTED : hosted === false ? BANNER_LOCAL : BANNER_UNKNOWN;
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header>
        <p className="banner" role="status" data-testid="banner">{banner}</p>
        <div className="head">
          <div>
            <h1>P1 Third-Party Exchange</h1>
            {!presenter && config && <p className="intro">{config.intro}</p>}
          </div>
          <div className="head__tools">
            <span className="chip" data-testid="mode">Mode: {info ? info.mode : "mock"}{hosted === true ? " (hosted)" : hosted === false ? " (local)" : ""}</span>
            {!presenter && (
              <label className="inline">Vertical{" "}
                <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
                  {(config ? config.verticals : ["retail"]).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={reset} data-testid="reset">Reset</button>
            <button type="button" aria-pressed={presenter} onClick={() => setPresenter((v) => !v)} data-testid="presenter">{presenter ? "Exit presenter (Esc)" : "Presenter (P)"}</button>
          </div>
        </div>
      </header>
      <main>
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        <div role="tablist" aria-label="App sections" className="tabs" ref={tabsRef}>
          {TABS.map((t, i) => (
            <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              onClick={() => select(t.id)} onKeyDown={(e) => onKeyTab(e, i)}>{t.label}</button>
          ))}
        </div>
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {error ? <p className="app-error" role="alert">Could not load the app ({error}). Is the server running?</p> : !config ? <p className="muted">Loading...</p> : (
            <>
              {presenter && tab !== "talk" && (
                <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                  {config.talkTrack.filter((t) => (SAY[tab] || []).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
                </aside>
              )}
              {tab === "exchange" && <ExchangePanel config={config} sel={sel} setSel={setSel} run={run} fail={fail} />}
              {tab === "wire" && <WireTab run={run} evidence={config.evidence} config={config} />}
              {tab === "diagram" && <DiagramTab sel={sel} vertical={vertical} resetSignal={resetSignal} run={run} />}
              {tab === "compare" && <CompareTab evidence={config.evidence} />}
              {tab === "setup" && <SetupTab />}
              {tab === "admin" && <AdminTab evidence={config.evidence} />}
              {tab === "talk" && <TalkTrack talk={config.talkTrack} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
