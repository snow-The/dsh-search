# dsh-search

Universal search toolkit for DeepSeek Harness — browser-less, GPU-free, works on headless/remote hosts.

## Tools

| Tool | What it does |
|---|---|
| `search_fetch` | Fetch a URL without a browser, return extracted page text |
| `search_github` | **First-party GitHub search** (repos / code / issues / commits) — direct GitHub REST API, no Google |
| `search_corpus_add` | Fetch + extract + chunk + embed + index URLs into an ephemeral SQLite vector corpus |
| `search_corpus_search` | Semantic top-k search over the corpus (cosine on float32 vectors) |
| `search_corpus_clear` | Clear the throwaway corpus |

## Design

- **TypeScript** (tsc + esbuild build, same pattern as dsh-gitkit; no HTTP framework — native `node:http`)
- Precompiled regexes, prepared SQLite statements, **float32 BLOB vectors** (4 bytes/dim vs JSON strings), sentence-aware chunking with overlap, batched ARK embeddings (16/batch)
- Embeddings: ARK `doubao-embedding-large` when `ARK_API_KEY` present (search_code semantic layer; pure-local BM25+rerank core works with **no key and no network**) (`DSH_BROWSER_EMBED_MODEL` overridable); local 64-dim n-gram hash fallback — offline-safe
- GitHub token: `GITHUB_TOKEN`/`GH_PAT` env or `~/.dsh/.credentials.yaml` refs (line-based parse). Code search requires auth (GitHub rule). Unauthenticated: 10 req/min
- Optional local HTTP API on native `node:http`: set `DSH_SEARCH_HTTP_PORT` (loopback only):
  - `GET /health`, `GET /fetch?url=`, `GET /github?q=&type=repo|code|issue|commit`, `POST /corpus {urls}`, `GET /corpus/search?q=&k=`, `DELETE /corpus`
  - **Auth (v0.5.1, required):** the port alone is no longer enough — also set `DSH_SEARCH_HTTP_TOKEN`
    (≥16 chars) and every request must carry `Authorization: Bearer <token>`; anything else gets
    `401` + `WWW-Authenticate: Bearer`. Port set without a token = the daemon **refuses to start**
    and says so, rather than silently serving unauthenticated.
  - Why the daemon enforces its own gate instead of mounting on the official `ctx.webServer`:
    `dsh-host-webserver` is a bare router with **no auth of its own** (measured: zero
    authorization/token/401/403/origin mentions in that package; the web-app's `resolveLanTrust`
    is a Host allowlist for DNS-rebinding, not authentication). Moving these routes there would
    not add a fence — it would only put generic paths like `/fetch` and `/corpus` on the GUI port,
    sharing the GUI's bind range (which may be `0.0.0.0`) and competing for path space. A separate
    loopback-only port with its own switch is the stronger boundary.

## GitHub search qualifiers (pass through)

`lang:ts stars:>100`, `repo:owner/name`, `org:google`, `is:issue is:open` — anything the GitHub search API accepts.

## Search methodology

The plugin ships with a distilled search methodology extracted from 3 professional books (OCR, line-cited):

- [`docs/search-methods.md`](./docs/search-methods.md) — quick reference: operators, engine architecture, investigation workflow, and how each maps to the tools
- [`docs/book-osint-techniques.md`](./docs/book-osint-techniques.md) — OSINT Techniques 11th: Google/X-Twitter operators, platform lists, recon workflow (110+ items)
- [`docs/book-ai-powered-search.md`](./docs/book-ai-powered-search.md) — AI-Powered Search: signal boosting, semantic/dense-vector search, ANN, quantization, RRF hybrid ranking (138 items)
- [`docs/book-bellingcat.md`](./docs/book-bellingcat.md) — We Are Bellingcat: verification workflows, geolocation, disinformation defense (70+ items)

## Install

Add `@snow-the/dsh-search` to your profile `dependencies` and `dsh.profile.bundles`, then `pnpm install` + restart.
