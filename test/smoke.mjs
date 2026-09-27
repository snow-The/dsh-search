
// Imported from the pre-bundled test build (npm run pretest) rather than from src/:
// the plugin's source uses .js specifiers for .ts modules (correct for its esbuild
// build, unresolvable for plain node), so the suite runs against the same sources
// after bundling - which is what the plugin actually ships.
import { extractText, chunkText, hashEmbed, cosine, CorpusStore } from '../.test-build/query.js';
import { githubSearch, githubToken } from '../.test-build/github.js';
import { handleRequest } from '../.test-build/server.js';

const html = '<html><head><style>body{}</style></head><body><nav>menu</nav><h1>Hello &amp; World</h1><p>Sentence one. Sentence two!</p><script>var x=1;</script></body></html>';
console.log('EXTRACT:', JSON.stringify(extractText(html)));

const long = 'Para one. '.repeat(30) + 'Sentence A. '.repeat(120);
const chunks = chunkText(long, 800);
console.log('CHUNKS:', chunks.length, 'len0=' + chunks[0].length, 'sentence-aware=' + (chunks[0].includes('Sentence A.')));

const a = hashEmbed('deepseek harness plugin search');
const c = hashEmbed('banana cake recipe');
console.log('COSINE same:', cosine(a, hashEmbed('deepseek harness plugin search')).toFixed(4), '| diff:', cosine(a, c).toFixed(4));

const store = new CorpusStore('C:/Users/snow/AppData/Local/Temp/dsh-search-test.db');
store.add('https://a.example', ['deepseek harness is an agent platform', 'sqlite vector search rocks'], [hashEmbed('x'), hashEmbed('y')]);
const hits = store.search(hashEmbed('deepseek harness agent'), 2);
console.log('SEARCH:', hits.map(h => h.score.toFixed(3) + ' ' + h.url).join(' | '));
store.clear();
console.log('CLEARED count:', store.count());
store.close();

const tok = githubToken();
console.log('GITHUB_TOKEN:', tok ? tok.slice(0, 6) + '...' : '(none)');
const r = await githubSearch('repo', 'deepseek harness', { perPage: 3 });
console.log('GH REPO:', r.error ? 'ERR ' + r.error : 'total=' + r.total + ' | ' + r.hits.map(h => h.title + ' ★' + (h.extra?.stars ?? '?')).join(' ; '));

// 直接驱动原生 node:http handler(假 res 捕获 status/body) —— server.ts 已不带 hono,
// 也不再需要 app.fetch(new Request(...)) 那座 Node↔Fetch 桥。
const call = async (method, path, body) => {
  const res = { statusCode: 0, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } };
  const req = { method, url: path };
  if (body !== undefined) req[Symbol.asyncIterator] = async function* () { yield Buffer.from(body) };
  await handleRequest(req, res);
  return { status: res.statusCode, text: () => String(res.body ?? ''), json: () => JSON.parse(String(res.body ?? 'null')) };
};
const h = await call('GET', '/health');
console.log('NATIVE /health:', h.status, h.text());
const g = await call('GET', '/github?q=hono&type=repo&perPage=2');
const gj = g.json();
console.log('NATIVE /github:', g.status, 'total=' + gj.total, '| ' + (gj.hits ?? []).map(x => x.title).join(' ; '));