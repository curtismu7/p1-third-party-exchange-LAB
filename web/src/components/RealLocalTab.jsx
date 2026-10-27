import { useEffect, useRef, useState } from "react";
import ActorInspector from "./ActorInspector";
import TokenBlock from "./TokenBlock";
import WireItem from "./WireItem";
import { DecodeSwitch } from "./DecodeContext";
import { getJson, liveCall } from "../api";
import { TOKEN_TYPES, hintFor } from "../realExchange";

const EMPTY = { appId: "", appSecret: "", authStyle: "basic", scope: "", audience: "", resource: "", subjectMode: "paste", subjectToken: "", actorMode: "paste", actorToken: "", tpUrl: "", tpId: "", tpSecret: "", tpStyle: "basic", subjectType: TOKEN_TYPES[1][0], actorType: TOKEN_TYPES[0][0], extra: "", confirm: "" };
const ev = { measured: { label: "CAPTURED LIVE", note: "Captured from a real call in this run." } };

const extraObject = (t) => Object.fromEntries(String(t || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, Math.max(i, 0)).trim(), l.slice(i + 1)]; }));

// Owner-run: ONE real RFC 8693 request to the saved environment's token endpoint, sent by this local server. Creates and deletes nothing.
export default function RealLocalTab({ resetSignal }) {
  const [status, setStatus] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [msg, setMsg] = useState("");
  const seen = useRef(resetSignal);
  useEffect(() => { getJson("/api/live/status").then(setStatus, () => setMsg("Could not load live mode.")); }, []);
  useEffect(() => { if (seen.current !== resetSignal) { seen.current = resetSignal; setF(EMPTY); setOut(null); setMsg(""); } }, [resetSignal]);
  useEffect(() => () => setF(EMPTY), []);
  if (!status) return <p className="muted">{msg || "Loading..."}</p>;
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const env = status.settings.environmentId;
  const typed = f.confirm === env && status.settings.configured;
  const send = async () => {
    setBusy(true); setOut(null); setMsg("");
    const body = {
      confirm: f.confirm, appId: f.appId, appSecret: f.appSecret, authStyle: f.authStyle, scope: f.scope, audience: f.audience, resource: f.resource, subjectType: f.subjectType, actorType: f.actorType, extra: extraObject(f.extra),
      subject: f.subjectMode === "cc" ? { mode: "cc" } : { mode: "paste", token: f.subjectToken },
      actor: f.actorMode === "none" ? { mode: "none" } : f.actorMode === "paste" ? { mode: "paste", token: f.actorToken } : { mode: "fetch", fetch: { url: f.tpUrl, clientId: f.tpId, clientSecret: f.tpSecret, style: f.tpStyle } },
    };
    const r = await liveCall("/api/live/real/exchange", body);
    setBusy(false);
    if (r.ok && !r.body.error) setOut(r.body); else if (r.ok) setMsg(`${r.body.error}: ${r.body.detail || ""}`); else setMsg(`Not sent: ${r.body.detail || r.body.error}`);
  };
  const checkIssuer = async (info) => {
    const r = await liveCall("/api/live/real/issuer-check", { iss: info.iss, kid: info.kid || undefined, x5t: info.x5t || undefined });
    return r.ok ? r.body : { error: r.body.detail || r.body.error };
  };
  const err = out && out.pingoneError;
  const hint = err ? hintFor(JSON.stringify(err)) : null;
  const actorForInspect = out && out.actorToken ? out.actorToken : f.actorMode === "paste" ? f.actorToken : "";

  return (
    <div className="real" data-testid="real-local-tab">
      <section className="panel panel--wide panel--live" role="note" data-testid="real-local-banner">
        <h2>LIVE: this sends ONE real token exchange to your PingOne environment (it creates and deletes nothing)</h2>
        <p>{status.stub ? "This server is pointed at a loopback STUB, not at PingOne. " : ""}Environment {env || "(not saved: use the Live tab settings)"}, region {status.settings.region}. Client secrets are write-only: used for this request only, never returned, logged or stored.</p>
      </section>
      <section className="panel" aria-labelledby="rl-app">
        <h2 id="rl-app">Exchanging application</h2>
        <label htmlFor="rl-appid">Client id</label><input id="rl-appid" type="text" value={f.appId} onChange={set("appId")} autoComplete="off" data-testid="rl-appid" />
        <label htmlFor="rl-appsecret">Client secret</label><input id="rl-appsecret" type="password" value={f.appSecret} onChange={set("appSecret")} autoComplete="off" data-testid="rl-appsecret" />
        <label htmlFor="rl-auth">Client authentication</label>
        <select id="rl-auth" value={f.authStyle} onChange={set("authStyle")} data-testid="rl-auth"><option value="basic">HTTP Basic</option><option value="body">In the request body</option></select>
        <label htmlFor="rl-scope">Scope</label><input id="rl-scope" type="text" value={f.scope} onChange={set("scope")} data-testid="rl-scope" />
        <label htmlFor="rl-aud">Audience (optional)</label><input id="rl-aud" type="text" value={f.audience} onChange={set("audience")} />
        <label htmlFor="rl-res">Resource (optional)</label><input id="rl-res" type="text" value={f.resource} onChange={set("resource")} />
        <label htmlFor="rl-extra">Extra parameters (name=value per line)</label><textarea id="rl-extra" rows={2} value={f.extra} onChange={set("extra")} spellCheck={false} />
      </section>
      <section className="panel" aria-labelledby="rl-tok">
        <h2 id="rl-tok">Subject token</h2>
        <select value={f.subjectMode} onChange={set("subjectMode")} aria-label="Subject token source" data-testid="rl-submode"><option value="paste">Paste a token</option><option value="cc">Get a PingOne token by client credentials from this app</option></select>
        {f.subjectMode === "paste" && <textarea rows={3} value={f.subjectToken} onChange={set("subjectToken")} spellCheck={false} aria-label="Subject token" data-testid="rl-subject" />}
        <label htmlFor="rl-stype">subject_token_type</label>
        <select id="rl-stype" value={f.subjectType} onChange={set("subjectType")}>{TOKEN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <h2>Actor token</h2>
        <select value={f.actorMode} onChange={set("actorMode")} aria-label="Actor token source" data-testid="rl-actmode"><option value="paste">Paste a token</option><option value="fetch">Fetch from a third-party token endpoint (client credentials, one call)</option><option value="none">No actor token</option></select>
        {f.actorMode === "paste" && <textarea rows={3} value={f.actorToken} onChange={set("actorToken")} spellCheck={false} aria-label="Actor token" data-testid="rl-actor" />}
        {f.actorMode === "fetch" && (
          <>
            <label htmlFor="rl-tpurl">Third-party token endpoint (https; the host is looked up and must be public)</label><input id="rl-tpurl" type="text" value={f.tpUrl} onChange={set("tpUrl")} autoComplete="off" data-testid="rl-tpurl" />
            <label htmlFor="rl-tpid">Client id</label><input id="rl-tpid" type="text" value={f.tpId} onChange={set("tpId")} autoComplete="off" data-testid="rl-tpid" />
            <label htmlFor="rl-tpsecret">Client secret</label><input id="rl-tpsecret" type="password" value={f.tpSecret} onChange={set("tpSecret")} autoComplete="off" data-testid="rl-tpsecret" />
            <select value={f.tpStyle} onChange={set("tpStyle")} aria-label="Third-party client authentication"><option value="basic">HTTP Basic</option><option value="body">In the body</option></select>
          </>
        )}
        <label htmlFor="rl-atype">actor_token_type</label>
        <select id="rl-atype" value={f.actorType} onChange={set("actorType")}>{TOKEN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <ActorInspector token={actorForInspect} onCheckIssuer={checkIssuer} />
      </section>
      <section className="panel panel--wide" aria-labelledby="rl-send">
        <h2 id="rl-send">Send</h2>
        <label htmlFor="rl-confirm">Type the environment id to confirm</label>
        <input id="rl-confirm" type="text" value={f.confirm} onChange={set("confirm")} autoComplete="off" data-testid="rl-confirm" />
        <p><button type="button" disabled={!typed || busy} onClick={send} data-testid="rl-send">{busy ? "Sending..." : "Send the real exchange"}</button></p>
        {msg && <p className="field-error" role="alert" data-testid="rl-msg">{msg}</p>}
      </section>
      {out && (
        <section className="panel panel--wide" data-testid="rl-result">
          <h2>Result</h2>
          {out.stopped && <p className="field-error" role="alert">{out.stopped}</p>}
          {err && <p className="verdict verdict--deny" data-testid="rl-error"><strong>PingOne refused: HTTP {out.status}.</strong> {err.error_description || err.error}{hint ? ` Hint: ${hint.hint}` : ""}</p>}
          {out.issued && <TokenBlock label="Issued access token" token={out.issued} testId="rl-issued" />}
          {out.subjectToken && <TokenBlock label="Subject token" token={out.subjectToken} testId="rl-subject-out" />}
          {out.actorToken && <TokenBlock label="Actor token" token={out.actorToken} testId="rl-actor-out" />}
          <h3>Captured wire ({out.wire.length} calls)</h3>
          <p><DecodeSwitch /></p>
          {out.wire.map((i) => <WireItem key={i.id} item={i} evidence={ev} open={i.key === "exchange"} />)}
        </section>
      )}
    </div>
  );
}
