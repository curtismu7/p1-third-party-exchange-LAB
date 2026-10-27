import { useEffect, useState } from "react";
import WireItem from "./WireItem";
import { DecodeSwitch } from "./DecodeContext";
import { jwksFromWire } from "../tokenDecode";
import TokenBlock from "./TokenBlock";
import { getJson } from "../api";
import { decodeJwt } from "../jwt";
import { visible } from "../safeText";

function DecodeBox() {
  const [text, setText] = useState("");
  const d = text.trim() ? decodeJwt(text) : null;
  return (
    <section className="panel panel--wide" aria-labelledby="dec-h">
      <h2 id="dec-h">Decode a token</h2>
      <p className="muted">Paste any token string, for example one copied from a call above. It is decoded in your browser and sent nowhere. Signatures are not checked here.</p>
      <label htmlFor="dec-in">Token</label>
      <textarea id="dec-in" rows={4} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="decode-input" />
      {d && (d.error ? <p className="field-error" data-testid="decode-error">{d.error}</p> : (
        <div data-testid="decode-out"><p className="muted">Header</p><pre className="json json--wrap">{visible(JSON.stringify(d.header, null, 2))}</pre><p className="muted">Payload</p><pre className="json json--wrap">{visible(JSON.stringify(d.payload, null, 2))}</pre></div>
      ))}
    </section>
  );
}

// The Wire tab: every call of the current exchange, in full, from GET /api/wire?runId= (the same data POST /api/exchange returned).
export default function WireTab({ run, evidence, config }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const runId = run && run.runId;
  useEffect(() => {
    if (!runId) return undefined;
    let live = true;
    getJson(`/api/wire?runId=${encodeURIComponent(runId)}`).then((d) => { if (live) { setData(d); setError(null); } }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [runId]);
  if (!run) return <p className="muted">Loading...</p>;
  if (error) return <p className="field-error" role="alert">Could not load the wire ({error}).</p>;
  if (!data) return <p className="muted">Loading...</p>;
  return (
    <div className="wire" data-testid="wire-tab">
      <section className="panel panel--wide">
        <h2>Wire: every call, in full <span className="tag tag--warn">MOCK</span></h2>
        <p className="muted">{config.tokenLabel}. Every URL, header, body, token and credential below is shown whole: the hosts end in .example, the client ids are fake, the secrets are MOCK secrets that open nothing, and the JWTs are real RS256 tokens signed by keys that exist only in this server process. Nothing here was sent anywhere.</p>
        <p><DecodeSwitch /></p>
        <p className="muted">Run {data.runId}: {data.setup.length} setup calls (what an admin does once) then {data.wire.length} runtime calls.</p>
      </section>
      <section className="panel panel--wide" aria-labelledby="runtime-h">
        <h2 id="runtime-h">Runtime calls</h2>
        {data.wire.map((i, k) => <WireItem key={i.id} item={i} evidence={evidence} open={k === data.wire.length - 1} jwks={jwksFromWire(data.setup)} />)}
        <h3>Tokens in this run</h3>
        <TokenBlock label="Subject token (PingOne, MOCK)" token={run.jwts.subject} testId="wire-token-subject" />
        <TokenBlock label={`Actor token (${run.vendor.name})`} token={run.jwts.actor} testId="wire-token-actor" />
        {run.jwts.issued && <TokenBlock label="Issued access token (PingOne, MOCK)" token={run.jwts.issued} testId="wire-token-issued" />}
      </section>
      <section className="panel panel--wide" aria-labelledby="setup-h">
        <h2 id="setup-h">Setup calls (admin, once)</h2>
        {data.setup.map((i) => <WireItem key={i.id} item={i} evidence={evidence} jwks={jwksFromWire(data.setup)} />)}
      </section>
      <DecodeBox />
    </div>
  );
}
