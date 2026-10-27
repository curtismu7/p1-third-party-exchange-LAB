import CopyButton from "./CopyButton";
import { decodeJwt } from "../jwt";
import { visible } from "../safeText";

// A token shown in full: the raw three-part string (never truncated, wrapped), and the header and payload decoded FROM that string.
export default function TokenBlock({ label, token, testId }) {
  const d = decodeJwt(token);
  return (
    <div className="token" data-testid={testId}>
      <div className="token__bar"><strong>{label}</strong><CopyButton text={token} label="Copy token" testId={testId ? `${testId}-copy` : undefined} />
        {!d.error && <CopyButton text={JSON.stringify(d.payload, null, 2)} label="Copy payload" />}</div>
      {d.error ? <p className="field-error">{d.error}</p> : (
        <>
          <p className="muted">Header</p>
          <pre className="json json--wrap" tabIndex={0} aria-label={`${label} header`}>{visible(JSON.stringify(d.header, null, 2))}</pre>
          <p className="muted">Payload (claims)</p>
          <pre className="json json--wrap" tabIndex={0} aria-label={`${label} payload`} data-testid={testId ? `${testId}-payload` : undefined}>{visible(JSON.stringify(d.payload, null, 2))}</pre>
        </>
      )}
      <p className="muted">Raw token (header.payload.signature)</p>
      <pre className="json json--wrap json--raw" tabIndex={0} aria-label={`${label} raw`} data-testid={testId ? `${testId}-raw` : undefined}>{token}</pre>
    </div>
  );
}
