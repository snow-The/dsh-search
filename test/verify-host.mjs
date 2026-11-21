// verify-host.mjs — does the artifact the HOST loads produce the new behaviour?
//
// verify-dist.mjs proves dist/index.js exports the fixed functions. This proves the same
// file, driven through the real runSearchChain with a short deadline, now reports BLOCKED
// instead of silently returning junk. Those are different claims.
//
// A 60s tool timeout is itself a finding: the chain tries four engines, each with a 12s
// fetch timeout and 3 retries, so a blocked host makes the call slow rather than wrong.
//
// Run as:  node --import ./test/register-stubs.mjs test/verify-host.mjs
// The stub hook is registered by the loader; registering it again here would resolve
// './test/register-stubs.mjs' against a data: URL and fail.
const m = await import('../dist/index.js');

const deadline = (ms) => AbortSignal.timeout(ms);

const cases = [
  { engine: 'ddg', q: '爬蟲 原理' },
  { engine: 'ddg-lite', q: '網路爬蟲是什麼' },
  { engine: 'bing', q: 'crawl4ai github' },
];

for (const c of cases) {
  const t0 = Date.now();
  try {
    const out = await m.runSearchChain({ query: c.q, maxResults: 5, engine: c.engine, cache: false }, {}, deadline(25000));
    const n = out.sources.length;
    const off = m.looksOffTopic(c.q, out.sources);
    console.log(`${c.engine.padEnd(9)} ${JSON.stringify(c.q).padEnd(22)} OK served=${out.engine} n=${n} guardOffTopic=${off} ${Date.now() - t0}ms`);
    if (off) console.log(`          note: ${String(out.note ?? '').slice(0, 160)}`);
  } catch (e) {
    const msg = String(e.message ?? e);
    const blocked = /BLOCKED/.test(msg);
    console.log(`${c.engine.padEnd(9)} ${JSON.stringify(c.q).padEnd(22)} THREW blocked=${blocked} ${Date.now() - t0}ms`);
    console.log(`          ${msg.slice(0, 220)}`);
  }
}
