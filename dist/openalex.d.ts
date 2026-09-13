/**
 * openalex.ts — fallback paper source for dsh-search.
 *
 * Why it exists: arXiv's API answers a burst with HTTP 429 and then, if you keep asking, simply
 * stops answering — every host (export.arxiv.org, arxiv.org/api, http) timed out at 15s from this
 * machine while arxiv.org/abs/<id> HTML kept loading in 229ms. A paper tool that only knows how to
 * fail is not a tool. OpenAlex is free, needs no key, and answered the same query in 1.3s.
 *
 * Mapped into the same ArxivPaper shape so callers and formatters stay unchanged.
 */
import type { ArxivQueryResult } from './arxiv.js';
interface OpenAlexWork {
    id?: string;
    doi?: string | null;
    title?: string | null;
    publication_year?: number | null;
    authorships?: {
        author?: {
            display_name?: string;
        };
    }[];
    abstract_inverted_index?: Record<string, number[]> | null;
    ids?: Record<string, string> | null;
}
/** OpenAlex stores abstracts as an inverted index (word -> positions). Rebuild it in order. */
export declare function rebuildAbstract(inv: Record<string, number[]> | null | undefined, maxChars?: number): string;
/** A stable, citable id: the arXiv id when the work has one, else the DOI, else the OpenAlex id. */
export declare function workId(w: OpenAlexWork): string;
export declare function openAlexSearch(query: string, opts?: {
    maxResults?: number;
}): Promise<ArxivQueryResult>;
export {};
