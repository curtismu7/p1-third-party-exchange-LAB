// Rule 19: the Mock / Real toggle for P1 Third-Party Exchange.
// Real here is the owner-run LIVE mode: a runtime switch to the /api/live machinery, which stays behind its
// launch-time gate (MODE=live, P1TPX_ALLOW_LIVE=1, loopback-only, not hosted). If the gate has not passed at
// launch, Real is disabled and the tooltip carries the gate's own reasons. Switching never needs a restart:
// the server is already running both machines, the toggle only moves which one answers the demo tabs.
const realReason = (info) => {
  const reasons = info && info.live && Array.isArray(info.live.reasons) ? info.live.reasons : [];
  return reasons.length ? `Real is gated off: ${reasons.join("; ")}.` : "Real is not available: live mode was not requested at launch (set MODE=live and P1TPX_ALLOW_LIVE=1).";
};
const HOSTED = "The hosted build is Mock only: live mode never runs there.";

export default function ModeToggle({ info, onSelect }) {
  const loading = !info;
  const source = info?.source;
  const hosted = info?.hosted === true;
  const realOff = loading || hosted || info?.realAvailable !== true;
  const pick = (next) => { if (next !== source) onSelect?.(next); };
  return (
    <div className="mode-toggle" role="group" aria-label="Mode" data-testid="mode">
      <button type="button" aria-pressed={source === "mock"} disabled={loading} onClick={() => pick("mock")} data-testid="mode-mock">Mock</button>
      <button type="button" aria-pressed={source === "real"} disabled={realOff} title={hosted ? HOSTED : realOff && !loading ? realReason(info) : undefined} onClick={() => pick("real")} data-testid="mode-real">Real</button>
    </div>
  );
}
