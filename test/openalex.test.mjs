// The arXiv API blocks this machine (429 then silence: every host timed out at 15s while
// arxiv.org/abs HTML still loaded in 229ms). A paper tool that can only fail is not a tool, so the
// client falls back to OpenAlex -- and a fallback result must SAY it is one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rebuildAbstract, workId } from '../.test-build/openalex.js';
import { formatPapers, paperUrl } from '../.test-build/arxiv.js';

test('the inverted index rebuilds into readable text, in order', () => {
  assert.equal(rebuildAbstract({ world: [1], hello: [0], again: [2] }), 'hello world again');
  assert.equal(rebuildAbstract(null), '');
  assert.equal(rebuildAbstract({ a: 'not-an-array' }), '');
});

test('a work id prefers the arXiv id, then the DOI, then the OpenAlex id', () => {
  assert.equal(workId({ ids: { arxiv: 'https://arxiv.org/abs/2310.08560' } }), '2310.08560');
  assert.equal(workId({ doi: 'https://doi.org/10.1/x' }), '10.1/x');
  assert.equal(workId({ id: 'https://openalex.org/W123' }), 'W123');
});

test('the link follows the id, not the tool name', () => {
  assert.equal(paperUrl('2310.08560'), 'https://arxiv.org/abs/2310.08560');
  assert.equal(paperUrl('2310.08560v2'), 'https://arxiv.org/abs/2310.08560v2');
  assert.equal(paperUrl('10.1145/3586183.3606763'), 'https://doi.org/10.1145/3586183.3606763');
  assert.equal(paperUrl('W123', 'openalex'), 'https://openalex.org/W123');
});

test('a fallback result is labelled, never passed off as an arXiv result', () => {
  const out = formatPapers({ query: 'q', papers: [], source: 'openalex', note: 'arXiv API unreachable; served by OpenAlex' });
  assert.match(out, /OpenAlex \(arXiv fallback\)/, out);
  assert.match(out, /arXiv API unreachable/, out);
});