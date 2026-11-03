import { workspaceFetch } from "./workspace";

export async function getJson(url) {
  const r = await workspaceFetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// POST /api/exchange. Returns { ok, body }: a 400 is data (a code and a detail), not an exception.
export async function exchange(payload) {
  const r = await workspaceFetch("/api/exchange", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

export const resetWorkspace = () => workspaceFetch("/api/reset", { method: "POST", body: "{}" }).then((r) => r.ok);

// Owner-run LIVE endpoints. Returns { ok, status, body }; a 4xx is data (a code and a detail), not an exception.
export async function liveCall(url, payload) {
  const r = await workspaceFetch(url, { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// Rule 19: the Mock/Real toggle. Returns { ok, status, body }: a 409/403 is data, not an exception.
export async function postMode(source) {
  const r = await workspaceFetch("/api/mode", { method: "POST", body: JSON.stringify({ source }) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}
