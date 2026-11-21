// probe-offtopic-false-positive.mjs — is looksOffTopic rejecting a CORRECT result set?
//
// The chain reported "10 results share no query token (off-topic)" for
// "dsh-session-handoff ACP compaction" while the sources were the right GitHub repo.
// If the guard rejects a correct set, it is worse than no guard: it forces a fallback to
// an engine that is blocked, and the caller gets junk.
import { readFileSync, existsSync } from 'node:fs';

if (!process.env.DEEPSEEK_API_KEY) {
  const p = 'C:/Users/snow/.dsh/.credentials.yaml';
  if (existsSync(p)) {
    const k = readFileSync(p, 'utf8').match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/)?.[1];
    if (k) process.env.DEEPSEEK_API_KEY = k;
  }
}

const m = await import('../.test-build/websearch.js');

const Q = 'dsh-session-handoff ACP compaction';

// Call the engine directly, bypassing the guard, so we can see what it actually returned.
const out = await m.runSearchChain({ query: Q, maxResults: 10, engine: 'deepseek', cache: false }, {}, AbortSignal.timeout(120000));
console.log('chain served=' + out.engine + ' n=' + out.sources.length);
console.log('note: ' + String(out.note ?? '').slice(0, 200));

console.log('\n=== what the guard sees ===');
const TOKEN_RE = /[a-z0-9][a-z0-9._-]{2,}/g;
const STOP = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'best', 'vs', 'not', 'from', 'into', 'that', 'this', 'are', 'was', 'you', 'your', 'can', 'a', 'an', 'of', 'in', 'to', 'on']);
const toks = (Q.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => !STOP.has(t));
console.log('query tokens: ' + JSON.stringify(toks));

for (const s of out.sources) {
  const hay = ((s.title ?? '') + ' ' + (s.snippet ?? '') + ' ' + (s.url ?? '')).toLowerCase();
  const matched = toks.filter((t) => hay.includes(t));
  console.log(`  matched=${matched.length}/${toks.length} ${JSON.stringify(matched)}`);
  console.log(`    url: ${s.url}`);
  console.log(`    title: ${(s.title ?? '').slice(0, 80)}`);
  console.log(`    snippet: ${(s.snippet ?? '').slice(0, 100)}`);
}

console.log('\nguard verdict: ' + m.looksOffTopic(Q, out.sources));
