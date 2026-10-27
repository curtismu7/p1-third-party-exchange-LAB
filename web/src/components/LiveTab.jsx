import { useEffect, useState } from "react";
import WireItem from "./WireItem";
import CopyButton from "./CopyButton";
import { DecodeSwitch } from "./DecodeContext";
import { jwksFromWire } from "../tokenDecode";
import { getJson, liveCall } from "../api";
import { visible } from "../safeText";

const REGIONS = ["com", "eu", "asia", "ca", "au", "sg"];
const predicted = (p) => (p.status === 200 ? `HTTP 200 · act ${JSON.stringify(p.expect.act)} · security ${JSON.stringify(p.expect.security)} · sub ${p.expect.hasSub ? "present" : "absent"}${p.expect.ext_sub ? ` · ext_sub ${p.expect.ext_sub}` : ""}` : `HTTP ${p.status} · ${p.reason}`);
const liveText = (l) => (l.status === 200 ? `HTTP 200 · act ${JSON.stringify(l.summary.act)} · security ${JSON.stringify(l.summary.security)} · sub ${l.summary.hasSub ? "present" : "absent"}${l.summary.ext_sub ? ` · ext_sub ${l.summary.ext_sub}` : ""}` : `HTTP ${l.status} · ${l.description || ""}`);
export const mismatchText = (list) => list.map((m) => `${m.scenario} | ${m.field} | mock predicted: ${m.predicted} | live: ${m.live}`).join("\n");

export default function LiveTab({ reasons }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ environmentId: "", region: "com", clientId: "", clientSecret: "" });
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [clean, setClean] = useState(null);

  const load = () => getJson("/api/live/status").then((s) => {
    setStatus(s); setError(null);
    setForm((f) => ({ ...f, environmentId: s.settings.environmentId, region: s.settings.region === "com.au" ? "au" : s.settings.region, clientId: s.settings.clientId, clientSecret: "" }));
    setPicked((p) => p || s.scenarios.map((x) => x.id));
  }, (e) => setError(e.message));
  useEffect(() => { if (!reasons.length) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (reasons.length) {
    return (
      <section className="panel panel--warn" data-testid="live-refused">
        <h2>Live mode is off</h2>
        <p>MODE=live was requested, but live mode is refused here:</p>
        <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p>Live mode is owner-run and local only: <code>MODE=live P1TPX_ALLOW_LIVE=1 ./scripts/run.sh</code> on this machine. It never runs in the hosted build.</p>
      </section>
    );
  }
  if (error) return <p className="field-error" role="alert">Could not load live mode ({error}).</p>;
  if (!status) return <p className="muted">Loading...</p>;

  const save = async () => {
    setMsg("");
    const r = await liveCall("/api/live/settings", form);
    if (r.ok) { setMsg("Saved. The secret is write-only: it now shows as set."); await load(); } else setMsg(`Not saved: ${r.body.detail || r.body.error}`);
  };
  const run = async () => {
    setBusy(true); setReport(null); setMsg("");
    const r = await liveCall("/api/live/run", { confirm, scenarios: picked });
    setBusy(false);
    if (r.ok) setReport(r.body); else setMsg(`The run did not start: ${r.body.detail || r.body.error}`);
  };
  const cleanup = async () => {
    setBusy(true); setClean(null);
    const r = await liveCall("/api/live/cleanup", { confirm });
    setBusy(false);
    if (r.ok) setClean(r.body); else setMsg(`Clean up did not run: ${r.body.detail || r.body.error}`);
  };
  const ready = status.settings.configured;
  const typed = confirm === status.settings.environmentId && ready;
  const ev = { measured: { label: "CAPTURED LIVE", note: "Captured from a real call in this run." } };

  return (
    <div className="live" data-testid="live-tab">
      <section className="panel panel--wide panel--live" role="note" data-testid="live-banner">
        <h2>LIVE: this writes to a real PingOne environment and deletes it again</h2>
        <p>{status.banner}{status.stub ? " (This server is pointed at a loopback STUB, not at PingOne.)" : ""}</p>
      </section>
      <section className="panel" aria-labelledby="live-set">
        <h2 id="live-set">Settings (write-only secret)</h2>
        <label htmlFor="live-env">Environment id</label><input id="live-env" type="text" value={form.environmentId} onChange={(e) => setForm({ ...form, environmentId: e.target.value })} data-testid="live-env" />
        <label htmlFor="live-region">Region</label>
        <select id="live-region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} data-testid="live-region">{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <label htmlFor="live-client">Worker client id</label><input id="live-client" type="text" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} data-testid="live-client" />
        <label htmlFor="live-secret">Worker client secret <span className="tag" data-testid="live-secret-state">{status.settings.clientSecret || "not set"}</span></label>
        <input id="live-secret" type="password" autoComplete="off" value={form.clientSecret} placeholder={status.settings.clientSecret ? "leave blank to keep" : ""} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} data-testid="live-secret" />
        <p><button type="button" onClick={save} data-testid="live-save">Save settings</button></p>
        <p className="muted">Stored in <code>{status.settings.file}</code> (mode 600, shared with the other demo apps). The secret is never shown or returned.</p>
      </section>
      <section className="panel" aria-labelledby="live-run">
        <h2 id="live-run">Run</h2>
        <p className="muted">Creates throwaway <code>p1x-live-*</code> objects (trusted issuer with an inline JWKS, resource, scope, attributes, application, grant, assignment), runs the scenarios you pick, and deletes everything again.</p>
        <div className="seg" role="group" aria-label="Scenarios">
          {status.scenarios.map((s) => (
            <label key={s.id} className="check"><input type="checkbox" checked={(picked || []).includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} /> {s.title}</label>
          ))}
        </div>
        <label htmlFor="live-confirm">Type the environment id to confirm</label>
        <input id="live-confirm" type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="live-confirm" autoComplete="off" />
        <p><button type="button" disabled={!typed || busy || !(picked || []).length} onClick={run} data-testid="live-run-btn">{busy ? "Running..." : "Run live"}</button>{" "}
          <button type="button" disabled={!typed || busy} onClick={cleanup} data-testid="live-cleanup-btn">Clean up leftovers</button></p>
        {msg && <p className="muted" role="status" data-testid="live-msg">{msg}</p>}
      </section>
      {clean && (
        <section className="panel panel--wide" data-testid="live-clean-report"><h2>Leftovers cleanup: {clean.ok ? "nothing named p1x-live remains" : "SOMETHING REMAINS"}</h2>
          <ul>{(clean.steps || []).map((s, i) => <li key={i}>{s.collection} {s.name}: HTTP {s.status}</li>)}</ul></section>
      )}
      {report && (
        <>
          <section className="panel panel--wide" aria-labelledby="live-res" data-testid="live-report">
            <h2 id="live-res">Mock prediction vs live result</h2>
            {report.error && <p className="field-error" role="alert">The run stopped early: {report.error}</p>}
            <div className="scroll">
              <table className="tbl" data-testid="live-table">
                <thead><tr><th scope="col">Scenario</th><th scope="col">Mock predicts</th><th scope="col">Live result</th><th scope="col">Match</th></tr></thead>
                <tbody>{report.scenarios.map((s) => (
                  <tr key={s.id} data-scenario={s.id}><td>{s.title}</td><td>{visible(predicted(s.prediction))}</td><td>{visible(liveText(s.live))}</td>
                    <td className={s.match ? "ok" : "bad"} data-testid={`badge-${s.id}`}>{s.match ? "MATCH" : "MISMATCH"}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <h3>Mismatches ({report.mismatches.length}) <CopyButton text={mismatchText(report.mismatches)} label="Copy list" /></h3>
            <textarea readOnly rows={Math.min(10, Math.max(3, report.mismatches.length + 1))} value={report.mismatches.length ? mismatchText(report.mismatches) : "No mismatches: the mock predicted every scenario."} data-testid="live-mismatches" />
            <h3>Cleanup {report.cleanup && report.cleanup.ok ? "done" : "INCOMPLETE"}</h3>
            <p data-testid="live-cleanup-result">{report.cleanup ? (report.cleanup.error || (report.cleanup.ok ? `Run ${report.runName}: everything it created was deleted and nothing named p1x-live remains.` : `Objects named p1x-live still remain (this run clean: ${String(report.cleanup.thisRunClean)}). Use "Clean up leftovers".`)) : "No cleanup report."}</p>
          </section>
          <section className="panel panel--wide" aria-labelledby="live-wire"><h2 id="live-wire">Captured wire ({report.wire.length} calls)</h2>
            <p><DecodeSwitch /></p>
            <p className="muted">The same format as the Wire tab. Worker bearer and client secrets are redacted; the test tokens are shown whole.</p>
            {report.wire.map((i) => <WireItem key={`${i.id}-${i.n}`} item={i} evidence={ev} jwks={jwksFromWire(report.wire)} />)}</section>
        </>
      )}
    </div>
  );
}
