import { useEffect, useState } from "react";
import { getJson } from "../api";
import Markdown from "./Markdown";

export default function SetupTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getJson("/api/setup").then(setData, (e) => setError(e.message)); }, []);
  if (error) return <p className="field-error" role="alert">Could not load the setup guide ({error}).</p>;
  if (!data) return <p className="muted">Loading...</p>;
  return <section className="panel panel--wide" aria-label="Setup guide" data-testid="setup-guide"><Markdown text={data.markdown} /></section>;
}
