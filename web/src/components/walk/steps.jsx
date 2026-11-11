import { createContext, useContext, useState } from "react";
import { Hops } from "../ExchangePanel";
import CopyButton from "../CopyButton";
import DecodedTokens from "../DecodedTokens";
import { DecodeSwitch, useDecode } from "../DecodeContext";
import DiagramTab from "../DiagramTab";
import CompareTab from "../CompareTab";
import AdminTab from "../AdminTab";
import Json from "../Json";
import Tag from "../Tag";
import WireItem from "../WireItem";
import { ChecksTable, MappingList, Verdict } from "../ResultParts";
import { jwksFromWire } from "../../tokenDecode";
import { visible } from "../../safeText";

export const STEPS = [
  { id: "idea", title: "The idea", min: 1 },
  { id: "issuer", title: "Pick an issuer", min: 1 },
  { id: "trust", title: "Set the trust", min: 2 },
  { id: "send", title: "Send it", min: 2 },
  { id: "result", title: "Read the result", min: 1 },
  { id: "compare", title: "Compare", min: 1 },
  { id: "know", title: "What to know", min: 2 },
];

// True while the one-page view stacks all seven steps: headings become h2 with unique ids and the full call list starts open.
export const AllContext = createContext(false);

// The big kicker, heading and lede of a step. The heading takes focus when the step changes (a11y).
export function Head({ n, title, lede, headRef }) {
  const s = STEPS[n - 1];
  const all = useContext(AllContext);
  const H = all ? "h2" : "h1";
  return (
    <>
      <div className="kick" data-testid={all ? `kicker-${n}` : "kicker"}>Step {n} of {STEPS.length} · ~{s.min} min</div>
      <H id={all ? `walk-h-${n}` : "walk-h"} ref={all ? undefined : headRef} tabIndex={-1} className={all ? "walk-title" : undefined} data-testid={all ? `walk-heading-${n}` : "walk-heading"}>{title}</H>
      {lede && <p className="lede">{lede}</p>}
    </>
  );
}
const Why = ({ children }) => <p className="why"><b>Why you care:</b> {children}</p>;

export function StepIdea({ headRef, config }) {
  const cards = [["Trust", "Tell PingOne which other issuer to believe (a trusted issuer)."], ["Assign", "Give that trust to one application."], ["Map", "Say which claims of the other token to copy into the new one."], ["Send", "The app sends both tokens in one request."]];
  return (
    <>
      <Head n={1} headRef={headRef} title="Let PingOne trust a token it didn't issue" lede={`An app like ${config.cast.castApp} has a PingOne token for the user, and a token from somewhere else (PingFederate, Okta, Auth0, Microsoft). PingOne can now check the second one and mix what it says into the token it hands back.`} />
      <div className="two">
        <div className="card"><h3>Before</h3><p>Both tokens had to come from <b>the same PingOne environment</b>.</p></div>
        <div className="card"><h3>Now</h3><p>The second token can come from <b>any issuer you trust</b>, as long as it is a signed JWT.</p></div>
      </div>
      <h2 className="walk-h2">Four things to set up</h2>
      <div className="four" data-testid="four-steps">{cards.map(([t, b], i) => <div className="card card--small" key={t}><span className="num">{i + 1}</span><h3>{t}</h3><p>{b}</p></div>)}</div>
      <details data-testid="how-set-up"><summary>How it is set up</summary>
        <ol className="steps" data-testid="setup-steps">{config.steps.map((st) => <li key={st.n}><strong>{st.title}.</strong> {st.body} <code>{st.where}</code></li>)}</ol>
        <p className="legend" data-testid="legend">{Object.keys(config.evidence).map((k) => <span key={k}><Tag kind={k} evidence={config.evidence} /> {config.evidence[k].note} </span>)}</p>
      </details>
      <Why>a partner or an agent platform keeps its own identity system. You can still say who acted, without moving anyone's identities.</Why>
    </>
  );
}

export function TokenView({ token, where, jwks }) {
  const { on } = useDecode();
  return (
    <>
      <p><DecodeSwitch /></p>
      {on ? <DecodedTokens tokens={[{ where, token }]} jwks={jwks} /> : (
        <><p className="muted">Raw token <CopyButton text={token} label="Copy token" /></p><pre className="json json--wrap json--raw" data-testid="walk-raw-token">{token}</pre></>
      )}
    </>
  );
}

export function StepIssuer({ headRef, config, sel, setSel, run }) {
  const vendor = config.vendors.find((v) => v.id === sel.vendorId) || config.vendors[0];
  const ev = config.evidence;
  return (
    <>
      <Head n={2} headRef={headRef} title="Whose token are we trusting?" lede="Pick an issuer. We'll use its sample token for the rest of the walk." />
      <h2 className="walk-h2">Try an issuer</h2>
      <div className="chips" role="radiogroup" aria-label="Third-party issuer" data-testid="walk-chips">
        {config.vendors.map((v) => <button key={v.id} type="button" role="radio" className="chip" aria-checked={v.id === vendor.id} data-testid={`walk-vendor-${v.id}`} onClick={() => setSel((s) => ({ ...s, vendorId: v.id }))}>{v.name}</button>)}
      </div>
      <div className="two">
        <div className="card"><h3>Actor token: {vendor.name}</h3>
          <p className="muted" data-testid="walk-vendor-note"><Tag kind={vendor.evidence} evidence={ev} /> {vendor.note}</p>
          <p className="muted">Issuer string: <code>{visible(vendor.issuer)}</code></p>
          {run ? <><TokenView token={run.jwts.actor} where={`sample token: ${vendor.name}`} jwks={run.jwks ? JSON.parse(run.jwks) : null} />
            <p className="muted" data-testid="signature-line">Signature check: {run.signature.ok ? "verified for real" : "FAILED for real"} against the JWKS posted in the trusted-issuer call ({run.signature.reason}).</p></> : <p className="muted">Loading...</p>}
        </div>
        <div className="card"><h3>Good to know</h3>
          <p>{vendor.note}</p>
          <p className="muted">These are MOCK tokens: real RS256 JWTs signed by a key that lives only in this server, with the claims of the vendor's published sample.</p>
        </div>
      </div>
    </>
  );
}

const num = (v, max) => { const n = /^\d{1,10}$/.test(v) ? Number(v) : 0; return Math.min(n, max); };

export function StepTrust({ headRef, config, sel, setSel, run }) {
  const set = (k, v) => setSel((s) => ({ ...s, settings: { ...s.settings, [k]: v } }));
  const req = (k, label, hint) => (
    <label className="toggle"><input type="checkbox" checked={sel.settings[`${k}Required`]} onChange={(e) => set(`${k}Required`, e.target.checked)} data-testid={`walk-${k}`} /><span><b>{label}</b><small>{hint}</small></span></label>
  );
  const issuerCall = run && run.setup.find((i) => i.key === "issuer");
  return (
    <>
      <Head n={3} headRef={headRef} title="Tell PingOne what to insist on" lede="The admin defines a trusted issuer and decides which claims must be there. Try turning one on, or change the state of the token." />
      <div className="two">
        <div className="card"><h3>Trusted issuer settings</h3>
          {req("exp", 'Require "expires" (exp)', "On by default.")}
          {req("iat", 'Require "issued at" (iat)', "PingFederate client-credentials tokens don't have one.")}
          {req("nbf", 'Require "not before" (nbf)', "Okta, Auth0 and PingFederate tokens don't have one.")}
          <label className="toggle"><input type="checkbox" checked={sel.assigned} onChange={(e) => setSel((s) => ({ ...s, assigned: e.target.checked }))} data-testid="walk-assigned" /><span><b>Assigned to the application</b><small>Turn off to see what an unassigned issuer does.</small></span></label>
          <label htmlFor="walk-skew">Clock skew, seconds (0 to 60)</label>
          <input id="walk-skew" type="number" min={0} max={60} value={sel.settings.clockSkew} onChange={(e) => set("clockSkew", num(e.target.value, 60))} data-testid="walk-skew" />
          <label htmlFor="walk-maxfut">Maximum future validity, seconds (0 = no limit)</label>
          <input id="walk-maxfut" type="number" min={0} max={31536000} value={sel.settings.maxFutureValidity} onChange={(e) => set("maxFutureValidity", num(e.target.value, 31536000))} data-testid="walk-maxfut" />
          <label htmlFor="walk-aud">Audiences (comma separated, blank accepts any)</label>
          <input id="walk-aud" type="text" maxLength={600} value={sel.settings.audiences} onChange={(e) => set("audiences", e.target.value)} data-testid="walk-aud" />
          <fieldset className="fields"><legend>Actor token state</legend>
            {config.tokenStates.map((t) => <label key={t.id} className="check"><input type="radio" name="walk-state" checked={sel.tokenState === t.id} onChange={() => setSel((s) => ({ ...s, tokenState: t.id }))} data-testid={`walk-state-${t.id}`} /> {t.label}</label>)}
          </fieldset>
        </div>
        <div className="card"><h3>What the admin sends</h3>
          <p className="muted">POST /trustedIssuers, exactly as it goes on the wire. It changes as you change the switches. <Tag kind="measured" evidence={config.evidence} /></p>
          {issuerCall ? <><p><CopyButton text={issuerCall.requestBody} label="Copy body" /></p><pre className="json json--wrap" tabIndex={0} aria-label="Trusted issuer request body" data-testid="walk-issuer-body">{visible(issuerCall.requestBodyPretty)}</pre></> : <p className="muted">Loading...</p>}
        </div>
      </div>
      <Why>this is the whole admin job: one trusted issuer, one assignment. The switches decide which tokens get through.</Why>
    </>
  );
}

export function StepSend({ headRef, config, sel, run, vertical, resetSignal, goTab }) {
  const all = useContext(AllContext);
  const [openAll, setOpenAll] = useState(false);
  const ev = config.evidence;
  const jwks = run ? jwksFromWire(run.setup) : null;
  const exchange = run && run.wire.find((w) => w.key === "exchange");
  return (
    <>
      <Head n={4} headRef={headRef} title="The app sends both tokens" lede="One request. The third-party token goes in as the actor and must say it is a JWT." />
      <div className="card card--wide"><DiagramTab sel={sel} vertical={vertical} resetSignal={resetSignal} run={run} /></div>
      <div className="card card--wide"><h2 className="walk-h2">The calls of this run, in full</h2>
        <p className="muted">Full URLs, every header, the exact bodies and the whole tokens; nothing is abbreviated. The same data as the Wire tab.</p>
        {exchange ? <WireItem item={exchange} evidence={ev} open jwks={jwks} /> : <p className="muted">Loading...</p>}
        {run && (
          <details open={all || undefined} onToggle={(e) => setOpenAll(e.currentTarget.open)} data-testid="all-calls"><summary>Show all {run.setup.length + run.wire.length} API calls</summary>
            {(openAll || all) && [...run.setup, ...run.wire].map((i) => <WireItem key={i.id} item={i} evidence={ev} jwks={jwks} />)}</details>
        )}
        {run && <><h3>Subject token (PingOne, MOCK)</h3><p className="tag tag--warn">{config.tokenLabel}</p><TokenView token={run.jwts.subject} where="subject token" jwks={jwks} /></>}
        <p className="buttons"><button type="button" className="btn" onClick={() => goTab("wire")} data-testid="open-wire">Open the Wire tab</button></p>
        {run && <details data-testid="hops-details"><summary>Hops (W3C traceparent)</summary><Hops hops={run.hops} traceId={run.traceId} /></details>}
      </div>
    </>
  );
}

export function StepResult({ headRef, config, run }) {
  const ev = config.evidence;
  if (!run) return (<><Head n={5} headRef={headRef} title="Result" /><p className="muted">Loading...</p></>);
  const jwks = run.jwks ? JSON.parse(run.jwks) : null;
  return (
    <>
      <Head n={5} headRef={headRef} title={run.ok ? "It worked" : "PingOne refused it"} />
      <Verdict run={run} ev={ev}><p className="muted">{run.ok ? "PingOne accepted the third-party token and copied the mapped claim into the token it issued." : "Nothing was issued. This is PingOne's own refusal text, measured live."}</p></Verdict>
      <div className="two">
        <div className="card"><h2 className="walk-h2">Result</h2><h3>What PingOne checked</h3><ChecksTable run={run} /><h3>Attribute mapping on the custom resource</h3><MappingList run={run} ev={ev} /></div>
        <div className="card">
          {run.ok ? (<><h3>Issued access token</h3><TokenView token={run.jwts.issued} where="issued access token" jwks={jwks} /></>) : (
            <><h3>Error body (text MEASURED live, HTTP {run.error.status})</h3><Json value={{ error: run.error.error, error_description: run.error.error_description }} label="PingOne error response" testId="error-body" />
              <h3>Nothing issued</h3><p className="muted" data-testid="nothing-issued">The exchange was refused, so no token is issued.</p></>
          )}
        </div>
      </div>
    </>
  );
}

export function StepCompare({ headRef, config }) {
  return (
    <>
      <Head n={6} headRef={headRef} title="Who puts what in their tokens?" lede="The same idea, named differently. The calling app id is the one you'll map most." />
      <CompareTab evidence={config.evidence} />
      <Why>the claim you copy into <code>act.sub</code> has a different name at each vendor: client_id, azp, cid or appid.</Why>
    </>
  );
}

export function StepKnow({ headRef, config, goTab, liveOn }) {
  return (
    <>
      <Head n={7} headRef={headRef} title="What to know before you rely on it" lede="Measured limits, what this app does not show, and where to try it for real." />
      <p className="muted" data-testid="limits-line">A third-party SUBJECT token is not simulated: the guide only shows actor tokens. See Admin and limits.</p>
      <AdminTab evidence={config.evidence} />
      <div className="card card--wide"><h3>The rest of the detail</h3>
        <p>Everything in the Advanced tabs is one click away.</p>
        <p className="buttons"><button type="button" className="btn" onClick={() => goTab("setup")} data-testid="open-setup">Open the Setup guide</button>
          <button type="button" className="btn" onClick={() => goTab("talk")} data-testid="open-talk">Open the Talk track</button>
          <button type="button" className="btn" onClick={() => goTab("wire")} data-testid="open-wire-7">Open the Wire tab</button>
          <button type="button" className="btn" onClick={() => goTab("exchange")} data-testid="open-lab">Open the Exchange lab</button></p></div>
      <div className="card card--wide"><h3>Try it with your own PingOne</h3>
        <p>The next tabs make a REAL request. The first sends it from your own browser to your own PingOne; nothing goes through this server.</p>
        <p className="buttons"><button type="button" className="btn" onClick={() => goTab("realbrowser")} data-testid="try-browser">Real exchange (your browser)</button>
          {liveOn && <button type="button" className="btn" onClick={() => goTab("reallocal")} data-testid="try-local">Real exchange (local)</button>}</p>
      </div>
    </>
  );
}
