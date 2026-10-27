# Changelog

## 0.1.0 (unreleased)
- Step 1 (core): the domain from the AI-DEMO2 twin (eight issuers, the checks, claim mapping, comparison sheet, admin facts) as server data and pure logic; bounded `POST /api/exchange`; `{{token}}` data in three vertical packs; diagram-studio/1 diagrams loaded by name (accepted and refused); workspace-scoped state and Reset; W3C traceparent per mock hop; doctor; `demo-health/1`.
- Step 2 (web): Exchange, Diagram, Claims compared, Setup guide (safe Markdown), Admin and limits, Talk track; presenter mode; Reset restores the controls and the diagram positions. Measured PingOne behaviour (2026-10-27) ported: real refusal texts as `error`, `clockSkew` and `maxFutureValidity`.
- Step 3 (integration): Dockerfile with a `MODE` switch, compose, k8s manifests and `deploy.sh`, content pack, shelf entry (provisional catalog id), talk track, docs. Ports 5200-5249.
- Part A: Wire tab, full HTTP calls (setup and runtime), real RS256 mock tokens with a really verified signature, GET /api/wire.
- Part B: owner-run LIVE mode (local only, never hosted): gate, write-only settings in the shared pingone.json, guarded PingOne client, throwaway p1x-live-* run with cleanup in finally, prediction vs live, loopback stub for tests and proofs.
- Part C: Real exchange (your browser) in every build, Real exchange (local) in the live build, actor token inspector, issuer metadata check, SSRF guard; inline token decoding on every wire view.
