import { useState } from "react";
import { copyText } from "../clipboard";

export default function CopyButton({ text, label = "Copy", testId }) {
  const [state, setState] = useState("idle");
  const click = async () => {
    const ok = await copyText(text);
    setState(ok ? "done" : "failed");
    setTimeout(() => setState("idle"), 1500);
  };
  return <button type="button" className="copy" onClick={click} data-testid={testId} aria-live="polite">{state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}</button>;
}
