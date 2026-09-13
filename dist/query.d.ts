export declare const EMBED_DIM = 64;
export declare function extractText(html: string): string;
/** Sentence-aware chunking with overlap: splits on sentence/paragraph
 * boundaries when possible, falls back to hard size cuts. */
export declare function chunkText(text: string, size?: number): string[];
export declare function hashEmbed(text: string): Float32Array;
/** Batched embedding: ARK first, local hash fallback. */
export declare function embedTexts(texts: string[]): Promise<Float32Array[]>;
export declare function cosine(a: Float32Array, b: Float32Array): number;
export interface CorpusDoc {
    url: string;
    chunk: string;
    vec: Float32Array;
}
export declare class CorpusStore {
    private db;
    private insertStmt;
    private selectAllStmt;
    private countStmt;
    private clearStmt;
    constructor(dbPath?: string);
    add(url: string, chunks: string[], vecs: Float32Array[]): number;
    count(): number;
    search(query: Float32Array, topK?: number): {
        url: string;
        chunk: string;
        score: number;
    }[];
    clear(): void;
    close(): void;
}
export declare function getStore(): CorpusStore;
export declare function resetStore(): void;
