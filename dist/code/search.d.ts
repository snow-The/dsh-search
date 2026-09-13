/**
 * search_code core: hybrid lexical search (BM25 + identifier tokens + rerank)
 * with optional semantic layer (ARK embeddings when ARK_API_KEY is present,
 * local 64-dim hash fallback otherwise). Builds a cached incremental index
 * under ~/.dsh/search-index/. Ported from semble (BM25+RRF+rerank) and khoj
 * (filter syntax).
 */
import { type IndexData } from './store.js';
export interface SearchCodeOptions {
    path: string;
    query: string;
    topK?: number;
    maxSnippetLines?: number;
    filter?: string;
    rebuild?: boolean;
}
export interface CodeHit {
    filePath: string;
    startLine: number;
    endLine: number;
    score: number;
    content: string;
}
/**
 * Ensure an up-to-date in-memory index for root. Incremental: files whose
 * mtime is unchanged keep their chunks/embeddings; changed files are
 * re-chunked and re-embedded; deleted files drop their postings.
 */
export declare function ensureIndex(root: string, rebuild?: boolean): Promise<IndexData>;
export declare function searchCode(opts: SearchCodeOptions): Promise<CodeHit[]>;
