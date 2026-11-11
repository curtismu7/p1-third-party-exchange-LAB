import { useEffect, useRef, useState } from "react";
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
// A run the server no longer holds (a restart, another pod, Reset) is never shown as a bare 404: the tab asks the app to run the
// exchange again with the CURRENT controls and retries once; only if that also fails does it show a friendly message and a button.
export default function WireTab({ run, evidence, config, onRefresh, fail }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | refreshing | failed | ok
  const [detail, setDetail] = useState("");
  const retried = useRef(false);
  const runId = run && run.runId;
  useEffect(() => {
    if (!runId) return undefined;
    let live = true;
    getJson(`/api/wire?runId=${encodeURIComponent(runId)}`).then((d) => { if (live) { setData(d); setState("ok"); retried.current = false; } }, async (e) => {
      if (!live) return;
      setDetail(e.message);
      if (retried.current || !onRefresh) { setState("failed"); return; }
      retried.current = true; setState("refreshing");
      const fresh = await onRefresh();
      if (live && !fresh) setState("failed"); // a fresh run changes runId, which re-runs this effect once
    });
    return () => { live = false; };
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  const again = async () => { retried.current = false; setState("refreshing"); const fresh = await onRefresh(); if (!fresh) setState("failed"); };
  if (fail && !run) return <FriendlyFail detail={fail} onAgain={onRefresh} />;
  if (!run || state === "loading") return <p className="muted">Loading...</p>;
  if (state === "refreshing") return <p className="muted" role="status" data-testid="wire-refreshing">Refreshing the run...</p>;
  if (state === "failed" || !data) return <FriendlyFail detail={detail} onAgain={again} />;
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

function FriendlyFail({ detail, onAgain }) {
  return (
    <section className="panel panel--warn" role="alert" data-testid="wire-failed">
      <h2>The run is not available right now</h2>
      <p>The server does not have this run any more (it may have restarted). Running the exchange again makes a new one.</p>
      <p><button type="button" className="primary" onClick={onAgain} data-testid="wire-again">Run it again</button></p>
      <details><summary>Details</summary><p className="muted">{detail || "no details"}</p></details>
    </section>
  );
}
