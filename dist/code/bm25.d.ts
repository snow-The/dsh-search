/**
 * BM25 inverted index with incremental document updates. Ported from semble
 * index/bm25.py (K1=1.5, B=0.75). Chunk ids are 'path:slot'.
 */
export declare class BM25 {
    private docs;
    private lengths;
    private totalLen;
    private postings;
    private positions;
    docOrder: string[];
    addDocument(id: string, tokens: string[]): void;
    removeDocument(id: string): void;
    setDocOrder(ids: string[]): void;
    getScores(tokens: string[], mask?: boolean[]): Float32Array;
    serialize(): {
        docs: [string, [string, number][]][];
        order: string[];
    };
    static deserialize(data: {
        docs: [string, [string, number][]][];
        order: string[];
    }): BM25;
}
