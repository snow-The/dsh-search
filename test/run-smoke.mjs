import { searchCode } from './search-code-smoke.mjs';
const root = "C:\\Users\\snow\\.dsh-starter\\plugins\\dsh-search";
for (const [label, query, topK, filter] of [
  ['Q1 symbol: embedTexts', 'embedTexts', 5, undefined],
  ['Q2 nl: BM25 score computation', 'BM25 score computation', 5, undefined],
  ['Q3 filter: authentication file:*index.ts', 'authentication', 3, 'file:"*index.ts"']
]) {
  const t0 = Date.now();
  const hits = await searchCode({ path: root, query, topK, filter });
  console.log(label + ' (' + (Date.now() - t0) + 'ms):');
  for (const h of hits) console.log('  ' + h.filePath + ':' + h.startLine + '-' + h.endLine + ' score=' + h.score.toFixed(3));
}
// second run to verify cache hit
const t1 = Date.now();
const h2 = await searchCode({ path: root, query: 'embedTexts', topK: 3 });
console.log('CACHED run (' + (Date.now() - t1) + 'ms) hits=' + h2.length);