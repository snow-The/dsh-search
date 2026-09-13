/**
 * core.ts — second fallback paper source (CORE, https://core.ac.uk).
 *
 * Verified from this machine: HTTP 200 with NO key, ~2.6e8 open-access documents, abstracts and a
 * direct download URL included. It sits BEHIND OpenAlex on purpose: CORE is a full-text index and
 * its relevance is loose (a query about "context compaction in language models" returned a soil-
 * science paper about subsoil compaction). Breadth is worth having; precision comes first.
 */
import type { ArxivPaper, ArxivQueryResult } from './arxiv.js';
interface CoreRecord {
    id?: number | string;
    title?: string | null;
    abstract?: string | null;
    yearPublished?: number | null;
    doi?: string | null;
    arxivId?: string | null;
    downloadUrl?: string | null;
    authors?: {
        name?: string;
    }[] | null;
}
/** Pure mapping so it can be tested without the network. */
export declare function mapCoreRecord(r: CoreRecord): ArxivPaper | null;
export declare function coreSearch(query: string, opts?: {
    maxResults?: number;
}): Promise<ArxivQueryResult>;
export {};
