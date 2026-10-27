import { useEffect, useState } from "react";
import PatternDiagram from "./PatternDiagram";
import { getJson } from "../api";
import { fromStudio } from "../studio";
import { wireHopText } from "../wireHop";

export function diagramQuery(sel, vertical) {
  const q = new URLSearchParams({
    vendorId: sel.vendorId, tokenState: sel.tokenState, assigned: String(sel.assigned), audiences: sel.settings.audiences, vertical,
    expRequired: String(sel.settings.expRequired), iatRequired: String(sel.settings.iatRequired), nbfRequired: String(sel.settings.nbfRequired),
    clockSkew: String(sel.settings.clockSkew), maxFutureValidity: String(sel.settings.maxFutureValidity),
  });
  return q.toString();
}

export default function DiagramTab({ sel, vertical, resetSignal, run }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const query = diagramQuery(sel, vertical);
  useEffect(() => {
    let live = true;
    getJson(`/api/diagram?${query}`).then((d) => { if (live) { setDoc(d); setError(null); } }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [query]);
  if (error) return <p className="field-error" role="alert">Could not load the diagram ({error}).</p>;
  if (!doc) return <p className="muted">Loading...</p>;
  const pattern = fromStudio(doc, (hop) => wireHopText(run, hop));
  return <PatternDiagram key={query} pattern={pattern} resetSignal={resetSignal} />;
}
