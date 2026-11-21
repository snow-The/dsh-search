// bench-parallel.mjs — measure the parallel change against a CONTROLLED baseline.
//
// The real-network numbers cannot attribute the improvement: the first run happened during
// a throttling window (63s) and the second during a healthy one (0.25s). Comparing them
// would credit the code change for a change in the network.
//
// So this measures the property directly, with stubbed engines whose latency is fixed:
//   serial  = sum of every engine's latency
//   parallel = max of every engine's latency
// The assertion is the ratio, not a wall-clock number, so it holds on any machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const PAD = '<!-- ' + 'x'.repeat(600) + ' -->';
const realFetch = globalThis.fetch;

function engineOf(url) {
  if (url.includes('bing.com')) return 'bing';
  if (url.includes('html.duckduckgo.com')) return 'ddg';
  if (url.includes('lite.duckduckgo.com')) return 'ddg-lite';
  if (url.includes('/search?')) return 'searxng';
  return 'other';
}

/** Every engine takes `ms` and returns nothing usable. */
function stubAllFail(ms) {
  globalThis.fetch = async (url) => {
    const engine = engineOf(String(url));
    await new Promise((r) => setTimeout(r, ms));
    if (engine === 'searxng') {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('<html><body>' + PAD + '</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
}

const m = await import('../.test-build/websearch.js');

test.afterEach(() => { globalThis.fetch = realFetch; });

test('four failing engines cost one latency, not four', async () => {
  const PER = 120;
  stubAllFail(PER);
  const t0 = Date.now();
  await assert.rejects(() => m.runSearchChain({ query: 'crawl4ai github', maxResults: 5, cache: false }, {}));
  const ms = Date.now() - t0;

  // Serial would be >= 4 x 120 = 480ms. Parallel should be near 120ms.
  // The bound is deliberately loose (2.5x one engine) so a slow CI box does not flake,
  // while still failing loudly if the chain reverts to serial.
  assert.ok(ms < PER * 2.5, `took ${ms}ms; serial would be >= ${PER * 4}ms, parallel should be ~${PER}ms`);
  console.log(`  four engines x ${PER}ms each -> ${ms}ms wall (serial floor ${PER * 4}ms)`);
});

test('searxng asks its instances concurrently, not one after another', async () => {
  // Nine instances, each 100ms. Serial = 900ms; parallel = ~100ms.
  //
  // NOTE: this drives runSearchChain with engine:'searxng', which puts searxng FIRST but
  // still appends the other free engines to the chain (pre-existing semantics: an explicit
  // engine is a preference, not a restriction). The other engines are stubbed to fail fast,
  // so the wall time is dominated by searxng's own instance fan-out — which is what this
  // test is about. The bound is set above one engine's latency but far below the serial sum.
  const PER = 100;
  const instances = Array.from({ length: 9 }, (_, i) => `https://sx${i}.test`);
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('.test/search?')) {
      await new Promise((r) => setTimeout(r, PER));
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Other engines: return a refusal so they fail on the FIRST attempt. A short 200 body
    // would hit fetchHtmlWithRetry's 3 x 1.5s backoff and dominate the measurement with
    // retry noise instead of the fan-out being measured.
    return new Response('<html><body>Select all squares containing a duck <script src="/anomaly.js?cc=botnet"></script></body></html>', { status: 202 });
  };
  const t0 = Date.now();
  await assert.rejects(
    () => m.runSearchChain({ query: 'crawl4ai github', maxResults: 5, engine: 'searxng', cache: false }, { searxngInstances: instances }),
    /searxng: all instances failed/,
  );
  const ms = Date.now() - t0;
  assert.ok(ms < PER * 4, `took ${ms}ms; serial instance fan-out alone would be >= ${PER * 9}ms`);
  console.log(`  nine instances x ${PER}ms each -> ${ms}ms wall (serial floor ${PER * 9}ms)`);
});
