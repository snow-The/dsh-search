// CORE verified from this machine: HTTP 200 with NO key, abstracts + download URLs included.
// It sits BEHIND OpenAlex because its relevance is loose (query "context compaction language model"
// returned a soil-science paper about subsoil compaction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCoreRecord } from '../.test-build/core.js';
import { paperUrl } from '../.test-build/arxiv.js';

test('a CORE record maps into the shared paper shape', () => {
  const p = mapCoreRecord({
    id: 332640295,
    title: 'Subsoil  Compaction: a hidden form',
    abstract: 'two definitions',
    yearPublished: 2001,
    doi: 'https://doi.org/10.1/x',
    arxivId: null,
    downloadUrl: 'https://core.ac.uk/download/1.pdf',
    authors: [{ name: 'Montanarella, Luca' }, { name: '' }],
  });
  assert.equal(p.id, '10.1/x', 'the DOI is the citable id when there is one, not the numeric row id');
  assert.equal(p.title, 'Subsoil Compaction: a hidden form', 'whitespace is normalised');
  assert.equal(p.published, '2001');
  assert.deepEqual(p.authors, ['Montanarella, Luca'], 'nameless authors are dropped');
  assert.equal(p.pdfUrl, 'https://core.ac.uk/download/1.pdf');
});

test('a CORE record without a title is not a paper', () => {
  assert.equal(mapCoreRecord({ title: '   ' }), null);
  assert.equal(mapCoreRecord({}), null);
});

test('the link follows the source', () => {
  assert.equal(paperUrl('332640295', 'core'), 'https://core.ac.uk/works/332640295');
  assert.equal(paperUrl('10.1234/x', 'core'), 'https://doi.org/10.1234/x', 'a DOI wins over the source fallback');
});