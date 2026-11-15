// A diagram step's `hop` names a wire call: "key" (request and response), "key:req", "key:res", or "attrs" (every attribute call).
// Returns the FULL text of that call from the run, or "" when the run has no such call.
export function wireHopText(run, hop) {
  if (!run) return "";
  const all = [...(run.setup || []), ...(run.wire || [])];
  const [key, part] = String(hop).split(":");
  const items = key === "attrs" ? all.filter((i) => i.key.startsWith("attr-")) : all.filter((i) => i.key === key);
  return items.map((i) => (part === "req" ? i.requestText : part === "res" ? i.responseText : `${i.requestText}\n\n${i.responseText}`)).join("\n\n");
}

// wireHopText joins calls, and a call's request and response, with a blank line: one string per HTTP message, so the JsonPane
// (which keeps a message's headers as text and gives its JSON body a Form | JSON pane) gets one transcript at a time.
export const wireMessages = (text) => String(text).split(/\n\n(?=(?:[A-Z]{3,7} \S+ HTTP\/|HTTP\/\d))/);
