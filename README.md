# P1 Third-Party Exchange

**Tier: Demo.** PingOne OAuth token exchange (RFC 8693) that accepts a **third-party signed JWT** as the actor token, shown in MOCK only. Pick an issuer (PingFederate client credentials or ID token, another PingOne environment, Okta, Auth0, RFC 9068, Microsoft v1.0 or v2.0) and see what an admin configures and what PingOne does:

1. A **trusted issuer**: issuer, JWKS URL or JWKS, optional audiences, `expRequired` / `iatRequired` / `nbfRequired`, clock skew (0-60 s) and maximum future validity.
2. Its **assignment** to an OIDC non-worker application.
3. **Claim mapping** on the custom resource (`act.sub` from the actor `sub`, `security` from `securityLevel`).
4. The **token exchange** with `actor_token_type=urn:ietf:params:oauth:token-type:jwt`: the checks, the request, the subject, actor and issued tokens, and on a refusal the PingOne error body.

Tabs: Exchange, Wire (every HTTP call in full: the setup calls and the runtime calls, full URLs, every header, exact bodies, a curl and Copy button for each, whole tokens, a decode box), Diagram (ReactFlow sequence with Simulate, speed, movable boxes and Reset), Claims compared, Setup guide (`docs/setup.md`), Admin and limits, Talk track. Presenter mode (`P`, `Esc` leaves). A banner on every tab, in presenter mode too, says SIMULATED (or HOSTED SIMULATION in the SE build).

Mock only. Every host ends in `.example`, ids are obviously fake, and the app makes no outbound network request (a netguard blocks them and tests prove it). It needs no tenant, no credentials and holds no client secret. Tokens are MOCK-ISSUED and shown raw and whole for education: real RS256 JWTs signed by RSA keys that exist only in the server process (the actor token verifies against the JWKS in the trusted-issuer call; a bad-signature token really fails), so they open nothing anywhere.

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
| `POST /api/exchange` | `{vendorId, tokenState?, settings?{expRequired, iatRequired, nbfRequired, audiences, clockSkew, maxFutureValidity}, assigned?}`: checks, subject / actor / issued claims, mapping results, real RS256 MOCK JWTs, `wire` and `setup` (full HTTP calls), `error` on refusal, `hops` and `traceId`; a valid incoming `traceparent` continues its trace |
| `GET /api/wire?runId=` | the `wire` (runtime) and `setup` (admin) calls of this workspace's latest exchange, as `POST /api/exchange` returned them; each item: n, id, key, label, phase, method, url, requestHeaders, requestBody, curl, status, statusText, responseHeaders, responseBody(+Pretty), requestText, responseText, notes, evidence |
| `GET /api/compare` | the claims comparison sheet |
| `GET /api/setup` | the setup guide Markdown, steps, admin facts, what is not shown |
| `GET /api/diagram?vendorId=&tokenState=&...` | a `diagram-studio/1` document for that run (accepted or refused path) |
| `GET /api/runs`, `POST /api/reset` | this workspace's recent exchanges; clear them |
| `GET /api/info` | `{mode, simulated, hosted}` for verifying a deploy by content (plus `live: {requested, enabled, reasons}` only when MODE=live was requested) |
| `GET /api/live/status`, `POST /api/live/settings\|run\|cleanup` | owner-run live mode (403 unless the whole live gate passes) |

State is per workspace: send `X-Workspace` (default `default`, `^[a-z0-9-]{1,40}$`, anything else is a 400); the store is bounded (500 workspaces, 1 hour, 20 runs each).

## Live mode (owner-run)

**LIVE writes to a real PingOne environment and deletes it again. It exists only on your own machine and never in the hosted build or the Docker/k8s images.**

- Enable (host-run only): `MODE=live P1TPX_ALLOW_LIVE=1 ./scripts/run.sh`. All of these must hold, otherwise every `/api/live/*` answers 403 and the Live tab says why: `MODE=live`, `P1TPX_ALLOW_LIVE=1`, a loopback bind, not the hosted build (`P1TPX_HOSTED` unset), same-origin writes. The image ships `MODE=mock` and binds `0.0.0.0`, so it can never pass; compose and `k8s/` never set live (tests pin it).
- Settings (Live tab): environment id, region (com, eu, asia, ca, au, sg), worker client id and worker client secret, saved to the shared `~/.config/demo-kit/pingone.json` (mode 600, merge-written; `DEMO_KIT_CONFIG_DIR` overrides the directory). The secret is write-only: no API, log, wire item or diagram ever carries it, the UI shows only "set".
- Network: only the token endpoint and the management API of the saved environment, over https (path `/<env>/as/*` on the region's auth host, `/v1/environments/<env>/*` on its api host) (the netguard allow-list is filled only during a run); no redirect is followed, 20 s timeout, 256 KB response cap.
- **What a run creates and deletes** (type the exact environment id to confirm): a trusted issuer with an inline `jwks` (this run's own RSA key), a custom resource with a scope and the `act`, `security` and `ext_sub` attributes, a WEB_APP (client credentials + token exchange), its grant and the issuer assignment, all named `p1x-live-<random>`. It then runs the scenarios you pick (valid, expired, untrusted issuer, bad signature, unknown kid, no exp, nbf/iat required, audience mismatch, clock skew 60 at 30 s and 120 s, max future validity, unassigned, missing source claim, wrong or missing actor_token_type, no actor, a third-party JWT as the subject, the clockSkew > 60 refusal), and **always** deletes everything in reverse order in a finally block, then verifies nothing named `p1x-live-` remains. Objects not named `p1x-live-*` are never touched. If cleanup cannot finish, the created ids stay in `.data/live-cleanup.json` and the "Clean up leftovers" button removes them.
- Output: the same `wire` format as the Wire tab (worker bearer and client secrets redacted; the test tokens whole) and, per scenario, the mock's prediction next to the live result with a MATCH / MISMATCH badge and a pasteable mismatch list.
- Try it without a tenant: `node scripts/live-stub.mjs` starts a loopback stand-in for PingOne with the measured behaviour; run the app with `P1TPX_LIVE_STUB=<its url> DEMO_KIT_CONFIG_DIR=<scratch dir>` (always a scratch dir, or the settings go to your real shared file).
- `npm run doctor` prints `live: off` normally; with live on it validates the saved settings (never printing the secret).

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
