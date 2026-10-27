// LIVE mode is owner-run and local only. Every condition must hold, otherwise the live endpoints answer 403 and the tab says why.
// The hosted/mock image can never pass: it is hosted (P1TPX_HOSTED=1), binds 0.0.0.0 inside the container, and ships MODE=mock.
import { bindHost, isLoopbackHost } from '../safety.js';

export function liveGate(env = process.env, { hosted = false } = {}) {
  const reasons = [];
  if (env.MODE !== 'live') reasons.push('MODE is not live (set MODE=live)');
  if (env.P1TPX_ALLOW_LIVE !== '1') reasons.push('P1TPX_ALLOW_LIVE is not 1 (set P1TPX_ALLOW_LIVE=1 to confirm you mean it)');
  if (hosted || env.P1TPX_HOSTED === '1') reasons.push('this is the hosted build: live mode never runs there');
  if (!isLoopbackHost(bindHost(env))) reasons.push('the server is not bound to loopback only: live mode refuses a wider bind');
  return { requested: env.MODE === 'live', allowed: reasons.length === 0, reasons };
}
