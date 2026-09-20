/**
 * opensources.ts — the A-tier of the free-API list: sources that answer with NO credential at all.
 *
 * Each one was probed from this machine before being wired (see .rlab/literature/free-api-sources-
 * verified.md). They are kept as a REGISTRY rather than eight bespoke tools, because the value is
 * coverage and the shape of "search a catalogue, return some records" never changes.
 *
 * Sources that need a login (Semantic Scholar, Kaggle competitions, ModelScope search, Zenodo,
 * Lens, EPO OPS, Springer, PatentsView) are deliberately absent -- not out of caution, but because
 * a tool that silently 401s is worse than no tool.
 */
export type OpenSourceId = 'crossref' | 'europepmc' | 'pubmed' | 'figshare' | 'clinicaltrials' | 'openfda' | 'chembl' | 'openreview';
export interface OpenHit {
    title: string;
    url: string;
    detail: string;
}
export interface OpenResult {
    source: OpenSourceId;
    query: string;
    hits: OpenHit[];
    error?: string;
    note?: string;
}
export declare const OPEN_SOURCES: Record<OpenSourceId, {
    label: string;
    docs: string;
}>;
/** Crossref: message.items[] */
export declare function mapCrossref(it: Record<string, unknown>): OpenHit;
/** Europe PMC: resultList.result[] */
export declare function mapEuropePmc(r: Record<string, unknown>): OpenHit;
/** Figshare: a bare array of articles. */
export declare function mapFigshare(r: Record<string, unknown>): OpenHit;
/** ClinicalTrials.gov v2: studies[] */
export declare function mapClinicalTrial(s: Record<string, unknown>): OpenHit;
/** ChEMBL: molecules[] */
export declare function mapChembl(m: Record<string, unknown>): OpenHit;
/**
 * OpenReview v2 wraps every content field: `{ "title": { "value": "..." } }`, not a bare string.
 * Verified from this machine 2026-09-20: `api2.openreview.net/notes/search?term=&limit=` answers
 * anonymously (a `content.title=` filter 403s instead — that path needs credentials).
 */
export declare function mapOpenReview(n: Record<string, unknown>): OpenHit;
/**
 * A bot-check / HTML interstitial served with HTTP 200.
 *
 * Several catalogues do this, and DBLP is the one we measured: `dblp.org/search/publ/api` answers
 * 200 with an Anubis proof-of-work page ("Making sure you are not a bot") even for a browser
 * User-Agent — so the old single-shot `res.json()` died with `Unexpected token <`, an error that
 * reads like OUR parsing bug rather than "this source is closed to plain clients".
 */
export declare function looksGated(contentType: string, body: string): boolean;
export declare function openSourceSearch(source: OpenSourceId, query: string, limit?: number): Promise<OpenResult>;
