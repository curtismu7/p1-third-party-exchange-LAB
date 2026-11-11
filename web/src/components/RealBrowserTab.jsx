import { useEffect, useRef, useState } from "react";
import ActorInspector from "./ActorInspector";
import TokenBlock from "./TokenBlock";
import WireItem from "./WireItem";
import { DecodeSwitch } from "./DecodeContext";
import { PF_HELP, TOKEN_TYPES, buildRequest, hintFor, parseTokenEndpoint, wireItemFor } from "../realExchange";

export const BROWSER_BANNER = "REAL: this sends a real request from your browser to your PingOne. Nothing goes through this server.";
const MAX_BODY = 256 * 1024;
const EMPTY = { endpoint: "", clientId: "", clientSecret: "", authStyle: "basic", scope: "", audience: "", subjectToken: "", subjectType: TOKEN_TYPES[1][0], actorToken: "", actorType: TOKEN_TYPES[0][0], extra: "" };

async function readCapped(res) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) return res.text();
  const dec = new TextDecoder(); let out = ''; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error("The response is larger than 256 KB; it was not read."); }
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}

/** The request goes from THIS browser straight to the visitor's PingOne. The secret lives only in React state: no storage, no URL, no cookie. */
export default function RealBrowserTab({ resetSignal }) {
  const [f, setF] = useState(EMPTY);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null); // { req, res, error }
  const [reveal, setReveal] = useState(false);
  const [includeSecret, setIncludeSecret] = useState(false);
  const seen = useRef(resetSignal);
  // Reset clears the secret and everything else; so does leaving the tab (unmount).
  useEffect(() => { if (seen.current !== resetSignal) { seen.current = resetSignal; setF(EMPTY); setSent(null); setConfirmed(false); setReveal(false); setIncludeSecret(false); } }, [resetSignal]);
  useEffect(() => () => { setF(EMPTY); }, []);
  // Local builds may offer a prefill (no secret ever); hosted answers 404 and the form stays empty.
  useEffect(() => {
    let alive = true;
    fetch("/api/real-prefill", { credentials: "omit" }).then((r) => (r.ok ? r.json() : null)).then((p) => { if (alive && p && typeof p === "object") setF((s) => { const next = { ...s }; for (const k of Object.keys(p)) if (k in EMPTY && k !== "clientSecret" && s[k] === EMPTY[k]) next[k] = p[k]; return next; }); }).catch(() => {});
    return () => { alive = false; };
  }, [resetSignal]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const ep = parseTokenEndpoint(f.endpoint);
  const draft = buildRequest(f);

  const send = async () => {
    const req = buildRequest(f);
    if (req.error) { setSent({ error: req.error }); return; }
    setBusy(true); setSent(null); setReveal(false);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body: req.body, mode: "cors", credentials: "omit", redirect: "manual", cache: "no-store", referrerPolicy: "no-referrer", signal: ctl.signal });
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) { setSent({ req, error: "PingOne answered with a redirect. It was not followed." }); return; }
      const text = await readCapped(res);
      setSent({ req, res: { status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], text } });
    } catch (e) {
      setSent({ req, error: e && e.name === "AbortError" ? "No answer within 20 seconds; the request was cancelled." : /Failed to fetch|NetworkError|Load failed/i.test(String(e && e.message)) ? "The browser could not complete the request (Failed to fetch). That is almost always CORS or the network: check the token endpoint URL is exactly your environment's, that you are online, that no extension or proxy blocks auth requests, and look in the browser's developer console (Network tab) for the CORS message. Nothing reached our server either way." : `The request failed: ${e && e.message}` });
    } finally { clearTimeout(timer); setBusy(false); }
  };

  const ready = ep.ok && !draft.error && confirmed && !busy;
  const item = sent && sent.req ? wireItemFor(sent.req, sent.res, { reveal, includeSecretInCurl: includeSecret }) : null;
  const hint = sent && sent.res && sent.res.status >= 400 ? hintFor(sent.res.text) : null;
  let issued = null; try { issued = sent && sent.res && sent.res.status === 200 ? JSON.parse(sent.res.text).access_token : null; } catch { /* not JSON */ }

  return (
    <div className="real" data-testid="real-browser-tab">
      <section className="panel panel--wide panel--live" role="note" data-testid="real-browser-banner"><h2>{BROWSER_BANNER}</h2>
        <p>The request is made by your browser (fetch, CORS, no cookies, no redirects). The secret and the tokens stay in this page: they are not stored, not put in the URL, and not sent to this app's server. Reset and leaving the tab clear them.</p></section>
      <section className="panel" aria-labelledby="rb-in">
        <h2 id="rb-in">Your PingOne</h2>
        <label htmlFor="rb-endpoint">Token endpoint of your environment</label>
        <input id="rb-endpoint" type="text" value={f.endpoint} onChange={set("endpoint")} autoComplete="off" spellCheck={false} placeholder="your auth host, then /<environment id>/as/token" data-testid="rb-endpoint" />
        <p className={ep.ok ? "muted" : "field-error"} data-testid="rb-parsed">{f.endpoint.trim() ? (ep.ok ? `Environment ${ep.envId}, region ${ep.region}, host ${ep.host}` : ep.error) : "Nothing entered yet."}</p>
        <label htmlFor="rb-client">Exchanging application: client id</label>
        <input id="rb-client" type="text" value={f.clientId} onChange={set("clientId")} autoComplete="off" data-testid="rb-client" />
        <label htmlFor="rb-secret">Client secret (kept only in this page)</label>
        <input id="rb-secret" type="password" value={f.clientSecret} onChange={set("clientSecret")} autoComplete="off" data-testid="rb-secret" />
        <label htmlFor="rb-auth">Client authentication</label>
        <select id="rb-auth" value={f.authStyle} onChange={set("authStyle")} data-testid="rb-auth"><option value="basic">HTTP Basic (Authorization header)</option><option value="body">In the request body</option></select>
        <label htmlFor="rb-scope">Scope</label><input id="rb-scope" type="text" value={f.scope} onChange={set("scope")} data-testid="rb-scope" />
        <label htmlFor="rb-aud">Audience (optional)</label><input id="rb-aud" type="text" value={f.audience} onChange={set("audience")} data-testid="rb-aud" />
        <label htmlFor="rb-extra">Extra parameters (optional, one name=value per line)</label>
        <textarea id="rb-extra" rows={2} value={f.extra} onChange={set("extra")} spellCheck={false} data-testid="rb-extra" />
      </section>
      <section className="panel" aria-labelledby="rb-tok">
        <h2 id="rb-tok">Tokens (paste)</h2>
        <label htmlFor="rb-subject">Subject token</label>
        <textarea id="rb-subject" rows={4} value={f.subjectToken} onChange={set("subjectToken")} spellCheck={false} data-testid="rb-subject" />
        <label htmlFor="rb-stype">subject_token_type</label>
        <select id="rb-stype" value={f.subjectType} onChange={set("subjectType")}>{TOKEN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label htmlFor="rb-actor">Actor token (the third-party token)</label>
        <textarea id="rb-actor" rows={4} value={f.actorToken} onChange={set("actorToken")} spellCheck={false} data-testid="rb-actor" />
        <label htmlFor="rb-atype">actor_token_type</label>
        <select id="rb-atype" value={f.actorType} onChange={set("actorType")} data-testid="rb-atype">{TOKEN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <ActorInspector token={f.actorToken} />
      </section>
      <section className="panel panel--wide" aria-labelledby="rb-pf">
        <h2 id="rb-pf">{PF_HELP[0]}</h2>
        <ul className="facts">{PF_HELP.slice(1).map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <section className="panel panel--wide" aria-labelledby="rb-send">
        <h2 id="rb-send">Send</h2>
        {draft.error && f.endpoint.trim() && <p className="muted" data-testid="rb-draft-error">{draft.error}</p>}
        <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="rb-confirm" /> I understand this sends a real request to MY PingOne</label>
        <p><button type="button" className="primary" disabled={!ready} onClick={send} data-testid="rb-send-btn">{busy ? "Sending..." : "Send real request from my browser"}</button></p>
        {sent && sent.error && <p className="field-error" role="alert" data-testid="rb-error">{sent.error}</p>}
      </section>
      {item && (
        <section className="panel panel--wide" aria-labelledby="rb-res" data-testid="rb-result">
          <h2 id="rb-res">Request and response</h2>
          <p className="muted">The Authorization header is redacted by default. <label className="check"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} data-testid="rb-reveal" /> Show it (only in your own browser)</label>
            <label className="check"><input type="checkbox" checked={includeSecret} onChange={(e) => setIncludeSecret(e.target.checked)} data-testid="rb-curl-secret" /> Include the secret in Copy curl</label></p>
          <p><DecodeSwitch /></p>
          <WireItem item={item} evidence={{ measured: { label: "YOUR REQUEST", note: "Sent from your browser." } }} open />
          {hint && <p className="verdict verdict--deny" data-testid="rb-hint"><strong>{hint.reason}.</strong> {hint.hint}</p>}
          {issued && <TokenBlock label="Issued access token" token={issued} testId="rb-issued" />}
        </section>
      )}
    </div>
  );
}
