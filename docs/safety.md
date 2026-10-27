# Safety

- Loopback bind only (`P1TPX_BIND` is the explicit opt-in the container uses); the compose file publishes `127.0.0.1` only (a test pins it).
- Host header must be a loopback name; writes must be same-origin.
- Netguard blocks every outbound connection (fetch, socket, DNS, UDP) with a self-test, and a test asserts zero attempts. This app never calls PingOne or any third-party issuer: the live behaviour it shows was measured once, by hand, and is copied into the data.
- `POST /api/exchange` and `GET /api/diagram` accept only a fixed set of fields and bound them: body 8 KB, depth 4, 60 values, 500-character text, 8 audiences of 120 characters, `clockSkew` an integer 0-60, `maxFutureValidity` an integer 0-31536000. Unknown fields and the keys `__proto__`, `constructor` and `prototype` are refused. Walks are iterative; there is no `eval`, `Function` or `vm`. Audience text is rendered as text only.
- The setup guide is Markdown from `docs/setup.md`, rendered to React elements without any raw HTML path: markup in it shows as literal text.
- Tokens are MOCK-ISSUED by this app and shown raw for education; every JWT is a real RS256 token signed by an RSA key generated per process (no EC; the private keys never leave the process), so it opens nothing. The wire shows MOCK client secrets in full under the rulebook's mock-credential exception; they are labelled MOCK and open nothing. There is no real credential anywhere.
- Issuers, ids and hosts are placeholders: hosts end in `.example`, ids are obviously fake UUIDs. A repo test scans every shipped file for other hosts and UUIDs.
- No tenant, credential or customer identifier ships. `customer.config.json` only sets four display strings and is git-ignored.
