import Json from "./Json";
import Tag from "./Tag";
import TokenBlock from "./TokenBlock";
import WireItem from "./WireItem";
import { ChecksTable, MappingList, Verdict } from "./ResultParts";
import { DecodeSwitch } from "./DecodeContext";
import { jwksFromWire } from "../tokenDecode";
import { visible } from "../safeText";

export function Hops({ hops, traceId }) {
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

export default function ExchangePanel({ config, sel, setSel, run, fail }) {
  const vendor = config.vendors.find((v) => v.id === sel.vendorId) || config.vendors[0];
  const ev = config.evidence;
  const setSetting = (k, v) => setSel((s) => ({ ...s, settings: { ...s.settings, [k]: v } }));

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
            <Verdict run={run} ev={ev} />
            <ChecksTable run={run} />
          </section>
          <section className="panel panel--wide" aria-labelledby="req-h">
            <h2 id="req-h">The calls of this run, in full <Tag kind="measured" evidence={ev} /></h2>
            <p><DecodeSwitch /></p>
            <p className="muted">The same data as the Wire tab. Full URLs, every header, the exact bodies and the whole tokens; nothing is abbreviated.</p>
            {run.wire.map((i, k) => <WireItem key={i.id} item={i} evidence={ev} open={k === run.wire.length - 1} jwks={jwksFromWire(run.setup)} />)}
            {run.error && (<><h3>Error body (text MEASURED live, HTTP {run.error.status}) <Tag kind="measured" evidence={ev} /></h3><Json value={{ error: run.error.error, error_description: run.error.error_description }} label="PingOne error response" testId="error-body" /></>)}
          </section>
          <section className="panel" aria-labelledby="sub-h">
            <h2 id="sub-h">Subject token (PingOne, MOCK)</h2>
            <p className="tag tag--warn">{config.tokenLabel}</p>
            <TokenBlock label="Subject token" token={run.jwts.subject} testId="subject" />
          </section>
          <section className="panel" aria-labelledby="act-h">
            <h2 id="act-h">Actor token: {run.vendor.name}</h2>
            <TokenBlock label="Actor token" token={run.jwts.actor} testId="actor" />
            <p className="muted" data-testid="signature-line">Signature check: {run.signature.ok ? "verified for real" : "FAILED for real"} against the JWKS posted in the trusted-issuer call ({run.signature.reason}).</p>
          </section>
          <section className="panel" aria-labelledby="map-h">
            <h2 id="map-h">Attribute mapping on the custom resource</h2>
            <MappingList run={run} ev={ev} />
            <h3>{run.ok ? "Issued access token" : "Nothing issued"}</h3>
            {run.ok ? <TokenBlock label="Issued access token (PingOne, MOCK)" token={run.jwts.issued} testId="issued" /> : <p className="muted" data-testid="nothing-issued">The exchange was refused, so no token is issued.</p>}
          </section>
          <section className="panel panel--wide"><Hops hops={run.hops} traceId={run.traceId} /></section>
        </>
      )}
      <p className="muted panel--wide" data-testid="limits-line">A third-party SUBJECT token is not simulated: the guide only shows actor tokens. See Admin and limits.</p>
    </div>
  );
}
