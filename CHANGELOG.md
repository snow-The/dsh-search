# Changelog

## 0.5.1

- **fix(server): the optional HTTP daemon now requires a bearer token.** Set
  `DSH_SEARCH_HTTP_TOKEN` (≥16 chars) alongside `DSH_SEARCH_HTTP_PORT`; every request must
  send `Authorization: Bearer <token>`, anything else gets `401` + `WWW-Authenticate: Bearer`.
  **Fail-closed:** the port without a token no longer starts the daemon — it refuses and logs
  one line explaining why. The gate runs before route matching, so an unauthenticated caller
  cannot tell an existing path from a missing one (404/405 would have leaked that).
  Shortest accepted token length is exported as `MIN_TOKEN_LENGTH`; the comparison is
  constant-time.
  - Test coverage: `test/daemon-auth.test.mjs` proves both directions (right token passes,
    missing/wrong/malformed/prefix-of-real all rejected) — a reject-everything gate would
    otherwise also "pass". Plus a real-socket probe confirming the gate holds on the actual
    TCP path and that `maybeStartServer` captures the token into the closure.
  - Backward compatible: with no `DSH_SEARCH_HTTP_TOKEN` in the environment the daemon behaves
    exactly as before, which is why the existing suite needed no changes.

- **fix(server): a listen failure no longer kills the harness.** `server.listen()` on a taken
  port emits `'error'`; unhandled, that is an uncaught exception and it took the whole DSH
  process down — found while probing the deployed artifact against a port a previous probe had
  left occupied (`EADDRINUSE` → `throw er; // Unhandled 'error' event`). A daemon that cannot
  bind must only fail to exist: it now attaches an `'error'` handler and logs one line.
  Verified by occupying the port first and confirming the process survives the event and the
  occupying listener is untouched.

- **docs: correct a false claim carried by 0957a60.** That commit is titled "mount routes on the
  official `ctx.webServer`, drop Hono" and its body asserts the official service "owns the fence
  (Host/Origin + auth)". **Hono was indeed dropped, but nothing was ever mounted on
  `ctx.webServer`** — that identifier appears in `src/` only inside comments. The fence claim is
  also false: `@deepseek-ai/dsh-host-webserver` self-describes as knowing "no harness concepts"
  with handlers that "retain direct response ownership", and a search of that package for
  authorization/token/401/403/origin returns **zero hits**. The real trust logic lives in
  `dsh-web-app`'s `resolveLanTrust()`, which builds a **Host allowlist** (DNS-rebinding
  protection), not an authentication layer.
  - Consequence, recorded so the question is not reopened: migrating these six generic routes
    (`/fetch`, `/github`, `/corpus`, ...) onto `ctx.webServer` would **not** add security. It
    would place them on the GUI port, sharing that server's bind host (which may be `0.0.0.0`)
    and competing for path space with the GUI and every other plugin. A separate loopback-only
    port behind its own switch is the stronger boundary; access control is the bearer gate above.
  - The commit is already on `origin/main`, so history was left intact and the correction is
    recorded here (plus the README) instead of being force-pushed over.

## 0.5.0

- feat(search_open): **openreview** source — ICLR/NeurIPS/ICML submissions through the public notes API,
  anonymous, no credential. Added after probing two candidates from a sibling toolkit
  (microsoft/ResearchStudio) instead of assuming they work:
  - **OpenReview is IN** and it earns its place: it is the only source here that shows REJECTED and
    WITHDRAWN submissions. A live probe for "scoop check prior art novelty" returned
    "Building Queries for Prior-Art Search (IRFC 2011)", "Knowledge Modeling in Prior Art Search" and
    "Art-Free Generative Models ... ICLR 2025 Conference Withdrawn Submission" — the last one is
    invisible to Crossref/OpenAlex, and it is exactly what a novelty check needs to see.
  - **DBLP is OUT, and the reason is measured**: `dblp.org/search/publ/api` answers HTTP 200 with an
    Anubis proof-of-work page ("Making sure you are not a bot") even for a browser User-Agent. A
    source that returns a challenge page is the silently-wrong case this file refuses to ship.
  - **Semantic Scholar is OUT (unchanged)**: still 429 with no key from this machine.
- fix(search_open): the query RESTRICTS the OpenReview search to submissions and to the title field
  (`source=forum&content=title`). Measured, not decorative: with no filter the first hit was a reply
  note with no title at all, and `source=forum` alone still matched paper full texts loosely. Same
  term, three result sets compared side by side before choosing.
- fix(opensoources): the HTTP layer now retries 429/503 twice with backoff and honours `Retry-After`,
  and it NAMES a bot check instead of dying on it. Before this, a rate limit surfaced as an empty
  result set, and a challenge page surfaced as `Unexpected token <` — an error that reads like our
  parsing bug rather than "this source is closed to plain clients from here".
- test: registry sentinel updated (it exists to make adding a source a deliberate act), plus mapper
  tests for the OpenReview `{value}` envelope and for the gating detector. 37/37.
