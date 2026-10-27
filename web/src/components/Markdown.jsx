import { Fragment } from "react";
import { visible } from "../safeText";

// A small Markdown renderer for the setup guide. It builds React elements only: text is always a React text child, so a
// "<script>" or "<img onerror=...>" in the guide shows as literal text. There is no raw HTML path and no link support.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*)/;

export function Inline({ text }) {
  return String(text).split(INLINE).map((part, i) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{visible(part.slice(2, -2))}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={i}>{visible(part.slice(1, -1))}</code>;
    return <Fragment key={i}>{visible(part)}</Fragment>;
  });
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

/** Markdown text -> blocks: heading, paragraph, ul, ol, table, code. One pass, no recursion. */
export function parseBlocks(md) {
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: "heading", level: h[1].length, text: h[2] }); i++; continue; }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ type: "table", head, rows });
      continue;
    }
    const li = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = !!li[2];
      const items = [];
      while (i < lines.length) {
        const m = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(lines[i]);
        if (!m || !!m[2] !== ordered) break;
        items.push(m[3]);
        i++;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*(?:[-*]|\d+\.)\s|\s*\|)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ type: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

export default function Markdown({ text }) {
  return (
    <div className="md" data-testid="markdown">
      {parseBlocks(text).map((b, i) => {
        if (b.type === "heading") { const H = `h${Math.min(b.level + 1, 5)}`; return <H key={i}><Inline text={b.text} /></H>; }
        if (b.type === "code") return <pre key={i} className="json" tabIndex={0}>{visible(b.text)}</pre>;
        if (b.type === "ul" || b.type === "ol") { const L = b.type; return <L key={i}>{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</L>; }
        if (b.type === "table") {
          return (
            <div className="scroll" key={i}>
              <table className="tbl"><thead><tr>{b.head.map((c, j) => <th key={j} scope="col"><Inline text={c} /></th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>)}</tbody></table>
            </div>
          );
        }
        return <p key={i}><Inline text={b.text} /></p>;
      })}
    </div>
  );
}
