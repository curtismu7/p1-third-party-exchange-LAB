import { useState } from "react";
import { inspectToken, trustedIssuerNote } from "../realExchange";
import { visible } from "../safeText";

// Client-side inspection of a pasted token: what a PingOne trusted issuer will look at. `onCheckIssuer` (tab 1 only) runs the server-side
// metadata check; the browser tab has none (nothing goes through this server).
export default function ActorInspector({ token, label = "Actor token inspector", onCheckIssuer }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const info = token && token.trim() ? inspectToken(token) : null;
  if (!info) return null;
  if (!info.ok) return <p className="field-error" data-testid="inspector-error">{label}: {info.error}</p>;
  const yes = (b) => (b ? "present" : "absent");
  const check = async () => { setBusy(true); setReport(await onCheckIssuer(info)); setBusy(false); };
  return (
    <div className="inspector" data-testid="inspector">
      <h4>{label}</h4>
      <dl className="kv">
        <dt>iss</dt><dd data-testid="insp-iss">{visible(info.iss || "(none)")}</dd>
        <dt>sub</dt><dd>{visible(String(info.sub ?? "(none)"))}</dd>
        <dt>aud</dt><dd>{visible(info.aud.join(", ") || "(none)")}</dd>
        <dt>exp / iat / nbf</dt><dd data-testid="insp-times">exp {yes(info.hasExp)}{info.expired ? " (EXPIRED)" : ""} / iat {yes(info.hasIat)} / nbf {yes(info.hasNbf)}</dd>
        <dt>header kid / x5t</dt><dd data-testid="insp-kid">kid {info.kid ? visible(info.kid) : "absent"} / x5t {info.x5t ? visible(info.x5t) : "absent"} (alg {visible(String(info.alg))})</dd>
        <dt>act claim</dt><dd data-testid="insp-act">{info.act}</dd>
      </dl>
      {info.notes.length > 0 && <ul className="facts" data-testid="insp-notes">{info.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="muted" data-testid="insp-note">{trustedIssuerNote(info)}</p>
      {onCheckIssuer && info.iss && <p><button type="button" onClick={check} disabled={busy} data-testid="check-issuer">{busy ? "Checking..." : "Check issuer metadata"}</button></p>}
      {report && (
        <div data-testid="issuer-report">
          {report.error ? <p className="field-error">{report.error}</p> : (
            <ul className="facts">
              <li>Discovery document: {report.discovery.reachable ? "reachable" : "NOT reachable"}{report.discovery.error ? ` (${visible(report.discovery.error)})` : ""}</li>
              <li>JWKS {report.jwks.url ? `(${visible(report.jwks.url)})` : ""}: {report.jwks.reachable ? `reachable, ${report.jwks.count} key(s), kids: ${report.jwks.kids.map(visible).join(", ") || "none"}` : "NOT reachable"}</li>
              <li>Token kid matches a key: {String(report.match.kid)} / x5t matches: {String(report.match.x5t)}</li>
              {report.flags.map((f) => <li key={f}><strong>{visible(f)}</strong></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
