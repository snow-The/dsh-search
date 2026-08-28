/**
 * Code-aware reranking signals, ported from semble ranking/{boosting,penalties,weighting}.py.
 * Operates on candidate scores keyed by chunk identity.
 */

import type { Chunk } from './chunker.js';

export const RRF_K = 60;
export const ALPHA_SYMBOL = 0.3;
export const ALPHA_NL = 0.5;

const SYMBOL_QUERY_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.|->)[A-Za-z_][A-Za-z0-9_]*)+|_[A-Za-z0-9_]*|[A-Za-z][A-Za-z0-9]*[A-Z_][A-Za-z0-9_]*|[A-Z][A-Za-z0-9]*)$/;

export function isSymbolQuery(query: string): boolean {
  return SYMBOL_QUERY_RE.test(query.trim());
}

export function resolveAlpha(query: string, alpha?: number): number {
  if (alpha !== undefined) return alpha;
  return isSymbolQuery(query) ? ALPHA_SYMBOL : ALPHA_NL;
}

/** Convert raw scores to RRF scores 1/(k + rank). Higher raw -> rank 1. */
export function rrfScores(scores: Map<number, number>): Map<number, number> {
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const out = new Map<number, number>();
  ranked.forEach(([id], rank) => out.set(id, 1 / (RRF_K + rank + 1)));
  return out;
}

// Definition keywords (case-sensitive; IGNORECASE would false-positive on Module/Class).
const DEF_KEYWORDS = ['class','module','defmodule','def','interface','struct','enum','trait','type','func','function','object','abstract class','data class','fn','fun','package','namespace','protocol','record','typedef'];
const SQL_KEYWORDS = ['create table','create view','create procedure','create function'];
const DEF_BOOST = 3.0;
const STEM_BOOST = 1.0;
const FILE_COHERENCE_FRAC = 0.2;
const EMBEDDED_BOOST_SCALE = 0.5;

function definitionPattern(name: string): RegExp {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|(?<=\\s))(?:(?:' + DEF_KEYWORDS.join('|') + ')\\s+(?:[A-Za-z_][A-Za-z0-9_]*(?:\\.|::))*' + esc + '(?:\\s|[<({:\\[;]|$))', 'm');
}

function sqlPattern(name: string): RegExp {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|(?<=\\s))(?:(?:' + SQL_KEYWORDS.join('|') + ')\\s+(?:[A-Za-z_][A-Za-z0-9_]*(?:\\.|::))*' + esc + '(?:\\s|[<({:\\[;]|$))', 'im');
}

export function chunkDefinesSymbol(chunk: Chunk, symbolName: string): boolean {
  return definitionPattern(symbolName).test(chunk.content) || sqlPattern(symbolName).test(chunk.content);
}

function stemMatches(stem: string, name: string): boolean {
  const norm = stem.replace(/_/g, '');
  return stem === name || norm === name || stem.replace(/s$/, '') === name || norm.replace(/s$/, '') === name;
}

export function fileStem(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.[^.]+$/, '').toLowerCase();
}

// ---- path penalties (penalties.py) ----
const TEST_FILE_RE = /(?:^|\/)(?:test_[^/]*\.py|[^/]*_test\.py|[^/]*_test\.go|[^/]*Tests?\.java|[^/]*Test\.php|[^/]*_spec\.rb|[^/]*_test\.rb|[^/]*\.test\.[jt]sx?|[^/]*\.spec\.[jt]sx?|[^/]*Tests?\.kt|[^/]*Spec\.kt|[^/]*Tests?\.swift|[^/]*Spec\.swift|[^/]*Tests?\.cs|[^/]*_test\.cpp|[^/]*_test\.c|[^/]*Spec\.scala|[^/]*Test\.scala|[^/]*_test\.dart|test_helpers?[^/]*\.\w+)$/;
const TEST_DIR_RE = /(?:^|\/)(?:tests?|__tests__|spec|testing)(?:\/|$)/;
const COMPAT_DIR_RE = /(?:^|\/)(?:compat|_compat|legacy)(?:\/|$)/;
const EXAMPLES_DIR_RE = /(?:^|\/)(?:_?examples?|docs?_src)(?:\/|$)/;
const TYPE_DEFS_RE = /\.d\.ts$/;
const REEXPORT = new Set(['__init__.py', 'package-info.java']);
const STRONG = 0.3, MODERATE = 0.5, MILD = 0.7;

export function filePathPenalty(filePath: string): number {
  const p = filePath.replace(/\\/g, '/');
  let penalty = 1;
  if (TEST_FILE_RE.test(p) || TEST_DIR_RE.test(p)) penalty *= STRONG;
  if (REEXPORT.has(filePath.split(/[\\/]/).pop() ?? '')) penalty *= MODERATE;
  if (COMPAT_DIR_RE.test(p)) penalty *= STRONG;
  if (EXAMPLES_DIR_RE.test(p)) penalty *= STRONG;
  if (TYPE_DEFS_RE.test(p)) penalty *= MILD;
  return penalty;
}

/**
 * Apply reranking to combined scores: definition/stem boosts, file coherence,
 * path penalties, file saturation decay. Returns ranked [chunkIndex, score].
 */
export function rerank(combined: Map<number, number>, chunks: Chunk[], topK: number, penalisePaths: boolean): [number, number][] {
  if (!combined.size) return [];
  const maxScore = Math.max(...combined.values());
  if (maxScore <= 0) return [];

  // file coherence: boost each file's top chunk by frac * fileSum/maxFileSum
  const fileSum = new Map<string, number>();
  const bestChunk = new Map<string, number>();
  for (const [id, score] of combined) {
    const fp = chunks[id].filePath;
    fileSum.set(fp, (fileSum.get(fp) ?? 0) + score);
    if (!bestChunk.has(fp) || score > (combined.get(bestChunk.get(fp)!) ?? 0)) bestChunk.set(fp, id);
  }
  const maxFileSum = Math.max(...fileSum.values());
  const boostUnit = maxScore * FILE_COHERENCE_FRAC;
  for (const [fp, id] of bestChunk) {
    combined.set(id, (combined.get(id) ?? 0) + boostUnit * (fileSum.get(fp) ?? 0) / maxFileSum);
  }

  // path penalties + saturation, greedy selection
  const penaltyCache = new Map<string, number>();
  const scored: [number, number][] = [];
  for (const [id, score] of combined) {
    const fp = chunks[id].filePath;
    let pen = 1;
    if (penalisePaths) {
      pen = penaltyCache.get(fp) ?? filePathPenalty(fp);
      penaltyCache.set(fp, pen);
    }
    scored.push([id, score * pen]);
  }
  scored.sort((a, b) => b[1] - a[1]);

  const fileSelected = new Map<string, number>();
  const selected: [number, number][] = [];
  for (const [id, score] of scored) {
    const fp = chunks[id].filePath;
    const already = fileSelected.get(fp) ?? 0;
    let eff = score;
    if (already >= 1) eff *= Math.pow(0.5, already);
    selected.push([id, eff]);
    fileSelected.set(fp, already + 1);
    if (selected.length >= topK) break;
  }
  selected.sort((a, b) => b[1] - a[1]);
  return selected;
}

/**
 * Boost chunks that define the queried symbol: definition match (+3x maxScore,
 * x1.5 more when the file stem matches). Also scans non-candidates whose file
 * stem matches the symbol name (definitions living outside the candidate pool).
 */
export function boostSymbolDefinitions(combined: Map<number, number>, query: string, chunks: Chunk[]): void {
  const name = query.split(/::|\\.|->/).pop()?.trim() ?? query.trim();
  const names = new Set([name, query.trim()]);
  const maxScore = Math.max(...combined.values());
  const unit = maxScore * DEF_BOOST;
  for (const [id] of combined) {
    const c = chunks[id];
    if (![...names].some((n) => chunkDefinesSymbol(c, n))) continue;
    const stem = fileStem(c.filePath);
    const tier = unit * ([...names].some((n) => stemMatches(stem, n.toLowerCase())) ? 1.5 : 1);
    combined.set(id, (combined.get(id) ?? 0) + tier);
  }
  // non-candidate scan: file stem matches symbol -> pull definitions into results
  for (let id = 0; id < chunks.length; id++) {
    if (combined.has(id)) continue;
    const stem = fileStem(chunks[id].filePath);
    if (![...names].some((n) => stemMatches(stem, n.toLowerCase()))) continue;
    if ([...names].some((n) => chunkDefinesSymbol(chunks[id], n))) {
      combined.set(id, unit);
    }
  }
}