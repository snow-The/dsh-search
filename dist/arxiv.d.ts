/**
 * arxiv.ts — arXiv API client for dsh-search.
 * Wraps https://export.arxiv.org/api/query (Atom XML) with zero dependencies.
 *
 * Query syntax (arXiv search_query):
 *   field prefixes: all:  ti:  au:  abs:  cat:  (e.g. ti:"drift field")
 *   boolean: AND OR ANDNOT
 *   phrase: "quoted phrase"
 *   examples:
 *     all:"mean-shift" AND all:"representation learning"
 *     au:"Chen" AND cat:cs.LG AND all:embedding
 *     ti:diffusion AND abs:distillation
 */
export interface ArxivPaper {
    id: string;
    title: string;
    published: string;
    updated: string;
    authors: string[];
    categories: string[];
    summary: string;
    pdfUrl: string;
}
export interface ArxivQueryResult {
    query: string;
    papers: ArxivPaper[];
    total?: number;
    error?: string;
    /** Which source actually answered. A fallback result must never look like an arXiv result. */
    source?: 'arxiv' | 'openalex' | 'core';
    note?: string;
}
declare function throttle(): Promise<void>;
/** Retry-After is the server telling us exactly how long to wait; ignoring it is how a soft limit
 *  turns into a block. Values are seconds per RFC 9110 (arXiv sends seconds when it sends it). */
/** Exported for tests: the gate is what keeps the IP unblocked, so it must be verifiable. */
export declare const __arxivInternals: {
    throttle: typeof throttle;
    MIN_GAP_MS: number;
    THROTTLE_FILE: string;
};
export declare function parseRetryAfter(header: string | null): number;
/** Parse Atom feed into papers. Regex-based; the Atom layout is regular enough. */
export declare function parseAtom(xml: string): ArxivPaper[];
export interface ArxivSearchOpts {
    maxResults?: number;
    sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate';
    start?: number;
}
/** Single arXiv query. */
export declare function arxivSearch(query: string, opts?: ArxivSearchOpts): Promise<ArxivQueryResult>;
/**
 * Batch query with arXiv-mandated throttling between calls.
 * Keeps per-query results separate so the caller can group by cluster.
 */
export declare function arxivSearchBatch(queries: string[], opts?: ArxivSearchOpts): Promise<ArxivQueryResult[]>;
/**
 * Build the citable link. The FIRST live fallback run printed https://arxiv.org/abs/10.1145/... —
 * an arXiv URL wrapped around a DOI, i.e. a link that 404s while looking perfectly plausible.
 * The URL must follow the id, not the tool name.
 */
export declare function paperUrl(id: string, source?: string): string;
/** Format papers as compact text (for the search_arxiv tool output). */
export declare function formatPapers(r: ArxivQueryResult, summaryChars?: number): string;
/**
 * Batch output for the tool. A FAILED query must never be reported as "no results": arXiv answers
 * a burst with HTTP 429 and a 14-byte body, and the old caller counted papers across the batch and
 * returned "No results for any query." whenever the count was zero -- throwing away the ERROR line
 * that formatPapers had just built. The distinction between "nothing exists" and "the request
 * failed" is the difference between retrying and giving up on the question.
 */
export declare function formatBatch(results: ArxivQueryResult[], summaryChars?: number): string;
export {};
