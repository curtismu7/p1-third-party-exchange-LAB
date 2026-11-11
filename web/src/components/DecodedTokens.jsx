import { useEffect, useMemo, useState } from "react";
import CopyButton from "./CopyButton";
import { describeToken, verifyAgainstJwks } from "../tokenDecode";
import { visible } from "../safeText";

function Card({ where, token, jwks }) {
  const d = useMemo(() => describeToken(token), [token]);
  const [sig, setSig] = useState(null);
  useEffect(() => { let live = true; if (d.ok) verifyAgainstJwks(token, jwks).then((r) => { if (live) setSig(r); }); return () => { live = false; }; }, [token, jwks, d.ok]);
  if (!d.ok) return (
    <div className="dtoken dtoken--bad" data-testid="decoded-token"><p><strong>{where}</strong> <span className="bad">not a valid JWT</span></p>
      {/* ui-pattern: allow P9 copy affordance on read-only pages; never the page primary */}
      <p className="muted">Raw <CopyButton text={token} label="Copy raw" /></p><pre className="json json--wrap json--raw">{visible(token)}</pre></div>
  );
  const sigClass = sig && (sig.state === "verified" ? "ok" : sig.state === "failed" ? "bad" : "muted");
  return (
    <div className="dtoken" data-testid="decoded-token" data-where={where}>
      <p className="dtoken__head"><strong>{where}</strong>{" "}
        <span className={`badge badge--${d.badge.state}`} data-testid="exp-badge">{d.badge.text}</span>{" "}
        {sig && <span className={`${sigClass} dtoken__sig`} data-testid="sig-badge">{sig.text}</span>}</p>
      <p className="muted">Header</p><pre className="json json--wrap" data-testid="decoded-header">{visible(JSON.stringify(d.header, null, 2))}</pre>
      <p className="muted">Payload <CopyButton text={JSON.stringify(d.payload, null, 2)} label="Copy decoded payload" /></p>
      <pre className="json json--wrap" data-testid="decoded-payload">{visible(JSON.stringify(d.payload, null, 2))}</pre>
      <div className="scroll"><table className="tbl claims" data-testid="claims-table"><thead><tr><th scope="col">Claim</th><th scope="col">Value</th><th scope="col">What it means</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.claim} className={r.highlight ? "claim--hl" : undefined}><td><code>{visible(r.claim)}</code></td><td>{visible(r.value)}</td><td>{r.note}</td></tr>)}</tbody></table></div>
      <p className="muted">Raw token <CopyButton text={token} label="Copy token" testId="decoded-copy-raw" /></p>
      <pre className="json json--wrap json--raw" data-testid="decoded-raw">{token}</pre>
    </div>
  );
}

export default function DecodedTokens({ tokens, jwks }) {
  return <div className="decoded" data-testid="decoded">{tokens.map((t, i) => <Card key={`${t.where}-${i}`} where={t.where} token={t.token} jwks={jwks} />)}</div>;
}
