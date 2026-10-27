# Changelog

## 0.1.0 (unreleased)
- Step 1 (core): the domain from the AI-DEMO2 twin (eight issuers, the checks, claim mapping, comparison sheet, admin facts) as server data and pure logic; bounded `POST /api/exchange`; `{{token}}` data in three vertical packs; diagram-studio/1 diagrams loaded by name (accepted and refused); workspace-scoped state and Reset; W3C traceparent per mock hop; doctor; `demo-health/1`.
- Step 2 (web): Exchange, Diagram, Claims compared, Setup guide (safe Markdown), Admin and limits, Talk track; presenter mode; Reset restores the controls and the diagram positions. Measured PingOne behaviour (2026-10-27) ported: real refusal texts as `error`, `clockSkew` and `maxFutureValidity`.
- Step 3 (integration): Dockerfile with a `MODE` switch, compose, k8s manifests and `deploy.sh`, content pack, shelf entry (provisional catalog id), talk track, docs. Ports 5200-5249.
