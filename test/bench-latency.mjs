// bench-latency.mjs — measure where the 63 seconds actually go, BEFORE changing anything.
//
// The claim to test: the chain is slow because engines are tried one after another, and
// because searxng tries its 9 instances one after another inside that. If that is true,
// running them concurrently should collapse the wall time toward the slowest single call
// rather than the sum.
//
// This measures each layer separately so the improvement can be attributed:
//   L1  one engine, one query          -> baseline for a single network call
//   L2  searxng alone (9 instances)    -> is the inner loop the cost?
//   L3  full chain, one engine hint    -> what the tool actually pays
//
// Run as:  node --import ./test/register-stubs.mjs test/bench-latency.mjs
// The stub hook is registered by the loader; registering it again here would resolve
// './test/register-stubs.mjs' against a data: URL and fail.
const m = await import('../dist/index.js');

const Q = 'crawl4ai github';
const time = async (label, fn) => {
  const t0 = Date.now();
  let note = '';
  try {
    const r = await fn();
    note = typeof r === 'number' ? `n=${r}` : String(r ?? '');
  } catch (e) {
    note = 'THREW ' + String(e.message ?? e).slice(0, 60);
  }
  const ms = Date.now() - t0;
  console.log(`${label.padEnd(34)} ${String(ms).padStart(7)}ms  ${note}`);
  return ms;
};

console.log('=== L1: single engine, single query ===');
for (const eng of ['bing', 'ddg', 'ddg-lite']) {
  await time(`  ${eng}`, async () => {
    const out = await m.runSearchChain({ query: Q, maxResults: 5, engine: eng, cache: false }, {}, AbortSignal.timeout(90000));
    return out.sources.length;
  });
}

console.log('\n=== L2: searxng alone (9 instances, currently serial) ===');
await time('  searxng', async () => {
  const out = await m.runSearchChain({ query: Q, maxResults: 5, engine: 'searxng', cache: false }, {}, AbortSignal.timeout(120000));
  return out.sources.length;
});

console.log('\n=== L3: full chain (no engine hint) ===');
await time('  auto', async () => {
  const out = await m.runSearchChain({ query: Q, maxResults: 5, cache: false }, {}, AbortSignal.timeout(180000));
  return out.sources.length;
});
