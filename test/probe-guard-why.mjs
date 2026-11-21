// probe-guard-why.mjs — WHICH rule inside looksOffTopic fires?
//
// The chain says off-topic; calling looksOffTopic on the returned set says false. Either
// the chain judges a different set, or a rule I am not reading fires. This reproduces the
// guard's own branches against the exact set the engine returned.
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

// Ask the engine directly by importing the module's own chain with a hint, then read what
// it decided. runSearchChain hides the rejected set, so re-derive it from the same call the
// engine makes: a single-engine chain returns the set only when it passes the guard.
const out = await m.runSearchChain({ query: Q, maxResults: 10, engine: 'deepseek', cache: false }, {}, AbortSignal.timeout(120000));
console.log('served=' + out.engine + '  n=' + out.sources.length);
console.log('note=' + String(out.note ?? '').slice(0, 300));

// Rebuild the guard's inputs exactly.
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'best', 'vs', 'not', 'from', 'into', 'that', 'this', 'are', 'was', 'you', 'your', 'can', 'a', 'an', 'of', 'in', 'to', 'on']);
const q = Q.toLowerCase();
const tokens = (q.match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
const hay = (h) => ((h.title ?? '') + ' ' + (h.snippet ?? '') + ' ' + (h.url ?? '')).toLowerCase();
const all = out.sources.map(hay).join(' ');
const matched = tokens.filter((t) => all.includes(t));

console.log('\n=== guard inputs ===');
console.log('tokens: ' + JSON.stringify(tokens));
console.log('matched: ' + JSON.stringify(matched) + ` (${matched.length}/${tokens.length})`);
console.log('hits.length: ' + out.sources.length);

// Rule 1: no token matched at all.
console.log('\nrule "no token matched": ' + (matched.length === 0));

// Rule 2: exactly one matched token, and EVERY hit contains it.
if (tokens.length >= 3 && matched.length === 1 && out.sources.length > 1) {
  const word = matched[0];
  const every = out.sources.every((h) => hay(h).includes(word));
  console.log(`rule "only ubiquitous token": tokens>=3 && matched==1 -> word=${word} everyHitHasIt=${every} => ${every}`);
} else {
  console.log(`rule "only ubiquitous token": not applicable (tokens=${tokens.length} matched=${matched.length} hits=${out.sources.length})`);
}

// Rule 3: every hit is a site root.
const isNav = (u) => { try { const x = new URL(String(u)); return x.pathname === '/' || x.pathname === ''; } catch { return false; } };
const allRoots = out.sources.length > 0 && out.sources.every((h) => isNav(String(h.url ?? '')));
console.log('rule "all site roots": ' + allRoots);
for (const h of out.sources) console.log(`   ${isNav(h.url) ? 'ROOT' : 'deep'}  ${h.url}`);

console.log('\nfinal looksOffTopic: ' + m.looksOffTopic(Q, out.sources));
