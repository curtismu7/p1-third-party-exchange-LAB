import CopyButton from "./CopyButton";
import { decodeJwt } from "../jwt";
import Json from "./Json";
import { TOKEN_HOT } from "./jsonHot";

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
          <Json value={d.header} label={`${label} header`} hot={TOKEN_HOT} />
          <p className="muted">Payload (claims)</p>
          <Json value={d.payload} label={`${label} payload`} testId={testId ? `${testId}-payload` : undefined} hot={TOKEN_HOT} />
        </>
      )}
      <p className="muted">Raw token (header.payload.signature)</p>
      <Json value={token} label={`${label} raw`} testId={testId ? `${testId}-raw` : undefined} />
    </div>
  );
}
