// Regression: parallelising the engine chain must NOT let a fast low-priority engine
// outrank a slow high-priority one.
//
// The serial chain had an obvious property: the first engine in the list that succeeded won.
// Running them concurrently breaks that property unless selection is explicitly by INDEX,
// not by arrival time. These tests pin the property so a future "optimisation" cannot
// silently trade correctness for latency.
//
// The engines are stubbed by replacing the module's fetch, so no network is involved and
// the timings are deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The chain reads engines from a module-level table, so the cleanest way to control them is
// to intercept global fetch and let the real parsers run against synthetic HTML.
const realFetch = globalThis.fetch;

// fetchHtmlWithRetry rejects any response under 500 bytes as "empty", so the synthetic
// pages must be padded past that threshold or every engine looks like a transport failure.
const PAD = '<!-- ' + 'x'.repeat(600) + ' -->';

function htmlFor(engine, urls) {
  if (engine === 'bing') {
    return '<html><body>' + urls.map((u) =>
      `<li class="b_algo"><h2><a href="${u}">t</a></h2><p>s</p></li>`).join('') + PAD + '</body></html>';
  }
  if (engine === 'ddg') {
    return '<html><body>' + urls.map((u) =>
      `<div class="result results_links"><a class="result__a" href="${u}">t</a><a class="result__snippet">s</a></div></div></div>`).join('') + PAD + '</body></html>';
  }
  if (engine === 'ddg-lite') {
    return '<html><body>' + urls.map((u) =>
      `<a class="result-link" href="${u}">t</a><td class="result-snippet">s</td>`).join('') + PAD + '</body></html>';
  }
  return '<html><body>' + PAD + '</body></html>';
}

function engineOf(url) {
  if (url.includes('bing.com')) return 'bing';
  if (url.includes('html.duckduckgo.com')) return 'ddg';
  if (url.includes('lite.duckduckgo.com')) return 'ddg-lite';
  if (url.includes('/search?')) return 'searxng';
  return 'other';
}

/**
 * Install a fetch that answers each engine after `delays[engine]` ms with `urls[engine]`.
 * Returns a record of which engines were actually called.
 *
 * searxng is answered with a JSON body so the test never reaches the real instances —
 * without this the suite silently depends on the network and takes 3s per case.
 */
function stubFetch({ delays = {}, urls = {} } = {}) {
  const called = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    const engine = engineOf(u);
    called.push(engine);
    const d = delays[engine] ?? 0;
    if (d > 0) await new Promise((r) => setTimeout(r, d));
    if (engine === 'searxng') {
      const hits = (urls.searxng ?? []).map((x) => ({ url: x, title: 't', content: 's' }));
      return new Response(JSON.stringify({ results: hits }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const body = htmlFor(engine, urls[engine] ?? []);
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return called;
}

const m = await import('../.test-build/websearch.js');

test.afterEach(() => { globalThis.fetch = realFetch; });

test('a slow high-priority engine still beats a fast low-priority one', async () => {
  // bing is first in the chain and is made SLOW; ddg-lite is last and is made FAST.
  // Serial semantics say bing wins. Parallel must agree.
  stubFetch({
    delays: { bing: 120, 'ddg-lite': 5, ddg: 5 },
    urls: {
      bing: ['https://github.com/unclecode/crawl4ai'],
      'ddg-lite': ['https://example.test/wrong'],
      ddg: ['https://example.test/wrong2'],
    },
  });
  const out = await m.runSearchChain({ query: 'crawl4ai github', maxResults: 5, engine: 'bing', cache: false }, {});
  assert.equal(out.engine, 'bing', 'the preferred engine must win even though it answered last');
  assert.equal(out.sources[0].url, 'https://github.com/unclecode/crawl4ai');
});

test('when the preferred engine fails, the next in priority order wins — not the fastest', async () => {
  // bing returns junk (off-topic), ddg is slow but correct, ddg-lite is fast but junk.
  stubFetch({
    delays: { bing: 5, ddg: 100, 'ddg-lite': 5 },
    urls: {
      bing: ['https://wps.cn/price'],
      ddg: ['https://github.com/unclecode/crawl4ai'],
      'ddg-lite': ['https://example.test/junk'],
    },
  });
  const out = await m.runSearchChain({ query: 'crawl4ai github', maxResults: 5, engine: 'bing', cache: false }, {});
  assert.equal(out.engine, 'ddg', 'priority order decides, not arrival order');
});

test('all engines failing concurrently costs about one timeout, not the sum', async () => {
  // Every engine takes 100ms and fails. Serial would be ~400ms; parallel should be ~100ms.
  stubFetch({ delays: { bing: 100, ddg: 100, 'ddg-lite': 100, searxng: 100 }, urls: {} });
  const t0 = Date.now();
  await assert.rejects(
    () => m.runSearchChain({ query: 'crawl4ai github', maxResults: 5, cache: false }, {}),
    /all search engines failed/,
  );
  const ms = Date.now() - t0;
  assert.ok(ms < 300, `expected roughly one timeout, took ${ms}ms (serial would be ~400ms+)`);
});

test('every engine is asked, even after one has already answered', async () => {
  // This is the cost of the design: we do not know a higher-priority engine will fail until
  // it fails, so all of them start. Documented here so the tradeoff is visible.
  const called = stubFetch({
    delays: { bing: 50 },
    urls: { bing: ['https://github.com/unclecode/crawl4ai'] },
  });
  await m.runSearchChain({ query: 'crawl4ai github', maxResults: 5, engine: 'bing', cache: false }, {});
  assert.ok(called.includes('bing'));
  assert.ok(called.length >= 2, 'lower-priority engines are started too, then aborted');
});

test('BLOCKED is still reported when every engine refuses', async () => {
  globalThis.fetch = async (url) => {
    const engine = engineOf(String(url));
    if (engine === 'bing' || engine === 'ddg' || engine === 'ddg-lite') {
      return new Response('<html><body>Select all squares containing a duck <script src="/anomaly.js?cc=botnet"></script></body></html>', { status: 202 });
    }
    return new Response('nope', { status: 429 });
  };
  await assert.rejects(
    () => m.runSearchChain({ query: 'crawl4ai github', maxResults: 5, cache: false }, {}),
    (e) => /BLOCKED/.test(String(e.message)),
  );
});
