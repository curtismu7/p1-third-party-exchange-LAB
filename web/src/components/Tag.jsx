// GUIDE / SAMPLE / OUR CHOICE / UNVERIFIED label. `evidence` is the map from /api/vendors; the label text and note come from the server.
const CLASS = { measured: "tag tag--ok", guide: "tag tag--ok", sample: "tag", derived: "tag", unverified: "tag tag--warn" };

export default function Tag({ kind, evidence }) {
  const e = evidence && evidence[kind];
  return <span className={CLASS[kind] || "tag"} title={e ? e.note : ""} data-evidence={kind}>{e ? e.label : kind}</span>;
}
