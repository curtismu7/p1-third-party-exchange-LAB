import Tag from "./Tag";
import { visible } from "../safeText";

// Pieces of an exchange result shared by the Exchange lab tab and the Guided walk (one implementation, two places).
export function Verdict({ run, ev, children }) {
  return (
    <div className={`verdict verdict--${run.ok ? "allow" : "deny"}`} role="status" data-testid="verdict" data-ok={String(run.ok)}>
      <strong className="verdict__word">{run.ok ? "Exchange succeeds: a token is issued" : `Exchange refused: ${visible(run.failed.label)}`}</strong>{" "}
      <Tag kind={run.ok ? "unverified" : "measured"} evidence={ev} />
      {children || <p className="muted">The checks come from the guide and the refusal texts were <strong>measured</strong> live against PingOne on 2026-10-27; this app only copies them. The order PingOne evaluates the checks in when several fail is <strong>UNVERIFIED</strong>.</p>}
    </div>
  );
}

export function ChecksTable({ run }) {
  return (
    <table className="tbl" data-testid="checks" aria-label="Checks on the third-party token">
      <thead><tr><th scope="col">Check</th><th scope="col">Detail</th><th scope="col">Result</th></tr></thead>
      <tbody>{run.checks.map((c) => <tr key={c.id} data-check={c.id}><td>{c.label}</td><td><code>{visible(c.detail)}</code></td><td className={c.ok ? "ok" : "bad"}>{c.ok ? "pass" : "fail"}</td></tr>)}</tbody>
    </table>
  );
}

export function MappingList({ run, ev }) {
  return (
    <ul className="facts" data-testid="maps">
      {run.mapping.map((m) => (
        <li key={m.id}><Tag kind={m.evidence} evidence={ev} /> {m.label}. {m.note}{" "}
          <strong>{m.present ? "Source claim present." : `The token has no ${m.source}, so no claim is added.`}</strong></li>
      ))}
    </ul>
  );
}
