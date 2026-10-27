// Rule 14: W3C Trace Context on every (mock) hop. One trace id per evaluation, a new span id per hop. A valid incoming
// `traceparent` header continues its trace; anything else starts a new one. Nothing is sent anywhere: these are the raw
// request/response panes the UI shows. Values are random, mock, and carry no meaning outside this app.
import { randomBytes } from 'node:crypto';

const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);

export function parseTraceparent(v) {
  if (typeof v !== 'string' || v.length !== 55) return null;
  const m = TP.exec(v);
  return m && m[1] !== ZERO32 && m[2] !== ZERO16 ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}
export const formatTraceparent = (traceId, spanId, flags = '01') => `00-${traceId}-${spanId}-${flags}`;

export function newTrace(incoming, rand = randomBytes) {
  const p = parseTraceparent(incoming);
  const span = () => rand(8).toString('hex').replace(/^0{16}$/, '0000000000000001');
  return { traceId: p ? p.traceId : rand(16).toString('hex').replace(/^0{32}$/, `${'0'.repeat(31)}1`), parentId: p ? p.parentId : null, span };
}

// The mock hops of one exchange, with the raw request and response text of each. Nothing is sent: these are the panes
// the UI shows. Hosts end in .example. The refusal status and body are OUR mock (UNVERIFIED): the guide describes no errors.
export function buildHops({ trace, run }) {
  const vendorHost = new URL(run.vendor.issuer).host;
  const jwks = `GET ${new URL(run.vendor.issuer).origin}/<JWKS URL of the trusted issuer>`;
  const steps = [
    { from: 'app', to: 'vendor', label: 'Application gets the actor token from the third-party issuer',
      request: (tp) => `(token request to ${vendorHost}, not shown: issuer-specific)\ntraceparent: ${tp}`,
      response: () => `actor token (JWT) from ${run.vendor.name}\nstate: ${run.tokenState}` },
    { from: 'app', to: 'p1', label: 'Application sends the token exchange to PingOne',
      request: (tp) => `${run.request}\ntraceparent: ${tp}`,
      response: () => (run.ok ? `HTTP 200 (see the issued token)` : `HTTP ${run.refusal.status} (MOCK, UNVERIFIED)\n${JSON.stringify(run.refusal.body)}`) },
    { from: 'p1', to: 'vendor', label: 'PingOne fetches the trusted issuer JWKS (mock, in process)',
      request: (tp) => `${jwks}\ntraceparent: ${tp}`,
      response: () => `JWKS of ${run.vendor.issuer} (mock)` },
    ...(run.ok ? [{ from: 'p1', to: 'resource', label: 'PingOne reads the resource attribute mapping (mock, in process)',
      request: (tp) => `ATTRIBUTE-MAPPING (mock)\ntraceparent: ${tp}`,
      response: () => run.mapping.map((m) => `${m.label}: ${m.present ? 'source claim present' : `no ${m.source} in the token`}`).join('\n') }] : []),
  ];
  return steps.map((st, i) => {
    const tp = formatTraceparent(trace.traceId, trace.span());
    return { n: i + 1, from: st.from, to: st.to, label: st.label, traceparent: tp, request: st.request(tp), response: st.response() };
  });
}
