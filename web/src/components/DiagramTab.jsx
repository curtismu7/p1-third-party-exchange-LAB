import { useEffect, useState } from "react";
import PatternDiagram from "./PatternDiagram";
import { getJson } from "../api";
import { fromStudio } from "../studio";

export function diagramQuery(sel, vertical) {
  const q = new URLSearchParams({
    vendorId: sel.vendorId, tokenState: sel.tokenState, assigned: String(sel.assigned), audiences: sel.settings.audiences, vertical,
    expRequired: String(sel.settings.expRequired), iatRequired: String(sel.settings.iatRequired), nbfRequired: String(sel.settings.nbfRequired),
    clockSkew: String(sel.settings.clockSkew), maxFutureValidity: String(sel.settings.maxFutureValidity),
  });
  return q.toString();
}

export default function DiagramTab({ sel, vertical, resetSignal }) {
  const [pattern, setPattern] = useState(null);
  const [error, setError] = useState(null);
  const query = diagramQuery(sel, vertical);
  useEffect(() => {
    let live = true;
    getJson(`/api/diagram?${query}`).then((d) => { if (live) { setPattern(fromStudio(d)); setError(null); } }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [query]);
  if (error) return <p className="field-error" role="alert">Could not load the diagram ({error}).</p>;
  if (!pattern) return <p className="muted">Loading...</p>;
  return <PatternDiagram key={query} pattern={pattern} resetSignal={resetSignal} />;
}
