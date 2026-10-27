import { createContext, useContext, useState } from "react";
import { readDecodePref, writeDecodePref } from "../tokenDecode";

// One global "Decode tokens inline" switch, remembered in localStorage (a missing or blocked localStorage is fine).
const Ctx = createContext({ on: true, setOn: () => {} });
export const useDecode = () => useContext(Ctx);

export function DecodeProvider({ children }) {
  const [on, setOnState] = useState(readDecodePref);
  const setOn = (v) => { setOnState(v); writeDecodePref(v); };
  return <Ctx.Provider value={{ on, setOn }}>{children}</Ctx.Provider>;
}

export function DecodeSwitch() {
  const { on, setOn } = useDecode();
  return <label className="check" data-testid="decode-switch"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Decode tokens inline</label>;
}
