import { useEffect, useState } from "react";
import { getJson } from "../api";
import Tag from "./Tag";

export default function CompareTab({ evidence }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getJson("/api/compare").then(setData, (e) => setError(e.message)); }, []);
  if (error) return <p className="field-error" role="alert">Could not load the comparison ({error}).</p>;
  if (!data) return <p className="muted">Loading...</p>;
  return (
    <section className="panel" aria-labelledby="cmp-h">
      <h2 id="cmp-h">What each issuer puts in its token <Tag kind="sample" evidence={evidence} /></h2>
      <p className="muted">{data.note}</p>
      <div className="scroll">
        <table className="tbl" data-testid="compare">
          <thead><tr><th scope="col">Claim</th>{data.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {data.rows.map(([label, ...cells]) => (
              <tr key={label}><th scope="row">{label}</th>{cells.map((c, i) => <td key={data.columns[i]}>{c === null ? <span className="muted" aria-label="not included">–</span> : <code>{c}</code>}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
