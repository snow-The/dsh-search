// Production failure this pins down: search_arxiv returned "No results for any query." while every
// query had in fact failed with HTTP 429 ("Rate exceeded.", a 14-byte body). The caller had already
// built the ERROR lines and then threw them away because it counted papers instead of outcomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatBatch, formatPapers, parseAtom, parseRetryAfter, __arxivInternals } from '../.test-build/arxiv.js';

test('a rate-limited query is never reported as an empty result set', () => {
  const out = formatBatch([{ query: 'all:MemGPT', papers: [], error: 'HTTP 429 (arXiv rate limit — the API throttles bursts even with the 3s pacing)' }]);
  assert.match(out, /ERROR: HTTP 429/, out);
  assert.ok(!/^No results for any query\.$/.test(out), 'a failure must not look like an empty set: ' + out);
  assert.match(out, /1\/1 queries FAILED/, out);
});

test('Retry-After is honoured, bounded, and survives a hostile value', () => {
  assert.equal(parseRetryAfter('30'), 30000);
  assert.equal(parseRetryAfter(null), 0);
  assert.equal(parseRetryAfter(''), 0);
  assert.equal(parseRetryAfter('nonsense'), 0);
  assert.equal(parseRetryAfter('9999'), 60000, 'a server cannot stall the tool for hours');
});

// info.arxiv.org: ~1 request per 3s, and exceeding it gets the IP temporarily blocked. An
// in-process lastCall only serialises ONE process; the main agent, a subagent and a headless run
// each load their own copy. The gate is on disk so every dsh process queues on the same clock.
test('the pacing gate is on disk, so separate processes queue instead of bursting', async () => {
  const { throttle, MIN_GAP_MS, THROTTLE_FILE } = __arxivInternals;
  assert.ok(MIN_GAP_MS >= 3000, 'arXiv asks for at least 3s: ' + MIN_GAP_MS);
  assert.ok(THROTTLE_FILE.indexOf('.arxiv-throttle') >= 0, THROTTLE_FILE);
  const fs = await import('node:fs');
  fs.writeFileSync(THROTTLE_FILE, String(Date.now()));
  const t0 = Date.now();
  await throttle();
  const waited = Date.now() - t0;
  assert.ok(waited >= MIN_GAP_MS - 250, 'the second caller must wait for the first, waited ' + waited + 'ms');
  fs.rmSync(THROTTLE_FILE, { force: true });
});

test('a genuinely empty result set still says so', () => {
  assert.equal(formatBatch([{ query: 'all:zzzznotathing', papers: [], total: 0 }]), 'No results for any query.');
});

test('a mixed batch keeps the successes and reports the failure', () => {
  const paper = { id: '2310.08560', title: 'MemGPT: Towards LLMs as Operating Systems', summary: 'virtual context management', published: '2023-10-12', updated: '2023-10-12', authors: ['Packer'], categories: ['cs.CL'], pdfUrl: 'x' };
  const out = formatBatch([
    { query: 'q1', papers: [paper] },
    { query: 'q2', papers: [], error: 'HTTP 503' },
  ]);
  assert.match(out, /MemGPT/);
  assert.match(out, /1\/2 queries FAILED/, out);
});

test('formatPapers keeps the error line for a single query', () => {
  assert.match(formatPapers({ query: 'q', papers: [], error: 'HTTP 429' }), /ERROR: HTTP 429/);
});

// The bug this pins down: parseAtom() only matched NAMESPACED tags (<ns:title>), while arXiv writes
// <id> <title> <summary> <published> unprefixed. Every entry was dropped, zero papers came back with
// no error, and formatBatch reported that as 'No results for any query.' — the tool saying the world
// is empty when its own parser had matched nothing. The fixture is a VERBATIM wire capture, because a
// hand-written one is exactly how this shipped: the suite covered the formatter, never the parser.
test('parseAtom reads the real feed (unprefixed Atom tags)', () => {
  const xml = readFileSync(new URL('./fixtures/arxiv-ti-memory.xml', import.meta.url), 'utf8');
  const papers = parseAtom(xml);
  assert.equal(papers.length, 1, 'the fixture holds exactly one entry — a parser returning 0 IS the bug');
  assert.equal(papers[0].id, '2209.00307v2', 'the id comes from the <id> URL');
  assert.match(papers[0].title, /^Memory Tagging/, 'the title must survive');
  assert.ok(papers[0].summary.length > 40, 'the summary must survive');
  assert.match(papers[0].published, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'published is a date, got: ' + papers[0].published);
  assert.ok(papers[0].authors.length >= 1, 'authors come from <author><name>');
  assert.ok(papers[0].categories.length >= 1, 'categories come from <category term=... scheme=.../>');
  assert.match(papers[0].updated, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'updated must survive too');
  assert.equal(papers[0].pdfUrl, 'https://arxiv.org/pdf/2209.00307', 'the pdf url follows the id, minus the version');
});