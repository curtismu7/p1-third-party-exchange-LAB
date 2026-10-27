import { useEffect, useRef } from "react";
import { STEPS, StepCompare, StepIdea, StepIssuer, StepKnow, StepResult, StepSend, StepTrust } from "./steps";
import "./walk.css";

const isTyping = (t) => t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || (t.closest && t.closest('[role="tablist"]')));

// The landing page: one idea per screen. The choices (issuer, switches, token state) are the same state the Exchange lab tab uses.
export default function GuidedWalk({ step, setStep, ...rest }) {
  const headRef = useRef(null);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } if (headRef.current) headRef.current.focus(); }, [step]);
  useEffect(() => {
    const on = (e) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") setStep(Math.min(STEPS.length - 1, step + 1));
      else if (e.key === "ArrowLeft") setStep(Math.max(0, step - 1));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [step, setStep]);
  const last = step === STEPS.length - 1;
  const props = { headRef, ...rest };
  const Step = [StepIdea, StepIssuer, StepTrust, StepSend, StepResult, StepCompare, StepKnow][step];
  return (
    <div className="walk" data-testid="walk">
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
