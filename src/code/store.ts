/**
 * Code-index persistence: JSON manifest/chunks/bm25 + float32 vecs.bin under
 * ~/.dsh/search-index/<sha256(path)>/. Incremental: mtime comparison reuses
 * unchanged files; deleted files drop their postings.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Chunk } from './chunker.js';
import { BM25 } from './bm25.js';

export interface FileManifestEntry { mtimeNs: number; start: number; count: number }
export interface IndexData {
  chunks: Chunk[];
  bm25: BM25;
  manifest: Record<string, FileManifestEntry>;
  vectors: Float32Array[] | null;
  embedDim: number;
}

export function cacheDirFor(root: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 20);
  return join(homedir(), '.dsh', 'search-index', hash);
}

export function makeChunkId(indexedPath: string, slot: number): string {
  return indexedPath + ':' + slot;
}

export function loadIndex(root: string): IndexData | null {
  const dir = cacheDirFor(root);
  const metaPath = join(dir, 'metadata.json');
  const chunksPath = join(dir, 'chunks.json');
  const bmPath = join(dir, 'bm25.json');
  if (!existsSync(metaPath) || !existsSync(chunksPath) || !existsSync(bmPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { root: string; manifest: Record<string, FileManifestEntry>; embedDim: number };
    if (meta.root !== root) return null;
    const chunks = JSON.parse(readFileSync(chunksPath, 'utf8')) as Chunk[];
    const bm25 = BM25.deserialize(JSON.parse(readFileSync(bmPath, 'utf8')));
    let vectors: Float32Array[] | null = null;
    if (meta.embedDim > 0) {
      const vecPath = join(dir, 'vecs.bin');
      if (existsSync(vecPath)) {
        const buf = readFileSync(vecPath);
        const dim = meta.embedDim;
        vectors = [];
        for (let i = 0; i < buf.length / 4 / dim; i++) {
          vectors.push(new Float32Array(buf.buffer, buf.byteOffset + i * dim * 4, dim).slice());
        }
      }
    }
    return { chunks, bm25, manifest: meta.manifest, vectors, embedDim: meta.embedDim };
  } catch {
    return null;
  }
}

export function saveIndex(root: string, data: IndexData): void {
  const dir = cacheDirFor(root);
  mkdirSync(dir, { recursive: true });
  const meta = { root, manifest: data.manifest, embedDim: data.vectors ? data.vectors[0]?.length ?? 0 : 0 };
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(meta), 'utf8');
  writeFileSync(join(dir, 'chunks.json'), JSON.stringify(data.chunks), 'utf8');
  writeFileSync(join(dir, 'bm25.json'), JSON.stringify(data.bm25.serialize()), 'utf8');
  if (data.vectors && data.vectors.length) {
    const dim = data.vectors[0].length;
    const buf = Buffer.alloc(data.vectors.length * dim * 4);
    data.vectors.forEach((v, i) => buf.set(Buffer.from(v.buffer, v.byteOffset, v.byteLength), i * dim * 4));
    writeFileSync(join(dir, 'vecs.bin'), buf);
  }
}

export function clearIndex(root: string): void {
  const dir = cacheDirFor(root);
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* noop */ }
}