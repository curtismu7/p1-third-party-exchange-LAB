import { Fragment, useEffect, useState } from "react";
import { getJson } from "../api";
import Json from "./Json";
import Tag from "./Tag";

export default function AdminTab({ evidence }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getJson("/api/setup").then(setData, (e) => setError(e.message)); }, []);
  if (error) return <p className="field-error" role="alert">Could not load the admin facts ({error}).</p>;
  if (!data) return <p className="muted">Loading...</p>;
  return (
    <div className="gate">
      <section className="panel" aria-labelledby="adm-api">
        <h2 id="adm-api">Admin API <Tag kind="guide" evidence={evidence} /></h2>
        <h3>POST /trustedIssuers</h3><Json value={data.apiSamples.trustedIssuer} label="Trusted issuer request" testId="api-issuer" />
        <h3>POST /applications/&lt;appId&gt;/trustedIssuerAssignments</h3><Json value={data.apiSamples.assignment} label="Assignment request" testId="api-assignment" />
      </section>
      <section className="panel" aria-labelledby="adm-facts">
        <h2 id="adm-facts">Permissions, events and licensing <Tag kind="guide" evidence={evidence} /></h2>
        <dl className="kv" data-testid="admin-facts">{data.adminFacts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      </section>
      <section className="panel panel--warn" aria-labelledby="adm-not" data-testid="not-shown">
        <h2 id="adm-not">What this app does not show <Tag kind="unverified" evidence={evidence} /></h2>
        <ul>{data.notShown.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
    </div>
  );
}
