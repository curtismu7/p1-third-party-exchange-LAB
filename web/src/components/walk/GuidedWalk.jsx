import { useEffect, useRef } from "react";
import { AllContext, STEPS, StepCompare, StepIdea, StepIssuer, StepKnow, StepResult, StepSend, StepTrust } from "./steps";
import "./walk.css";

const isTyping = (t) => t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || (t.closest && t.closest('[role="tablist"]')));

// The landing page: one idea per screen. The choices (issuer, switches, token state) are the same state the Exchange lab tab uses.
const ORDER = [StepIdea, StepIssuer, StepTrust, StepSend, StepResult, StepCompare, StepKnow];

export default function GuidedWalk({ step, setStep, allView, setAllView, ...rest }) {
  const headRef = useRef(null);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } if (!allView && headRef.current) headRef.current.focus(); }, [step, allView]);
  useEffect(() => {
    const on = (e) => {
      if (allView || isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") setStep(Math.min(STEPS.length - 1, step + 1));
      else if (e.key === "ArrowLeft") setStep(Math.max(0, step - 1));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [step, setStep, allView]);
  const last = step === STEPS.length - 1;
  const props = { headRef, ...rest };
  const Step = ORDER[step];
  const toolbar = (
    <div className="walk-toolbar">
      <button type="button" className="chip" aria-pressed={allView} onClick={() => setAllView(!allView)} data-testid="all-toggle">{allView ? "Back to the walk" : "See everything on one page"}</button>
    </div>
  );
  // Buttons that scroll (not anchors that change the hash), so the URL stays #walk=all.
  const scrollTo = (n) => { const el = document.getElementById(`walk-all-${n}`); if (el) { el.scrollIntoView({ behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); const h = document.getElementById(`walk-h-${n}`); if (h) h.focus({ preventScroll: true }); } };
  if (allView) {
    return (
      <div className="walk walk--all" data-testid="walk-all">
        {toolbar}
        <nav className="contents" aria-label="Contents" data-testid="contents"><strong>Everything on one page:</strong>
          {STEPS.map((s, i) => <button key={s.id} type="button" className="chip" onClick={() => scrollTo(i + 1)} data-testid={`contents-${i + 1}`}>{i + 1} · {s.title}</button>)}
        </nav>
        <AllContext.Provider value={true}>
          {ORDER.map((S, i) => <section className="step step--all" key={STEPS[i].id} id={`walk-all-${i + 1}`} aria-labelledby={`walk-h-${i + 1}`} data-testid={`walk-all-${i + 1}`}><S {...rest} /></section>)}
        </AllContext.Provider>
      </div>
    );
  }
  return (
    <div className="walk" data-testid="walk">
      {toolbar}
      <nav className="rail" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button key={s.id} type="button" className={i < step ? "done" : i === step ? "on" : ""} aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)} data-testid={`rail-${i + 1}`}><i /><span>{i + 1} · {s.title}</span></button>
        ))}
      </nav>
      <section className="step" key={step} aria-labelledby="walk-h" data-testid={`walk-step-${step + 1}`}><Step {...props} /></section>
      <div className="walkbar"><div className="in">
        <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="walk-back">← Back</button>
        <div className="where" aria-live="polite" data-testid="walk-where">Step {step + 1} of {STEPS.length}: {STEPS[step].title}</div>
        <button type="button" className="btn go" onClick={() => setStep(last ? 0 : step + 1)} data-testid="walk-next">{last ? "Start over" : "Next →"}</button>
      </div></div>
    </div>
  );
}
