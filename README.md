# P1 Third-Party Exchange LAB

**Tier: Demo.** PingOne OAuth token exchange (RFC 8693) that accepts a **third-party signed JWT** as the actor token, shown in MOCK only. Pick an issuer (PingFederate client credentials or ID token, another PingOne environment, Okta, Auth0, RFC 9068, Microsoft v1.0 or v2.0) and see what an admin configures and what PingOne does:

Tier: Demo.
Repo: https://github.com/curtismu7/p1-third-party-exchange-LAB

1. A **trusted issuer**: issuer, JWKS URL or JWKS, optional audiences, `expRequired` / `iatRequired` / `nbfRequired`, clock skew (0-60 s) and maximum future validity.
2. Its **assignment** to an OIDC non-worker application.
3. **Claim mapping** on the custom resource (`act.sub` from the actor `sub`, `security` from `securityLevel`).
4. The **token exchange** with `actor_token_type=urn:ietf:params:oauth:token-type:jwt`: the checks, the request, the subject, actor and issued tokens, and on a refusal the PingOne error body.

**Landing page: the Guided walk** (design A): seven steps, one idea per screen (the idea, pick an issuer, set the trust, send it, read the result, compare, what to know), a progress rail, a fixed Back / Next bar, left/right arrow keys, deep links `/#walk=3`, and the same choices (issuer, switches, token state) as the Exchange lab. "See everything on one page" (`#walk=all`) stacks all seven steps with a contents list; "Back to the walk" returns to the step you were on. An inventory test (`web/src/inventory.test.jsx`, fed by the real server data) fails if any item the original tabs showed (every issuer chip, switch, token state, call, table, fact, limit, heading) is missing from the one-page view and from the steps, or from an Advanced tab that stays one click from step 7. Everything else lives under **Advanced**. A text-size control (A-, %, A+, reset; 80-170%, remembered) is in the header on every tab and scales all text including the diagram and token blocks. Tabs under Advanced: Exchange lab, Wire (every HTTP call in full: the setup calls and the runtime calls, full URLs, every header, exact bodies, a curl and Copy button for each, whole tokens, a decode box), Diagram (ReactFlow sequence with Simulate, speed, movable boxes and Reset), Claims compared, Setup guide (`docs/setup.md`), Admin and limits, Talk track. Presenter mode (`P`, `Esc` leaves). A banner on every tab, in presenter mode too, says SIMULATED (or HOSTED SIMULATION in the SE build).

Mock only. Every host ends in `.example`, ids are obviously fake, and the app makes no outbound network request (a netguard blocks them and tests prove it). It needs no tenant, no credentials and holds no client secret. Tokens are MOCK-ISSUED and shown raw and whole for education: real RS256 JWTs signed by RSA keys that exist only in the server process (the actor token verifies against the JWKS in the trusted-issuer call; a bad-signature token really fails), so they open nothing anywhere.

## Run from a clone

Prerequisites: Node 26. Docker (OrbStack) only for the Docker form.

```
git clone https://github.com/curtismu7/p1-third-party-exchange-LAB.git
cd p1-third-party-exchange-LAB
npm ci
npm run build
npm run doctor
npm start
```

## Ports, and what to do if the port is taken

```
Ports: p1-third-party-exchange-LAB listens on 5200 (set with PORT, default 5200).
Port range for this app: 5200-5249.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:5200 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=<other port> npm start
```

Other variable: `HOST_PORT=5200` (Docker host port). Keep both inside 5200-5249.

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

## Real exchange tabs and inline token decoding

- **Real exchange (your browser)** (all builds, hosted too): the visitor's browser sends one real RFC 8693 request straight to their own PingOne token endpoint (strictly validated: https, an auth host of the six regions, path `/<uuid>/as/token`). Nothing passes through this server (a Playwright test records every app-origin request during a send and asserts none carries the secret or the tokens). The secret lives only in React state; Reset and leaving the tab clear it. Authorization is redacted in the view and in Copy curl unless you tick "show" / "include the secret". The server sets no Content-Security-Policy, so there is no `connect-src` to widen.
- **Real exchange (local)** (live build only, same gate as the Live tab): one real exchange from the local server to the saved environment; creates and deletes nothing; optional one-shot client-credentials fetch of the actor token from a typed third-party endpoint (SSRF guard: https, no IP literals or internal names, every resolved address public, the netguard allows only that host for that call, no redirects, 20 s, 256 KB) and "Check issuer metadata" (public GETs of the issuer's discovery document and JWKS). `POST /api/live/real/exchange`, `POST /api/live/real/issuer-check`.
- Both show the actor token inspector (iss, sub, aud, exp/iat/nbf, kid/x5t, act is an object) and map PingOne's refusal to a hint. The PingFederate trap (x5t without kid, key not published to /pf/JWKS) is flagged.
- **Inline decoding** on every wire view (Wire, Exchange, Live, both real tabs): a global "Decode tokens inline" switch (default on, remembered in localStorage; if storage is blocked it still works) and a per-call toggle. Under each call every JWT found (JSON fields, urlencoded form fields, header values) is decoded: label, header, payload, a claims table with ISO times and "in 59 min" / "expired 2 min ago", highlights for iss, sub, aud, scope and act, an exp badge and a signature verdict (a real WebCrypto check against the JWKS of the trusted-issuer call when the wire has one, otherwise "signature not checked here"). On screen the long raw token in a body is shortened to a one-line placeholder; "show raw" restores it, and every Copy button and curl always uses the full raw text.

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
