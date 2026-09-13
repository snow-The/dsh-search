/**
 * Code-aware reranking signals, ported from semble ranking/{boosting,penalties,weighting}.py.
 * Operates on candidate scores keyed by chunk identity.
 */
import type { Chunk } from './chunker.js';
export declare const RRF_K = 60;
export declare const ALPHA_SYMBOL = 0.3;
export declare const ALPHA_NL = 0.5;
export declare function isSymbolQuery(query: string): boolean;
export declare function resolveAlpha(query: string, alpha?: number): number;
/** Convert raw scores to RRF scores 1/(k + rank). Higher raw -> rank 1. */
export declare function rrfScores(scores: Map<number, number>): Map<number, number>;
export declare function chunkDefinesSymbol(chunk: Chunk, symbolName: string): boolean;
export declare function fileStem(filePath: string): string;
export declare function filePathPenalty(filePath: string): number;
/**
 * Apply reranking to combined scores: definition/stem boosts, file coherence,
 * path penalties, file saturation decay. Returns ranked [chunkIndex, score].
 */
export declare function rerank(combined: Map<number, number>, chunks: Chunk[], topK: number, penalisePaths: boolean): [number, number][];
/**
 * Boost chunks that define the queried symbol: definition match (+3x maxScore,
 * x1.5 more when the file stem matches). Also scans non-candidates whose file
 * stem matches the symbol name (definitions living outside the candidate pool).
 */
export declare function boostSymbolDefinitions(combined: Map<number, number>, query: string, chunks: Chunk[]): void;
