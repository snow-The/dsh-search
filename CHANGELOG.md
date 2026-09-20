# Changelog

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
