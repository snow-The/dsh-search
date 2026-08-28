/**
 * search_code core: hybrid lexical search (BM25 + identifier tokens + rerank)
 * with optional semantic layer (ARK embeddings when ARK_API_KEY is present,
 * local 64-dim hash fallback otherwise). Builds a cached incremental index
 * under ~/.dsh/search-index/. Ported from semble (BM25+RRF+rerank) and khoj
 * (filter syntax).
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from './walk.js';
import { chunkSource, type Chunk } from './chunker.js';
import { tokenize, enrichForBM25 } from './tokenize.js';
import { BM25 } from './bm25.js';
import {
  rrfScores, resolveAlpha, isSymbolQuery, rerank, boostSymbolDefinitions, filePathPenalty,
} from './ranking.js';
import { loadIndex, saveIndex, makeChunkId, type IndexData, type FileManifestEntry } from './store.js';
import { embedTexts, cosine, hashEmbed } from '../query.js';

export interface SearchCodeOptions {
  path: string;
  query: string;
  topK?: number;
  maxSnippetLines?: number;
  filter?: string;
  rebuild?: boolean;
}

export interface CodeHit { filePath: string; startLine: number; endLine: number; score: number; content: string }

// ---- khoj-style filter syntax: +"word" required, -"word" excluded, file:"glob" ----
const REQ_RE = /\+"([a-zA-Z0-9_-]+)"/g;
const BLOCK_RE = /-"([a-zA-Z0-9_-]+)"/g;
const FILE_RE = /file:"([^"]+)"/g;

function parseFilters(filter: string): { required: string[]; blocked: string[]; files: string[]; cleaned: string } {
  const required: string[] = [];
  const blocked: string[] = [];
  const files: string[] = [];
  let cleaned = filter;
  let m: RegExpExecArray | null;
  REQ_RE.lastIndex = 0;
  while ((m = REQ_RE.exec(filter))) { required.push(m[1]); cleaned = cleaned.replace(m[0], ''); }
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(filter))) { blocked.push(m[1]); cleaned = cleaned.replace(m[0], ''); }
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(filter))) { files.push(m[1]); cleaned = cleaned.replace(m[0], ''); }
  return { required, blocked, files, cleaned: cleaned.trim() };
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$');
}

/**
 * Ensure an up-to-date in-memory index for root. Incremental: files whose
 * mtime is unchanged keep their chunks/embeddings; changed files are
 * re-chunked and re-embedded; deleted files drop their postings.
 */
export async function ensureIndex(root: string, rebuild = false): Promise<IndexData> {
  const cached = rebuild ? null : loadIndex(root);
  const bm25 = cached ? cached.bm25 : new BM25();
  const chunks: Chunk[] = cached ? [...cached.chunks] : [];
  const manifest: Record<string, FileManifestEntry> = cached ? { ...cached.manifest } : {};
  let vectors: Float32Array[] | null = cached?.vectors ? [...cached.vectors] : null;

  const files = walkFiles(root);
  const seen = new Set<string>();
  const changed: { path: string; source: string }[] = [];
  for (const f of files) {
    seen.add(f.path);
    let mtimeNs = 0;
    try { mtimeNs = Math.round(statSync(join(root, f.path)).mtimeMs * 1e6); } catch { /* deleted */ }
    const prev = manifest[f.path];
    if (!prev || prev.mtimeNs !== mtimeNs) changed.push(f);
  }

  if (!changed.length && cached) return cached;

  // drop files no longer present
  for (const path of Object.keys(manifest)) {
    if (seen.has(path)) continue;
    const entry = manifest[path];
    for (let slot = 0; slot < entry.count; slot++) bm25.removeDocument(makeChunkId(path, slot));
    delete manifest[path];
  }

  // re-chunk changed files: remove old postings, add new ones
  const newChunks: Chunk[] = [];
  const newVecs: Float32Array[] = [];
  for (const f of changed) {
    const prev = manifest[f.path];
    if (prev) {
      for (let slot = 0; slot < prev.count; slot++) bm25.removeDocument(makeChunkId(f.path, slot));
    }
    const fileChunks = chunkSource(f.source, f.path);
    if (!fileChunks.length) { delete manifest[f.path]; continue; }
    const start = chunks.length + newChunks.length;
    for (let slot = 0; slot < fileChunks.length; slot++) {
      const c = fileChunks[slot];
      bm25.addDocument(makeChunkId(f.path, slot), tokenize(enrichForBM25(c.content, f.path)));
      newChunks.push(c);
    }
    let mtimeNs = 0;
    try { mtimeNs = Math.round(statSync(join(root, f.path)).mtimeMs * 1e6); } catch { mtimeNs = Date.now() * 1e6; }
    manifest[f.path] = { mtimeNs, start, count: fileChunks.length };
  }

  // embed only the new chunks (ARK if key present, hash otherwise)
  if (newChunks.length) {
    const embedded = await embedTexts(newChunks.map((c) => c.content));
    newVecs.push(...embedded);
    if (vectors) vectors.push(...embedded);
    else vectors = embedded;
  }
  chunks.push(...newChunks);
  bm25.setDocOrder(chunks.map((c, i) => makeChunkId(c.filePath, i)));

  const data: IndexData = { chunks, bm25, manifest, vectors, embedDim: vectors?.[0]?.length ?? 0 };
  saveIndex(root, data);
  return data;
}

export async function searchCode(opts: SearchCodeOptions): Promise<CodeHit[]> {
  const topK = Math.min(Math.max(opts.topK ?? 10, 1), 30);
  const index = await ensureIndex(opts.path, opts.rebuild);
  const { chunks, bm25, vectors } = index;
  if (!chunks.length) return [];

  // filter parsing
  let required: string[] = [];
  let blocked: string[] = [];
  let fileRegexes: RegExp[] = [];
  let query = opts.query;
  if (opts.filter) {
    const f = parseFilters(opts.filter);
    required = f.required;
    blocked = f.blocked;
    fileRegexes = f.files.map(globToRegex);
    query = (query + ' ' + f.cleaned).trim();
  }

  // candidate mask: file filter + required/blocked words
  const mask = new Array<boolean>(chunks.length).fill(true);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (fileRegexes.length && !fileRegexes.some((re) => re.test(c.filePath))) mask[i] = false;
    if (blocked.length && blocked.some((w) => c.content.toLowerCase().includes(w))) mask[i] = false;
    if (required.length && !required.every((w) => c.content.toLowerCase().includes(w))) mask[i] = false;
  }

  // BM25 lexical scores (identifier tokens, path-enriched)
  const bm25Scores = bm25.getScores(tokenize(query), mask);
  const lexical = new Map<number, number>();
  for (let i = 0; i < bm25Scores.length; i++) if (bm25Scores[i] > 0) lexical.set(i, bm25Scores[i]);

  // optional semantic scores (ARK when key present, hash fallback)
  const semantic = new Map<number, number>();
  if (vectors && vectors.length && vectors[0].length > 64) {
    const qv = (await embedTexts([query]))[0];
    for (let i = 0; i < vectors.length; i++) {
      if (!mask[i]) continue;
      const s = cosine(qv, vectors[i]);
      if (s > 0.3) semantic.set(i, s);
    }
  } else if (vectors && vectors.length) {
    // local hash vectors: still useful as a weak semantic signal
    const qv = hashEmbed(query);
    for (let i = 0; i < vectors.length; i++) {
      if (!mask[i]) continue;
      const s = cosine(qv, vectors[i]);
      if (s > 0.25) semantic.set(i, s);
    }
  }

  const alpha = resolveAlpha(query);
  const rrfLex = rrfScores(lexical);
  const rrfSem = rrfScores(semantic);
  const combined = new Map<number, number>();
  const ids = new Set([...rrfLex.keys(), ...rrfSem.keys()]);
  for (const id of ids) {
    const s = alpha * (rrfSem.get(id) ?? 0) + (1 - alpha) * (rrfLex.get(id) ?? 0);
    if (s > 0) combined.set(id, s);
  }

  // symbol queries: boost definition chunks
  if (isSymbolQuery(query) && combined.size) boostSymbolDefinitions(combined, query, chunks);

  const ranked = rerank(combined, chunks, topK * 3, alpha < 1);
  const hits: CodeHit[] = [];
  for (const [id, score] of ranked.slice(0, topK)) {
    const c = chunks[id];
    hits.push({ filePath: c.filePath, startLine: c.startLine, endLine: c.endLine, score, content: c.content });
  }
  return hits;
}