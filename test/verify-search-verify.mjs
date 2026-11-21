// verify-search-verify.mjs — does search_verify actually discriminate?
//
// A checker that says "ok" for everything is not a checker. This feeds it a set whose
// expected verdicts are known in advance:
//   - a live primary source            -> ok, primary
//   - a live content mill              -> ok, farm
//   - a URL that cannot resolve        -> not ok
//   - a URL that needs a credential    -> authWall (or not ok)
//
// The expectation is written BEFORE the run, so a surprise is visible as a surprise.
import { verifyMany, summarize, verifyOne } from '../.test-build/verify.js';

const CASES = [
  { url: 'https://github.com/unclecode/crawl4ai', expect: { ok: true, primary: true } },
  { url: 'https://blog.csdn.net/weixin_42232219/article/details/90824246', expect: { ok: true, farm: true } },
  { url: 'https://this-host-does-not-exist-9f3a2b.invalid/page', expect: { ok: false } },
  { url: 'https://api.github.com/user', expect: { authWall: true } },
];

console.log('=== per-URL ===');
const links = await verifyMany(CASES.map((c) => c.url), { timeoutMs: 15000 }, 4);
let pass = 0;
for (let i = 0; i < CASES.length; i += 1) {
  const c = CASES[i];
  const l = links[i];
  const checks = Object.entries(c.expect).map(([k, want]) => {
    const got = l[k];
    const ok = got === want;
    if (ok) pass += 1;
    return `${k}=${got}${ok ? '' : ` (want ${want})`}`;
  });
  console.log(`\n${c.url}`);
  console.log(`  status=${l.status} ok=${l.ok} kind=${l.kind} farm=${l.farm} primary=${l.primary} authWall=${l.authWall} ${l.ms}ms`);
  if (l.finalUrl !== l.url) console.log(`  finalUrl=${l.finalUrl}`);
  if (l.error) console.log(`  error=${l.error.slice(0, 90)}`);
  console.log(`  ${checks.join('  ')}`);
}

const total = CASES.reduce((s, c) => s + Object.keys(c.expect).length, 0);
console.log(`\n${pass}/${total} expectations met`);

console.log('\n=== summary of the whole set ===');
console.log(JSON.stringify(summarize(links), null, 2));

console.log('\n=== read:true keeps a bounded title/excerpt ===');
const one = await verifyOne('https://github.com/unclecode/crawl4ai', { read: true, maxChars: 200, timeoutMs: 15000 });
console.log(`  title=${JSON.stringify(one.title)}`);
console.log(`  excerpt=${JSON.stringify((one.excerpt ?? '').slice(0, 160))}`);

process.exit(pass === total ? 0 : 1);
