// probe-nondeterminism.mjs — is the deepseek engine's result set stable across calls?
//
// Two runs of the same query returned different verdicts: one fell through to ddg-lite with
// "10 results share no query token (off-topic)", the next served deepseek with 10 good
// sources. If the engine is non-deterministic, then a single measurement of "quality" is
// not a measurement — and the guard's verdict is a coin flip on the same input.
//
// This runs the same query N times and reports the set hash and the guard verdict each time.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

if (!process.env.DEEPSEEK_API_KEY) {
  const p = 'C:/Users/snow/.dsh/.credentials.yaml';
  if (existsSync(p)) {
    const k = readFileSync(p, 'utf8').match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/)?.[1];
    if (k) process.env.DEEPSEEK_API_KEY = k;
  }
}

const m = await import('../.test-build/websearch.js');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const Q = process.argv[2] ?? 'dsh-session-handoff ACP compaction';
const N = Number(process.argv[3] ?? 4);

console.log(`query=${JSON.stringify(Q)}  runs=${N}\n`);
const seen = [];
for (let i = 0; i < N; i += 1) {
  const t0 = Date.now();
  try {
    const out = await m.runSearchChain({ query: Q, maxResults: 10, engine: 'deepseek', cache: false }, {}, AbortSignal.timeout(120000));
    const urls = out.sources.map((s) => s.url);
    const h = sha(urls.join('\n'));
    const off = m.looksOffTopic(Q, out.sources);
    seen.push({ i, served: out.engine, n: urls.length, h, off, ms: Date.now() - t0 });
    console.log(`run ${i}: served=${out.engine.padEnd(9)} n=${String(urls.length).padStart(2)} hash=${h} guardOffTopic=${off} ${Date.now() - t0}ms`);
    if (out.note) console.log(`        note: ${String(out.note).slice(0, 140)}`);
  } catch (e) {
    seen.push({ i, served: 'THREW', n: 0, h: '-', off: null, ms: Date.now() - t0 });
    console.log(`run ${i}: THREW ${Date.now() - t0}ms  ${String(e.message).slice(0, 160)}`);
  }
}

const hashes = [...new Set(seen.map((s) => s.h))];
const served = [...new Set(seen.map((s) => s.served))];
console.log(`\ndistinct result sets: ${hashes.length} of ${N} runs`);
console.log(`engines that served: ${served.join(', ')}`);
console.log(hashes.length === 1
  ? '=> DETERMINISTIC for this query'
  : '=> NON-DETERMINISTIC: a single run cannot measure quality');
