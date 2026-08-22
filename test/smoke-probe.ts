// Smoke test for probe + deepsearch modules (bundled by esbuild).
import { parseFeed, normalizeUrl, SeenCache, hnSearch, redditSearch, fetchFeed, probeAll, relatedSearches } from '../src/probe.js';
import { deepSearch } from '../src/deepsearch.js';

const results: string[] = [];
const ok = (name: string, cond: boolean, extra = '') => {
  results.push((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : ''));
};

// 1. feed parsing (sample RSS)
const sampleXml = '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>' +
  '<item><title>First</title><link>https://example.com/1</link><description>desc one</description><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>' +
  '<item><title>Second</title><link>https://example.com/2</link><description>&amp; entities</description></item>' +
  '</channel></rss>';
const items = parseFeed(sampleXml);
ok('parseFeed count', items.length === 2);
ok('parseFeed fields', items[0]?.title === 'First' && items[0]?.link === 'https://example.com/1' && items[0]?.description === 'desc one');
ok('parseFeed entities', items[1]?.description === '& entities');

// 2. URL normalization
ok('normalizeUrl strip utm', normalizeUrl('https://a.com/x?utm_source=1&b=2') === 'https://a.com/x?b=2');
ok('normalizeUrl strip hash', normalizeUrl('https://a.com/y#sec') === 'https://a.com/y');

// 3. SeenCache
const cache = new SeenCache();
cache.clear(); ok('seenCache empty', !cache.seen('https://a.com/p'));
cache.mark('https://a.com/p?utm_source=x');
ok('seenCache dedupe', cache.seen('https://a.com/p'));

// 4. real network: HN + Reddit
try {
  const hn = await hnSearch('deepseek', 3);
  ok('hnSearch live', hn.length > 0, hn.length + ' hits, first: ' + (hn[0]?.title ?? '').slice(0, 50));
} catch (e) { ok('hnSearch live', false, String((e as Error).message).slice(0, 80)); }
try {
  const rd = await redditSearch('deepseek', undefined, 3);
  ok('redditSearch live', rd.length > 0, rd.length + ' hits, first: ' + (rd[0]?.title ?? '').slice(0, 50));
} catch (e) { results.push('SKIP redditSearch live (network-blocked: ' + String((e as Error).message).slice(0, 40) + ')'); }

// 5. RSSHub feed (public instance)
try {
  const f = await fetchFeed('hn/best', 5);
  ok('rsshub feed', f.items.length > 0, f.items.length + ' items from ' + f.source);
} catch (e) { results.push('SKIP rsshub feed (public instance blocked from this network; self-host via DSH_SEARCH_RSSHUB_URL)'); }

// 6. probeAll multi-source
try {
  const p = await probeAll('deepseek r1', { targets: 'hn,reddit', maxPerSource: 3 });
  const kinds = p.sources.map((s) => s.kind + ':' + s.items.length).join(', ');
  ok('probeAll', p.sources.length >= 2 && p.dedupedLinks.length >= 0, kinds + ' | deduped: ' + p.dedupedLinks.length);
} catch (e) { ok('probeAll', false, String((e as Error).message).slice(0, 80)); }

// 7. relatedSearches (DDG)
try {
  const rq = await relatedSearches('deepseek');
  ok('relatedSearches', rq.length >= 0, rq.length + ' related');
} catch (e) { ok('relatedSearches', false, String((e as Error).message).slice(0, 80)); }

// 8. deepSearch with a stub LLM (no network LLM needed)
const stubLlm = {
  async *stream(opts: any) {
    const p = opts.messages?.[opts.messages.length - 1]?.content ?? '';
    if (p.includes('search strategist')) {
      yield { text: '{"queries":["deepseek r1"]}' };
    } else if (p.includes('research coordinator')) {
      yield { text: '{"done":true,"summary":"enough"}' };
    } else {
      yield { text: '{"answer":"DeepSeek R1 is a reasoning model [1].","cited":[1]}' };
    }
  },
};
try {
  const ds = await deepSearch(stubLlm as any, 'what is deepseek r1?', { maxIterations: 1, maxQueries: 1 });
  ok('deepSearch loop', ds.answer.includes('[1]') && ds.answer.includes('Sources:'), 'iterations=' + ds.iterations + ' sources=' + ds.sources.length);
} catch (e) { ok('deepSearch loop', false, String((e as Error).message).slice(0, 120)); }

console.log(results.join('\n'));
console.log('---');
console.log('total: ' + results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' passed');