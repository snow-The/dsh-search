
import { extractText, chunkText, hashEmbed, cosine, CorpusStore } from '../src/query.ts';
import { githubSearch, githubToken } from '../src/github.ts';
import { createApp } from '../src/server.ts';

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

const app = createApp();
const h = await app.fetch(new Request('http://localhost/health'));
console.log('HONO /health:', h.status, await h.text());
const g = await app.fetch(new Request('http://localhost/github?q=hono&type=repo&perPage=2'));
const gj = await g.json();
console.log('HONO /github:', g.status, 'total=' + gj.total, '| ' + (gj.hits ?? []).map(x => x.title).join(' ; '));
