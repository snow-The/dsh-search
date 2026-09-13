// Measured: HuggingFace /api/models, /api/datasets and Kaggle /api/v1/datasets/list all answer
// with NO credential (Kaggle competitions return 401 -- that is the auth'd half).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanBytes, humanCount, mapKaggleDataset, mapHfModel, relaxQuery } from '../.test-build/hubs.js';

test('sizes are human-scaled, because a 40 GB mistake must be visible before the download', () => {
  assert.equal(humanBytes(1081206403), '1.0 GB');
  assert.equal(humanBytes(512), '512 B');
  assert.equal(humanBytes(2048), '2.0 KB');
  assert.equal(humanBytes(null), '?');
});

test('counts are compact but never invented', () => {
  assert.equal(humanCount(37590799), '37.6M');
  assert.equal(humanCount(3497), '3.5k');
  assert.equal(humanCount(0), '0');
  assert.equal(humanCount(undefined), '0');
});

test('a Kaggle dataset maps with ref, size, downloads and the real URL', () => {
  const h = mapKaggleDataset({
    ref: 'henriupton/protbert-embeddings-for-cafa5',
    title: 'ProtBERT Embeddings for CAFA5',
    subtitle: 'ProtBERT Vector Embeddings for Protein Sequences',
    creatorName: 'Henri Upton',
    totalBytes: 1081206403,
    downloadCount: 1200,
    voteCount: 56,
    url: 'https://www.kaggle.com/datasets/henriupton/protbert-embeddings-for-cafa5',
  });
  assert.equal(h.id, 'henriupton/protbert-embeddings-for-cafa5');
  assert.match(h.title, /ProtBERT Embeddings for CAFA5 — ProtBERT Vector/);
  assert.match(h.detail, /1\.0 GB/);
  assert.match(h.detail, /downloads 1\.2k/);
  assert.match(h.url, /^https:\/\/www\.kaggle\.com\/datasets\//);
});

// Measured: 'bge' -> 3 hits, 'bge embedding' -> 3 hits, 'bge embedding zh' -> 0 (AND semantics).
test('a zero-hit multi-word query is relaxed, and the retry is LABELLED', () => {
  assert.equal(relaxQuery('bge embedding zh'), 'bge embedding');
  assert.equal(relaxQuery('bge embedding'), null, 'two terms are not relaxed: a small result set is a real answer');
  assert.equal(relaxQuery('bge'), null);
  assert.equal(relaxQuery('   '), null);
});

test('a HuggingFace model maps with its download count and pipeline tag', () => {
  const h = mapHfModel({ id: 'BAAI/bge-m3', downloads: 37590799, likes: 3497, pipeline_tag: 'sentence-similarity', tags: ['sentence-transformers', 'license:mit'] });
  assert.equal(h.url, 'https://huggingface.co/BAAI/bge-m3');
  assert.match(h.detail, /downloads 37\.6M/);
  assert.match(h.detail, /sentence-similarity/);
  assert.ok(!h.detail.includes('license:mit'), 'tag keys are dropped, only tag values are shown');
});