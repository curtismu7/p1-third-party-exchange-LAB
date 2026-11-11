import { useCallback, useEffect, useRef, useState } from "react";
import ExchangePanel from "./components/ExchangePanel";
import DiagramTab from "./components/DiagramTab";
import CompareTab from "./components/CompareTab";
import SetupTab from "./components/SetupTab";
import AdminTab from "./components/AdminTab";
import TalkTrack from "./components/TalkTrack";
import WireTab from "./components/WireTab";
import { DecodeProvider } from "./components/DecodeContext";
import LiveTab from "./components/LiveTab";
import RealBrowserTab from "./components/RealBrowserTab";
import RealLocalTab from "./components/RealLocalTab";
import GuidedWalk from "./components/walk/GuidedWalk";
import { STEPS } from "./components/walk/steps";
import { REFIT_EVENT } from "./hooks/useFitOnResize";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu";
import { exchange, getJson, resetWorkspace, postMode } from "./api";
import ShelfLink from "./components/ShelfLink.jsx";

export const TABS = [
  { id: "exchange", label: "Exchange lab" },
  { id: "wire", label: "Wire" },
  { id: "diagram", label: "Diagram" },
  { id: "compare", label: "Claims compared" },
  { id: "setup", label: "Setup guide" },
  { id: "admin", label: "Admin and limits" },
  { id: "talk", label: "Talk track" },
];
// The landing page; everything in TABS (and the real/live tabs) sits under the Advanced group.
export const WALK_TAB = { id: "walk", label: "Guided walk" };
export const ADVANCED_TAB = { id: "advanced", label: "Advanced" };
// Added only when MODE=live is requested (owner-run, local); never in a mock or hosted build.
export const LIVE_TAB = { id: "live", label: "Live" };
export const REAL_BROWSER_TAB = { id: "realbrowser", label: "Real exchange (your browser)" };
export const REAL_LOCAL_TAB = { id: "reallocal", label: "Real exchange (local)" };
// Which talk-track items presenter mode shows on each tab.
const SAY = { exchange: ["trust", "result"], wire: ["send"], diagram: ["send"], compare: ["compare"], setup: ["idea"], admin: ["know"], realbrowser: ["know"], reallocal: ["know"], live: ["know"] };
// Which talk-track beat presenter mode shows on each step of the walk (the talk track has one beat per step).
const WALK_SAY = STEPS.map((x) => x.id);
// The banner is never blank and never claims "not hosted" before it knows: until /api/info or /api/vendors answers (or if both fail)
// it says both, honestly.
const TAIL = "Nothing here calls PingOne, a third-party issuer or any tenant.";
export const BANNER_UNKNOWN = `SIMULATED / HOSTED SIMULATION: a mock of PingOne token exchange with a third-party actor token. ${TAIL}`;
const BANNER_LOCAL = `SIMULATED: a mock of PingOne token exchange with a third-party actor token. ${TAIL}`;
const BANNER_HOSTED = `HOSTED SIMULATION: a mock of PingOne token exchange with a third-party actor token. ${TAIL}`;
const THEME_KEY = "p1tpe.theme";
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
function initialTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") return t; } catch { /* storage blocked */ }
  return "auto";
}
const FALLBACK = { vendorId: "pf-cc", tokenState: "valid", assigned: true, settings: { expRequired: true, iatRequired: false, nbfRequired: false, audiences: "", clockSkew: 0, maxFutureValidity: 0 } };
const initialSel = (defaults, vendorId) => ({ vendorId: vendorId || FALLBACK.vendorId, tokenState: "valid", assigned: defaults ? defaults.assigned : true, settings: defaults ? { expRequired: defaults.expRequired, iatRequired: defaults.iatRequired, nbfRequired: defaults.nbfRequired, audiences: defaults.audiences, clockSkew: defaults.clockSkew, maxFutureValidity: defaults.maxFutureValidity } : { ...FALLBACK.settings } });

// #walk=3 opens the Guided walk on step 3; #exchange, #diagram ... select an advanced tab; #vendor-<id> selects the Exchange lab and an issuer.
const hashParts = () => {
  const h = window.location.hash.replace("#", "");
  const w = /^walk(?:=(\d))?$/.exec(h);
  if (h === "walk=all") return { tab: "walk", step: 0, all: true, vendor: null };
  if (w) { const n = Number(w[1] || 1); return { tab: "walk", step: n >= 1 && n <= STEPS.length ? n - 1 : 0, vendor: null }; }
  if (["live", "realbrowser", "reallocal"].includes(h)) return { tab: h, step: 0, vendor: null };
  const m = /^vendor-([a-z0-9-]{1,40})$/.exec(h);
  if (m) return { tab: "exchange", step: 0, vendor: m[1] };
  return { tab: TABS.some((t) => t.id === h) ? h : "walk", step: 0, vendor: null };
};

function AppInner() {
  const [vertical, setVertical] = useState("retail");
  const [config, setConfig] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined = loading, null = failed
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(hashParts().tab);
  const [step, setStepState] = useState(hashParts().step);
  const [allView, setAllViewState] = useState(Boolean(hashParts().all));
  const [lastAdvanced, setLastAdvanced] = useState("exchange");
  const [sel, setSel] = useState(() => initialSel(null, null));
  const [presenter, setPresenter] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const [theme, setTheme] = useState(initialTheme);
  // Text size: S/M/L (the shared TopMenu control) driving the root --fs; the percent-based FontSize stepper it
  // replaces also refreshed the diagram, so a change re-fits it too.
  const [fontStep, setFontStep] = useState(() => { try { const f = localStorage.getItem("p1tpx.fontstep"); return ["S", "M", "L"].includes(f) ? f : "M"; } catch { return "M"; } });
  const tabsRef = useRef(null);
  const selRef = useRef(null);
  const wantVendor = useRef(hashParts().vendor);

  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    applyFontSize(fontStep);
    try { localStorage.setItem("p1tpx.fontstep", fontStep); } catch { /* not remembered */ }
    const t = setTimeout(() => window.dispatchEvent(new Event(REFIT_EVENT)), 50); // let the diagram re-fit after the text grows
    return () => clearTimeout(t);
  }, [fontStep]);

  const pickTheme = (next) => {
    try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };

  // One mock exchange per change of the controls, debounced so typing in the audience box does not flood the server. The result is
  // shared by the Exchange, Wire and Diagram tabs.
  selRef.current = sel;
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
  // Rule 19: the toggle asks the server; a refusal (409/403) keeps the current mode on screen.
  const selectMode = async (source) => {
    const res = await postMode(source);
    if (res.ok) setInfo(res.body);
  };
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
      const p = hashParts(); setTab(p.tab); if (p.tab === "walk") { if (p.all) setAllViewState(true); else { setAllViewState(false); setStepState(p.step); } }
      if (p.vendor && config && config.vendors.some((v) => v.id === p.vendor)) setSel((s) => ({ ...s, vendorId: p.vendor }));
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [config]);
  const select = (id) => {
    setTab(id); if (id !== "walk") setLastAdvanced(id);
    try { window.history.replaceState(null, "", id === "walk" ? (allView ? "#walk=all" : `#walk=${step + 1}`) : `#${id}`); } catch { /* ignore */ }
  };
  // "See everything on one page": #walk=all. Going back restores the step the visitor was on (step state is kept untouched).
  const setAllView = (on) => { setAllViewState(on); try { window.history.replaceState(null, "", on ? "#walk=all" : `#walk=${step + 1}`); } catch { /* ignore */ } };
  const setStep = (n) => { setStepState(n); try { window.history.replaceState(null, "", `#walk=${n + 1}`); } catch { /* ignore */ } };

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

  // Run the exchange again with the CURRENT controls (used when the server no longer has the run a view asked for).
  const refreshRun = useCallback(async () => {
    const c = selRef.current;
    const res = await exchange({ vendorId: c.vendorId, tokenState: c.tokenState, settings: c.settings, assigned: c.assigned }).catch(() => ({ ok: false, status: 0, body: {} }));
    if (res.ok) { setRun(res.body); setFail(null); return res.body; }
    setFail(`Could not run the exchange (${res.body.error || res.status}).`);
    return null;
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
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const liveInfo = info && info.live && info.live.requested ? info.live : null;
  const liveOn = Boolean(liveInfo && liveInfo.enabled);
  const advancedTabs = [...TABS, REAL_BROWSER_TAB, ...(liveInfo ? [LIVE_TAB] : []), ...(liveOn ? [REAL_LOCAL_TAB] : [])];
  const tabs = advancedTabs;
  const hosted = config ? !!config.hosted : info ? !!info.hosted : null;
  const banner = config ? config.banner : hosted === true ? BANNER_HOSTED : hosted === false ? BANNER_LOCAL : BANNER_UNKNOWN;
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header className="shell-bar">
        <span className="shell-brand"><span className="shell-logo" aria-hidden="true">P1</span> Third-Party Exchange</span>
        <span className="shell-spacer" />
        <span className="shell-right">
          <TopMenu
            mode={{ value: info?.source === "real" ? "real" : "mock", onChange: selectMode, realAvailable: info ? info.realAvailable === true : null, realHint: info && info.realAvailable !== true ? (info.live?.reasons || []).join("; ") || undefined : undefined }}
            vertical={{ value: vertical, onChange: setVertical, options: config ? config.verticals : ["retail"] }}
            theme={{ value: theme, onChange: pickTheme }}
            fontSize={{ value: fontStep, onChange: setFontStep }}
            present={{ active: presenter, onToggle: () => setPresenter((v) => !v), label: "Presenter (P)" }}
            talkTrack={{ active: tab === "talk", onToggle: () => select("talk") }}
            help={{ href: "https://github.com/curtismu7/p1-third-party-exchange-LAB#readme" }}
            version={info?.version || null}
            onReset={reset}
          >
            <ShelfLink />
          </TopMenu>
        </span>
      </header>
      <main className="page">
        <p className="banner" role="status" data-testid="banner">{banner}</p>
        <div className="head">
          <div>
            <h1 className="page-title">PingOne token exchange with third-party tokens</h1>
            {!presenter && config && tab !== "walk" && <p className="intro">{config.intro}</p>}
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        <div role="tablist" aria-label="Sections" className="tabs tabs--primary">
          <button id="tab-walk" role="tab" type="button" aria-selected={tab === "walk"} aria-controls="panel-walk" onClick={() => select("walk")}>{WALK_TAB.label}</button>
          <button id="tab-advanced" role="tab" type="button" aria-selected={tab !== "walk"} aria-controls="panel-advanced" onClick={() => select(tab === "walk" ? lastAdvanced : tab)} data-testid="tab-advanced">{ADVANCED_TAB.label}</button>
        </div>
        {tab !== "walk" && (
          <div role="tablist" aria-label="Advanced tools" className="tabs" ref={tabsRef}>
            {tabs.map((t, i) => (
              <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
                onClick={() => select(t.id)} onKeyDown={(e) => onKeyTab(e, i)}>{t.label}</button>
            ))}
          </div>
        )}
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab !== "walk" && <p className="sr-only">{(tabs.find((t) => t.id === tab) || {}).label}</p>}
          {error ? <p className="app-error" role="alert">Could not load the app ({error}). Is the server running?</p> : !config ? <p className="muted">Loading...</p> : (
            <>
              {presenter && tab !== "talk" && (
                <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                  {config.talkTrack.filter((t) => (tab === "walk" ? [WALK_SAY[step]] : SAY[tab] || []).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
                </aside>
              )}
              {tab === "walk" && <GuidedWalk step={step} setStep={setStep} allView={allView} setAllView={setAllView} config={config} sel={sel} setSel={setSel} run={run} fail={fail} vertical={vertical} resetSignal={resetSignal} goTab={select} liveOn={liveOn} />}
              {tab === "exchange" && <ExchangePanel config={config} sel={sel} setSel={setSel} run={run} fail={fail} />}
              {tab === "wire" && <WireTab run={run} evidence={config.evidence} config={config} onRefresh={refreshRun} fail={fail} />}
              {tab === "diagram" && <DiagramTab sel={sel} vertical={vertical} resetSignal={resetSignal} run={run} />}
              {tab === "compare" && <CompareTab evidence={config.evidence} />}
              {tab === "setup" && <SetupTab />}
              {tab === "admin" && <AdminTab evidence={config.evidence} />}
              {tab === "talk" && <TalkTrack talk={config.talkTrack} />}
              {tab === "realbrowser" && <RealBrowserTab resetSignal={resetSignal} />}
              {tab === "reallocal" && liveOn && <RealLocalTab resetSignal={resetSignal} />}
              {tab === "live" && liveInfo && <LiveTab reasons={liveInfo.enabled ? [] : liveInfo.reasons} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return <DecodeProvider><AppInner /></DecodeProvider>;
}
