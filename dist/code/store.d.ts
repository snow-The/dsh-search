/**
 * Code-index persistence: JSON manifest/chunks/bm25 + float32 vecs.bin under
 * ~/.dsh/search-index/<sha256(path)>/. Incremental: mtime comparison reuses
 * unchanged files; deleted files drop their postings.
 */
import type { Chunk } from './chunker.js';
import { BM25 } from './bm25.js';
export interface FileManifestEntry {
    mtimeNs: number;
    start: number;
    count: number;
}
export interface IndexData {
    chunks: Chunk[];
    bm25: BM25;
    manifest: Record<string, FileManifestEntry>;
    vectors: Float32Array[] | null;
    embedDim: number;
}
export declare function cacheDirFor(root: string): string;
export declare function makeChunkId(indexedPath: string, slot: number): string;
export declare function loadIndex(root: string): IndexData | null;
export declare function saveIndex(root: string, data: IndexData): void;
export declare function clearIndex(root: string): void;
