// probe-deepseek-fail.mjs — why does the deepseek engine fall through on some queries?
//
// The chain reported served=ddg-lite for "爬蟲 原理" even though deepseek is first. That
// means searchDeepseek threw. This prints the actual error instead of guessing.
import { readFileSync, existsSync } from 'node:fs';

if (!process.env.DEEPSEEK_API_KEY) {
  const p = 'C:/Users/snow/.dsh/.credentials.yaml';
  if (existsSync(p)) {
    const k = readFileSync(p, 'utf8').match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/)?.[1];
    if (k) process.env.DEEPSEEK_API_KEY = k;
  }
}

const m = await import('../.test-build/websearch.js');

const QUERIES = ['爬蟲 原理', 'dsh-session-handoff ACP compaction', 'crawl4ai github'];

for (const q of QUERIES) {
  const t0 = Date.now();
  try {
    const out = await m.runSearchChain({ query: q, maxResults: 10, engine: 'deepseek', cache: false }, {}, AbortSignal.timeout(120000));
    console.log(`\n${JSON.stringify(q)} -> OK served=${out.engine} n=${out.sources.length} ${Date.now() - t0}ms`);
    if (out.note) console.log('  note: ' + out.note.slice(0, 400));
  } catch (e) {
    console.log(`\n${JSON.stringify(q)} -> THREW ${Date.now() - t0}ms`);
    console.log('  ' + String(e.message).slice(0, 600));
  }
}
