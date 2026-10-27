import CopyButton from "./CopyButton";
import Tag from "./Tag";
import { visible } from "../safeText";

// One HTTP call in full: URL, every request header, the exact raw request body, a curl, the status, every response header and the
// response body. Nothing is abbreviated. Copy buttons for the request, the response and the curl.
export default function WireItem({ item, evidence, open = false }) {
  return (
    <details className="wire-item" open={open} data-testid={`wire-${item.key}`}>
      <summary><strong>{item.n}. {item.label}</strong> <code>{item.method} {item.url}</code> <span className={item.status >= 400 ? "bad" : "ok"}>{item.status} {item.statusText}</span> <Tag kind={item.evidence} evidence={evidence} /></summary>
      <p className="muted">{item.notes}</p>
      <div className="wire-cols">
        <div>
          <h4>Request <CopyButton text={item.requestText} label="Copy request" /> <CopyButton text={item.curl} label="Copy curl" /></h4>
          <pre className="json json--wrap" tabIndex={0} aria-label={`Request ${item.n}`} data-testid={`wire-${item.key}-request`}>{visible(item.requestText)}</pre>
          <h4>curl</h4>
          <pre className="json json--wrap" tabIndex={0} aria-label={`curl ${item.n}`}>{visible(item.curl)}</pre>
        </div>
        <div>
          <h4>Response <CopyButton text={item.responseText} label="Copy response" /> <CopyButton text={item.responseBody} label="Copy body" /></h4>
          <pre className="json json--wrap" tabIndex={0} aria-label={`Response ${item.n}`} data-testid={`wire-${item.key}-response`}>{visible(item.responseText)}</pre>
        </div>
      </div>
    </details>
  );
}
