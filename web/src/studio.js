// diagram-studio/1 document (from GET /api/diagram) -> the shape PatternDiagram draws. This only maps fields: the boxes, the
// arrows, their order and their text all come from the document. Each step is one edge; its payload is the FULL wire text its `hop`
// points at (resolveHop, from the run's wire), else its `why`.
export function fromStudio(doc, resolveHop) {
  const steps = doc.steps.map((s) => {
    const e = doc.edges[s.edges[0]];
    return { from: e.source, to: e.target, label: e.label || s.title, title: s.title, say: s.what, payload: (s.hop && resolveHop && resolveHop(s.hop)) || s.why || "" };
  });
  return {
    title: doc.title,
    intro: doc.lede || "",
    nodes: doc.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.group, x: n.x, y: n.y })),
    steps,
  };
}
