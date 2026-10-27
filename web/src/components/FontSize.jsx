import { useEffect, useState } from "react";
import { REFIT_EVENT } from "../hooks/useFitOnResize";

export const FS_MIN = 80;
export const FS_MAX = 170;
export const FS_STEP = 10;
const KEY = "p1tpx.fontsize";
export function readFontSize() {
  try { const v = Number(window.localStorage.getItem(KEY)); if (Number.isInteger(v) && v >= FS_MIN && v <= FS_MAX && v % FS_STEP === 0) return v; } catch { /* blocked storage */ }
  return 100;
}
function writeFontSize(v) { try { window.localStorage.setItem(KEY, String(v)); } catch { /* blocked storage: the control still works for this page */ } }

// Global text size: the root font-size. Every size in the app is rem, so text, diagram labels and token blocks all scale together.
export default function FontSize() {
  const [pct, setPct] = useState(readFontSize);
  useEffect(() => {
    document.documentElement.style.fontSize = `${pct}%`;
    const t = setTimeout(() => window.dispatchEvent(new Event(REFIT_EVENT)), 50); // let the diagram re-fit after the text grows
    return () => clearTimeout(t);
  }, [pct]);
  const set = (v) => { const n = Math.max(FS_MIN, Math.min(FS_MAX, v)); setPct(n); writeFontSize(n); };
  return (
    <div className="fontctl" role="group" aria-label="Text size" data-testid="fontctl">
      <button type="button" onClick={() => set(pct - FS_STEP)} disabled={pct <= FS_MIN} aria-label="Smaller text" data-testid="fs-down">A−</button>
      <output aria-live="polite" data-testid="fs-value">{pct}%</output>
      <button type="button" onClick={() => set(pct + FS_STEP)} disabled={pct >= FS_MAX} aria-label="Larger text" data-testid="fs-up">A+</button>
      <button type="button" onClick={() => set(100)} aria-label="Reset text size" title="Reset" data-testid="fs-reset">↺</button>
    </div>
  );
}
