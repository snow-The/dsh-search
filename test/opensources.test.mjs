// Every source here answered HTTP 200 with NO credential from this machine, and the live probe
// returned real hits for each. These tests pin the pure mappings so a field rename upstream
// shows up here instead of as a column of "undefined" in a research answer.
//
// Two candidates from a sibling toolkit (microsoft/ResearchStudio) were probed rather than assumed
// (2026-09-20): OpenReview is IN (api2 public notes search, anonymous); DBLP is OUT — its API now
// answers 200 with an Anubis proof-of-work page even to a browser User-Agent, and a source that
// returns a challenge page is exactly the "silently wrong" case this file refuses to ship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCrossref, mapEuropePmc, mapFigshare, mapClinicalTrial, mapChembl, mapOpenReview, looksGated, OPEN_SOURCES } from '../.test-build/opensources.js';

test('the registry covers exactly the verified credential-free sources', () => {
  assert.deepEqual(Object.keys(OPEN_SOURCES).sort(), ['chembl', 'clinicaltrials', 'crossref', 'europepmc', 'figshare', 'openfda', 'openreview', 'pubmed'].sort(), 'the registry IS the verified set: add a source only after probing it from this machine');
});

test('Crossref maps title, DOI link, year, authors and citation count', () => {
  const h = mapCrossref({
    title: ['Context Compaction Provenance'],
    DOI: '10.2139/ssrn.6933161',
    issued: { 'date-parts': [[2026, 7, 29]] },
    author: [{ given: 'Michel', family: 'Hjazeen' }],
    publisher: 'Elsevier BV',
    type: 'posted-content',
    'is-referenced-by-count': 3,
  });
  assert.equal(h.url, 'https://doi.org/10.2139/ssrn.6933161');
  assert.match(h.detail, /2026/);
  assert.match(h.detail, /Michel Hjazeen/);
  assert.match(h.detail, /cited-by 3/);
});

test('OpenReview unwraps the v2 {value} envelope and links the forum', () => {
  const h = mapOpenReview({
    id: 'abc123',
    forum: 'abc123',
    pdate: Date.UTC(2025, 0, 15),
    content: { title: { value: 'Scoop-Check: prior-art collision for novelty claims' }, venue: { value: 'ICLR 2025 Conference Submission' }, decision: { value: 'Reject' } },
  });
  assert.equal(h.title, 'Scoop-Check: prior-art collision for novelty claims');
  assert.equal(h.url, 'https://openreview.net/forum?id=abc123');
  assert.match(h.detail, /ICLR 2025/);
  assert.match(h.detail, /2025/);
  assert.match(h.detail, /Reject/, 'a rejected submission must still be visible - that is the point of this source');
});

test('a bot check is reported as gated, not as a parse error', () => {
  const anubis = '<!doctype html><html><head><title>Making sure you are not a bot!</title>';
  assert.equal(looksGated('text/html; charset=utf-8', anubis), true);
  assert.equal(looksGated('application/json', '{"notes":[]}'), false, 'real JSON is never gated');
  assert.equal(looksGated('', '<html><body>captcha</body></html>'), true);
});

test('Europe PMC prefers the DOI URL and reports open access', () => {
  const h = mapEuropePmc({ id: 'PPR1316832', source: 'PPR', doi: '10.64898/x', title: 'DNA compaction', pubYear: '2026', authorString: 'Nishio T', pubType: 'preprint', isOpenAccess: 'Y', citedByCount: 5 });
  assert.equal(h.url, 'https://doi.org/10.64898/x');
  assert.match(h.detail, /open access/);
  assert.match(h.detail, /cited-by 5/);
});

test('a Europe PMC record with no DOI still gets a resolvable link', () => {
  const h = mapEuropePmc({ id: '123', source: 'MED', title: 'x' });
  assert.equal(h.url, 'https://europepmc.org/article/MED/123');
});

test('ClinicalTrials maps the NCT id into a study URL', () => {
  const h = mapClinicalTrial({ protocolSection: { identificationModule: { nctId: 'NCT05446155', briefTitle: 'BioMEL' }, statusModule: { overallStatus: 'RECRUITING' }, conditionsModule: { conditions: ['Melanoma'] } } });
  assert.equal(h.url, 'https://clinicaltrials.gov/study/NCT05446155');
  assert.match(h.detail, /RECRUITING/);
});

test('Figshare falls back to an article URL when there is no DOI', () => {
  const withDoi = mapFigshare({ id: 1, title: 't', doi: '10.6084/x' });
  assert.equal(withDoi.url, 'https://doi.org/10.6084/x');
  const without = mapFigshare({ id: 42, title: 't' });
  assert.equal(without.url, 'https://figshare.com/articles/42');
});

test('ChEMBL reports molecular properties even when the name is missing', () => {
  const h = mapChembl({ molecule_chembl_id: 'CHEMBL6329', molecule_properties: { full_mwt: '341.75', alogp: '2.11' } });
  assert.equal(h.title, 'CHEMBL6329');
  assert.match(h.detail, /MW 341\.75/);
  assert.match(h.url, /CHEMBL6329/);
});