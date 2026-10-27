import { useEffect, useState } from "react";
import Json from "./Json";
import Tag from "./Tag";
import { exchange } from "../api";
import { visible } from "../safeText";

function Hops({ hops, traceId }) {
  return (
    <section aria-label="Mock hops with traceparent" data-testid="hops">
      <h3>Hops (W3C traceparent) <span className="muted">trace {traceId}</span></h3>
      {hops.map((h) => (
        <details key={h.n} open={h.n === 1}>
          <summary>{h.n}. {h.label}</summary>
          <p className="muted">Request</p><Json value={h.request} label={`Request of hop ${h.n}`} />
          <p className="muted">Response</p><Json value={h.response} label={`Response of hop ${h.n}`} />
        </details>
      ))}
    </section>
  );
}

const numberOf = (v) => (/^\d{1,10}$/.test(v) ? Number(v) : 0);

export default function ExchangePanel({ config, sel, setSel, resetSignal }) {
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const vendor = config.vendors.find((v) => v.id === sel.vendorId) || config.vendors[0];
  const ev = config.evidence;
  const setSetting = (k, v) => setSel((s) => ({ ...s, settings: { ...s.settings, [k]: v } }));

  // One mock exchange per change, debounced so typing in the audience box does not flood the server.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const res = await exchange({ vendorId: sel.vendorId, tokenState: sel.tokenState, settings: sel.settings, assigned: sel.assigned }).catch(() => ({ ok: false, status: 0, body: {} }));
      if (!live) return;
      if (res.ok) { setRun(res.body); setFail(null); } else setFail(`Could not run the exchange (${res.body.error || res.status}${res.body.detail ? `: ${res.body.detail}` : ""}).`);
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [sel, resetSignal]);

  return (
    <div className="exch">
      <section className="panel panel--wide" aria-labelledby="steps-h">
        <h2 id="steps-h">How it is set up <Tag kind="guide" evidence={ev} /></h2>
        <ol className="steps" data-testid="setup-steps">
          {config.steps.map((s) => <li key={s.n}><strong>{s.title}.</strong> {s.body} <code>{s.where}</code></li>)}
        </ol>
        <p className="legend" data-testid="legend">{Object.keys(ev).map((k) => <span key={k}><Tag kind={k} evidence={ev} /> {ev[k].note} </span>)}</p>
      </section>

      <section className="panel panel--wide" aria-labelledby="try-h">
        <h2 id="try-h">Try an issuer</h2>
        <div className="seg" role="group" aria-label="Third-party issuer">
          {config.vendors.map((v) => (
            <button key={v.id} type="button" aria-pressed={v.id === vendor.id} data-testid={`vendor-${v.id}`} onClick={() => { setSel((s) => ({ ...s, vendorId: v.id })); try { window.history.replaceState(null, "", `#vendor-${v.id}`); } catch { /* ignore */ } }}>{v.name}</button>
          ))}
        </div>
        <p className="muted" data-testid="vendor-note"><Tag kind={vendor.evidence} evidence={ev} /> {vendor.note}</p>
        <div className="two">
          <fieldset className="fields">
            <legend>Trusted issuer settings <Tag kind="guide" evidence={ev} /></legend>
            {["exp", "iat", "nbf"].map((k) => (
              <label key={k} className="check"><input type="checkbox" checked={sel.settings[`${k}Required`]} onChange={(e) => setSetting(`${k}Required`, e.target.checked)} data-testid={k} /> {k} required</label>
            ))}
            <label htmlFor="aud">Audiences (comma separated, blank accepts any)</label>
            <input id="aud" type="text" maxLength={600} value={sel.settings.audiences} onChange={(e) => setSetting("audiences", e.target.value)} data-testid="aud" placeholder="blank" />
            <label htmlFor="skew">Clock skew, seconds (0 to 60) <Tag kind="measured" evidence={ev} /></label>
            <input id="skew" type="number" min={0} max={60} step={1} value={sel.settings.clockSkew} onChange={(e) => setSetting("clockSkew", numberOf(e.target.value))} data-testid="skew" />
            <label htmlFor="maxfut">Maximum future validity, seconds (0 = no limit) <Tag kind="measured" evidence={ev} /></label>
            <input id="maxfut" type="number" min={0} max={31536000} step={1} value={sel.settings.maxFutureValidity} onChange={(e) => setSetting("maxFutureValidity", numberOf(e.target.value))} data-testid="maxfut" />
            <label className="check"><input type="checkbox" checked={sel.assigned} onChange={(e) => setSel((s) => ({ ...s, assigned: e.target.checked }))} data-testid="assigned" /> Assigned to the application</label>
          </fieldset>
          <fieldset className="fields">
            <legend>Actor token state</legend>
            {config.tokenStates.map((t) => (
              <label key={t.id} className="check"><input type="radio" name="token-state" checked={sel.tokenState === t.id} onChange={() => setSel((s) => ({ ...s, tokenState: t.id }))} data-testid={`state-${t.id}`} /> {t.label}</label>
            ))}
          </fieldset>
        </div>
      </section>

      {fail && <p className="field-error panel--wide" role="alert">{fail}</p>}
      {run && (
        <>
          <section className="panel panel--wide" aria-labelledby="res-h">
            <h2 id="res-h">Result</h2>
            <div className={`verdict verdict--${run.ok ? "allow" : "deny"}`} role="status" data-testid="verdict" data-ok={String(run.ok)}>
              <strong className="verdict__word">{run.ok ? "Exchange succeeds: a token is issued" : `Exchange refused: ${visible(run.failed.label)}`}</strong>{" "}
              <Tag kind={run.ok ? "unverified" : "measured"} evidence={ev} />
              <p className="muted">The checks come from the guide and the refusal texts were <strong>measured</strong> live against PingOne on 2026-10-27; this app only copies them. The order PingOne evaluates the checks in when several fail is <strong>UNVERIFIED</strong>.</p>
            </div>
            <table className="tbl" data-testid="checks" aria-label="Checks on the third-party token">
              <thead><tr><th scope="col">Check</th><th scope="col">Detail</th><th scope="col">Result</th></tr></thead>
              <tbody>{run.checks.map((c) => <tr key={c.id} data-check={c.id}><td>{c.label}</td><td><code>{visible(c.detail)}</code></td><td className={c.ok ? "ok" : "bad"}>{c.ok ? "pass" : "fail"}</td></tr>)}</tbody>
            </table>
          </section>
          <section className="panel" aria-labelledby="req-h">
            <h2 id="req-h">Token request <Tag kind="measured" evidence={ev} /></h2>
            <Json value={run.request} label="Token request" testId="request" />
            {run.error && (<><h3>Error body (text MEASURED live, HTTP {run.error.status}) <Tag kind="measured" evidence={ev} /></h3><Json value={run.error} label="PingOne error response" testId="error-body" /></>)}
          </section>
          <section className="panel" aria-labelledby="sub-h">
            <h2 id="sub-h">Subject token (PingOne, placeholder values)</h2>
            <p className="tag tag--warn">{config.tokenLabel}</p>
            <Json value={run.subject} label="Subject token claims" testId="subject" />
            <details><summary>As a mock JWT (never verifiable)</summary><Json value={run.jwts.subject} label="Mock subject JWT" /></details>
          </section>
          <section className="panel" aria-labelledby="act-h">
            <h2 id="act-h">Actor token: {run.vendor.name}</h2>
            <Json value={run.actor} label="Actor token claims" testId="actor" />
            <details><summary>As a mock JWT (never verifiable)</summary><Json value={run.jwts.actor} label="Mock actor JWT" /></details>
          </section>
          <section className="panel" aria-labelledby="map-h">
            <h2 id="map-h">Attribute mapping on the custom resource</h2>
            <ul className="facts" data-testid="maps">
              {run.mapping.map((m) => (
                <li key={m.id}><Tag kind={m.evidence} evidence={ev} /> {m.label}. {m.note}{" "}
                  <strong>{m.present ? "Source claim present." : `The token has no ${m.source}, so no claim is added.`}</strong></li>
              ))}
            </ul>
            <h3>{run.ok ? "Issued access token" : "Nothing issued"}</h3>
            {run.ok ? <><Json value={run.issued} label="Issued token claims" testId="issued" /><details><summary>As a mock JWT (never verifiable)</summary><Json value={run.jwts.issued} label="Mock issued JWT" /></details></> : <p className="muted" data-testid="nothing-issued">The exchange was refused, so no token is issued.</p>}
          </section>
          <section className="panel panel--wide"><Hops hops={run.hops} traceId={run.traceId} /></section>
        </>
      )}
      <p className="muted panel--wide" data-testid="limits-line">A third-party SUBJECT token is not simulated: the guide only shows actor tokens. See Admin and limits.</p>
    </div>
  );
}
