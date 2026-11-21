// verify-deepseek-engine.mjs — does the new engine actually serve results through the
// plugin's own chain, and does it beat the free engines it now outranks?
//
// This drives runSearchChain (the real path platform_search uses), not the raw endpoint.
// The earlier probe proved the endpoint works; this proves the plugin uses it.
import { readFileSync, existsSync } from 'node:fs';

// The chain reads DEEPSEEK_API_KEY from the environment; the local store is a YAML file.
if (!process.env.DEEPSEEK_API_KEY) {
  const p = 'C:/Users/snow/.dsh/.credentials.yaml';
  if (existsSync(p)) {
    const k = readFileSync(p, 'utf8').match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/)?.[1];
    if (k) process.env.DEEPSEEK_API_KEY = k;
  }
}
console.log('key present:', Boolean(process.env.DEEPSEEK_API_KEY));

const m = await import('../.test-build/websearch.js');

const FARM = ['csdn.net', 'tencent.com', 'aliyun.com', '51cto.com', 'cnblogs.com', 'jianshu.com',
  'zhihu.com', 'juejin.cn', 'segmentfault.com', 'bilibili.com', 'sohu.com', '163.com',
  'sina.com', 'baijiahao.baidu.com', 'toutiao.com'];
const PRIMARY = ['github.com', 'raw.githubusercontent.com', 'api-docs.deepseek.com', 'pypi.org',
  'npmjs.com', 'arxiv.org', 'developer.mozilla.org', 'wikipedia.org', 'deepseek.com'];
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const under = (h, d) => h === d || h.endsWith('.' + d);
const classify = (u) => {
  const h = hostOf(u);
  if (FARM.some((d) => under(h, d))) return 'farm';
  if (PRIMARY.some((d) => under(h, d))) return 'primary';
  return 'other';
};

const QUERIES = [
  { id: 'zh-top', q: '爬蟲 原理' },
  { id: 'zh-nav', q: '維基百科 網路爬蟲' },
  { id: 'en-nav', q: 'crawl4ai github' },
  { id: 'en-rare', q: 'dsh-session-handoff ACP compaction' },
];

console.log('\n=== engine: deepseek (the new default) ===');
let total = 0, farm = 0, prim = 0;
for (const c of QUERIES) {
  const t0 = Date.now();
  try {
    const out = await m.runSearchChain({ query: c.q, maxResults: 10, engine: 'deepseek', cache: false }, {}, AbortSignal.timeout(120000));
    const cls = out.sources.map((s) => classify(s.url));
    total += out.sources.length;
    farm += cls.filter((x) => x === 'farm').length;
    prim += cls.filter((x) => x === 'primary').length;
    const off = m.looksOffTopic(c.q, out.sources);
    console.log(`${c.id.padEnd(8)} ${String(Date.now() - t0).padStart(6)}ms  n=${String(out.sources.length).padStart(2)}  served=${out.engine}  farm=${cls.filter((x) => x === 'farm').length} primary=${cls.filter((x) => x === 'primary').length}  guardOffTopic=${off}`);
    for (const s of out.sources.slice(0, 3)) console.log(`     ${classify(s.url).padEnd(8)} ${s.url.slice(0, 90)}`);
  } catch (e) {
    console.log(`${c.id.padEnd(8)} THREW: ${String(e.message).slice(0, 160)}`);
  }
}
console.log(`\nTOTAL sources=${total} farm=${farm} primary=${prim}`);

console.log('\n=== engine: auto (no hint — deepseek should win) ===');
for (const c of QUERIES.slice(0, 2)) {
  const t0 = Date.now();
  try {
    const out = await m.runSearchChain({ query: c.q, maxResults: 10, cache: false }, {}, AbortSignal.timeout(120000));
    console.log(`${c.id.padEnd(8)} ${String(Date.now() - t0).padStart(6)}ms  n=${out.sources.length}  served=${out.engine}`);
  } catch (e) {
    console.log(`${c.id.padEnd(8)} THREW: ${String(e.message).slice(0, 160)}`);
  }
}
