// verify-dist.mjs — does the COMPILED bundle behave like the source?
//
// This exists because editing src/ does not change what the host loads. dist/index.js is
// the artifact the profile imports; a fix that never reached it is a fix that never ran.
// Measured this session: dist was 132,970 B and contained none of the new symbols.
//
// Run as:  node --import ./test/register-stubs.mjs test/verify-dist.mjs
// The stub hook must be registered by the loader BEFORE this module links, so it cannot be
// done from inside (import.meta.url is a data: URL here and resolves relative paths wrongly).
//
// REBUILDING dist ON THIS MACHINE: `npm run build` fails because the esbuild wrapper cannot
// find node_modules/@esbuild/win32-x64 (pnpm did not link it). The binary itself IS present:
//   node_modules/.pnpm/@esbuild+win32-x64@0.28.2/node_modules/@esbuild/win32-x64/esbuild.exe
// Call it directly:
//   <that path> src/index.ts --bundle --platform=node --format=esm \
//     --outfile=dist/index.js --packages=external --external:@deepseek-ai/* --log-level=warning
// The same binary rebuilds .test-build for the other tests.
const m = await import('../dist/index.js');

console.log('exports:', Object.keys(m).sort().join(', '));

const cases = [
  {
    name: 'CJK junk set (WPS pricing page for "爬蟲 原理")',
    got: m.looksOffTopic('爬蟲 原理', [{ url: 'https://365.wps.cn/price', title: 'WPS会员价格', snippet: 'WPS Office 会员' }]),
    want: true,
  },
  {
    name: 'CJK good set (Wikipedia for "爬蟲 原理")',
    got: m.looksOffTopic('爬蟲 原理', [{ url: 'https://zh.wikipedia.org/wiki/網路爬蟲', title: '網路爬蟲 - 維基百科', snippet: '網路爬蟲是一種自動瀏覽網頁的程式' }]),
    want: false,
  },
  {
    name: 'CJK other subject (Sogou IME for "網路爬蟲是什麼")',
    got: m.looksOffTopic('網路爬蟲是什麼', [{ url: 'https://shurufa.sogou.com/', title: '搜狗输入法 - 官网', snippet: '智能拼音输入法下载' }]),
    want: true,
  },
  {
    name: 'latin control (must not regress)',
    got: m.looksOffTopic('dsh-session-handoff ACP compaction', [{ url: 'https://www.deepseek.com/harness/en/', title: 'DeepSeek Harness developer preview' }]),
    want: true,
  },
  {
    name: 'single CJK char is not judgeable',
    got: m.looksOffTopic('爬', [{ url: 'https://x.test/a', title: 'unrelated' }]),
    want: false,
  },
  {
    name: 'DDG botnet CAPTCHA is a refusal',
    got: m.detectRefusal('<script src="/anomaly.js?sv=lite&cc=botnet"></script>'),
    want: 'bot challenge (DDG botnet CAPTCHA)',
  },
  {
    name: 'a real result page is not a refusal',
    got: m.detectRefusal('<li class="b_algo"><a href="https://github.com/unclecode/crawl4ai">crawl4ai</a></li>'),
    want: null,
  },
  {
    name: 'EngineBlockedError is exported and names the engine',
    got: (() => { const e = new m.EngineBlockedError('ddg', 'x'); return e.name + '|' + e.engine; })(),
    want: 'EngineBlockedError|ddg',
  },
];

let fail = 0;
for (const c of cases) {
  const ok = c.got === c.want;
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) console.log(`        got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
}
console.log(`\n${cases.length - fail}/${cases.length} pass`);
process.exit(fail === 0 ? 0 : 1);
