import CopyButton from "./CopyButton";
import Tag from "./Tag";
import { useMemo, useState } from "react";
import DecodedTokens from "./DecodedTokens";
import { useDecode } from "./DecodeContext";
import { collapseTokens, findTokens } from "../tokenDecode";
import { visible } from "../safeText";
import Json from "./Json";
import { WIRE_HOT } from "./jsonHot";

// One HTTP call in full: URL, every request header, the exact raw request body, a curl, the status, every response header and the
// response body. Nothing is abbreviated. Copy buttons for the request, the response and the curl.
export default function WireItem({ item, evidence, open = false, jwks = null }) {
  const global = useDecode();
  const [override, setOverride] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const tokens = useMemo(() => findTokens(item), [item]);
  const decode = tokens.length > 0 && (override === null ? global.on : override);
  // ON-SCREEN only: with decoding on, a long raw token becomes a one-line placeholder. Copy buttons and curl always use the full raw text.
  const shorten = decode && !showRaw;
  const collapse = (t) => (shorten ? collapseTokens(t, tokens) : t);
  const show = (t) => visible(collapse(t));
  return (
    <details className="wire-item" open={open} data-testid={`wire-${item.key}`}>
      <summary><strong>{item.n}. {item.label}</strong> <code>{item.method} {item.url}</code> <span className={item.status >= 400 ? "bad" : "ok"}>{item.status} {item.statusText}</span> <Tag kind={item.evidence} evidence={evidence} /></summary>
      <p className="muted">{item.notes}</p>
      {tokens.length > 0 && <p className="wire-tools"><label className="check"><input type="checkbox" checked={decode} onChange={(e) => setOverride(e.target.checked)} data-testid={`decode-${item.key}`} /> Decode tokens ({tokens.length})</label>{decode && <label className="check"><input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} data-testid={`raw-${item.key}`} /> show raw</label>}</p>}
      <div className="wire-cols">
        <div>
          {/* ui-pattern: allow P9 wire copies are affordances, not the page primary */}
          <h4>Request <CopyButton text={item.requestText} label="Copy request" /> <CopyButton text={item.curl} label="Copy curl" /></h4>
          <div data-testid={`wire-${item.key}-request`}><Json value={collapse(item.requestText)} label={`Request ${item.n}`} hot={WIRE_HOT} /></div>
          <h4>curl</h4>
          <pre className="json json--wrap" tabIndex={0} aria-label={`curl ${item.n}`}>{show(item.curl)}</pre>
        </div>
        <div>
          <h4>Response <CopyButton text={item.responseText} label="Copy response" /> <CopyButton text={item.responseBody} label="Copy body" /></h4>
          <div data-testid={`wire-${item.key}-response`}><Json value={collapse(item.responseText)} label={`Response ${item.n}`} hot={WIRE_HOT} /></div>
        </div>
      </div>
      {decode && <DecodedTokens tokens={tokens} jwks={jwks} />}
    </details>
  );
}
