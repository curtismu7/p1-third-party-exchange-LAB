# P1 Third-Party Exchange

**Tier: Demo.** PingOne OAuth token exchange (RFC 8693) that accepts a **third-party signed JWT** as the actor token, shown in MOCK only. Pick an issuer (PingFederate client credentials or ID token, another PingOne environment, Okta, Auth0, RFC 9068, Microsoft v1.0 or v2.0) and see what an admin configures and what PingOne does:

1. A **trusted issuer**: issuer, JWKS URL or JWKS, optional audiences, `expRequired` / `iatRequired` / `nbfRequired`, clock skew (0-60 s) and maximum future validity.
2. Its **assignment** to an OIDC non-worker application.
3. **Claim mapping** on the custom resource (`act.sub` from the actor `sub`, `security` from `securityLevel`).
4. The **token exchange** with `actor_token_type=urn:ietf:params:oauth:token-type:jwt`: the checks, the request, the subject, actor and issued tokens, and on a refusal the PingOne error body.

Tabs: Exchange, Diagram (ReactFlow sequence with Simulate, speed, movable boxes and Reset), Claims compared, Setup guide (`docs/setup.md`), Admin and limits, Talk track. Presenter mode (`P`, `Esc` leaves). A banner on every tab, in presenter mode too, says SIMULATED (or HOSTED SIMULATION in the SE build).

Mock only. Every host ends in `.example`, ids are obviously fake, and the app makes no outbound network request (a netguard blocks them and tests prove it). It needs no tenant, no credentials and holds no client secret. Tokens are MOCK-ISSUED, shown raw for education and never verifiable.

## Run

```
./scripts/run.sh          # installs, builds, runs the doctor, starts; open http://127.0.0.1:5200/
```

or `npm ci && npm run build && npm run doctor && npm start`. With Docker (OrbStack): `HOST_PORT=5200 docker compose up --build -d` (published on `127.0.0.1` only).

| Command | What it does |
| --- | --- |
| `npm test` | server (node:test), web (vitest) and repo checks |
| `npm run doctor` | preflight: node, mode, bind, port, exchanges, labels, tokens, hosts, keys, diagrams, netguard, port free |
| `npm run talk-track` | regenerates `docs/talk-track.md` from the data |
| `npm run content-pack` | rebuilds and validates `content-pack.json` |
| `npm run reset` | resets the default workspace's exchanges on a running server |

Port range 5200-5249 (default 5200). `GET /api/health` answers `demo-health/1`.

## API

| Endpoint | |
| --- | --- |
| `GET /api/vendors?vertical=retail\|health\|finance` | banner, issuers, evidence labels, defaults, steps, what is not shown, talk track |
| `POST /api/exchange` | `{vendorId, tokenState?, settings?{expRequired, iatRequired, nbfRequired, audiences, clockSkew, maxFutureValidity}, assigned?}`: checks, request, subject / actor / issued claims, mapping results, MOCK JWTs, `error` on refusal, `hops` and `traceId`; a valid incoming `traceparent` continues its trace |
| `GET /api/compare` | the claims comparison sheet |
| `GET /api/setup` | the setup guide Markdown, steps, admin facts, what is not shown |
| `GET /api/diagram?vendorId=&tokenState=&...` | a `diagram-studio/1` document for that run (accepted or refused path) |
| `GET /api/runs`, `POST /api/reset` | this workspace's recent exchanges; clear them |
| `GET /api/info` | `{mode, simulated, hosted}` for verifying a deploy by content |

State is per workspace: send `X-Workspace` (default `default`, `^[a-z0-9-]{1,40}$`, anything else is a 400); the store is bounded (500 workspaces, 1 hour, 20 runs each).

## Branding

Copy `customer.config.example.json` to `customer.config.json` (git-ignored, read on every request) to set brand, app, resource and host. Three built-in vertical packs (retail, health, finance) supply the defaults.

## Sources and status of claims (rule 2)

Every claim carries one of five labels in the UI: **MEASURED** (run live against a PingOne environment on 2026-10-27; the app copies the exact error texts, expressions and limits, it does not call PingOne), **GUIDE** (Ping's UAT guide, 23 Oct 2026), **SAMPLE** (vendor sample tokens, the comparison sheet), **OUR CHOICE** (our illustration) and **UNVERIFIED**.

- The capability is behind a feature flag. The guide gives no flag name, so none is named here.
- A third-party **subject** token is NOT simulated. Live it is accepted but leaves the issued token with no `sub`; this app only simulates the actor case.
- **UNVERIFIED:** the order PingOne evaluates the checks in when several things are wrong at once (each fault was tested alone); whether `maxFutureValidity` counts from now or from `iat`; real JWKS-URL fetching (the live run used inline keys).
- Content-pack links `/#vendor-<id>` open the Exchange tab on that issuer; an unknown id keeps the default.

## Open

- Catalog id **D98** (confirmed by the owner 2026-10-27). The private repo, runner and first SE deploy were approved and done 2026-10-27; the hosted build is live on the SE cluster (its host is recorded in the shared hosts doc, not in this repo). Hosted SE build: the same image with `MODE=mock` and `P1TPX_HOSTED=1`; manifests in `k8s/`, not deployed.
- Rule 17: the diagrams are diagram-studio/1 data (`server/diagrams/`) validated at start-up; the web renders them with ReactFlow.
