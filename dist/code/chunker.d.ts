/**
 * Code-aware chunking without a parser: splits on declaration boundaries
 * (top-level function/class/def/...) and blank lines, with hard size cuts
 * and line-based fallback. Target ~750 chars like semble; keeps start/end
 * line numbers so results carry precise locations.
 */
export interface Chunk {
    content: string;
    filePath: string;
    startLine: number;
    endLine: number;
}
export declare const CHUNK_TARGET = 750;
export declare const CHUNK_OVERLAP = 100;
/**
 * Split source text into chunks. lineStartOffset lets callers map chunk line
 * numbers back into a larger file when indexing in batches.
 */
export declare function chunkSource(source: string, filePath: string): Chunk[];
