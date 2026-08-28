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

export const CHUNK_TARGET = 750;
export const CHUNK_OVERLAP = 100;

// Declaration-ish line starts (also matches 'export async function' etc).
const DECL_RE = /^\s*(?:export\s+|declare\s+|async\s+|public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*(?:function|class|interface|struct|enum|trait|type|def|fn|func|impl|module|namespace|package|const|let|var|import|from|using|use|pub|#[a-z_]+)\b/;
const COMMENT_RE = /^\s*(?:\/\/|#|\/\*|\*|--|;|%)/;
const BLANK_RE = /^\s*$/;

/**
 * Split source text into chunks. lineStartOffset lets callers map chunk line
 * numbers back into a larger file when indexing in batches.
 */
export function chunkSource(source: string, filePath: string): Chunk[] {
  const lines = source.split('\n');
  const chunks: Chunk[] = [];
  let start = 0;
  let acc = 0;

  const flush = (end: number) => {
    if (end <= start) return;
    let content = lines.slice(start, end).join('\n');
    // trim leading/trailing blank lines for cleanliness
    while (content.startsWith('\n')) { content = content.slice(1); start++; }
    while (content.endsWith('\n')) content = content.slice(0, -1);
    if (content.trim()) {
      chunks.push({ content, filePath, startLine: start + 1, endLine: end });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlank = BLANK_RE.test(line);
    const isDecl = !isBlank && !COMMENT_RE.test(line) && DECL_RE.test(line) && i > start;
    acc += line.length + 1;
    // cut at declaration boundaries once past the minimum size
    if (isDecl && acc > 200 && acc - (i - start) > 60) {
      flush(i);
      start = i;
      acc = line.length + 1;
      continue;
    }
    // hard size cut with overlap: backtrack to a blank line if possible
    if (acc >= CHUNK_TARGET && i < lines.length - 1) {
      let cut = i;
      for (let j = i; j > Math.max(start, i - 8); j--) {
        if (BLANK_RE.test(lines[j])) { cut = j; break; }
      }
      if (cut === i) cut = Math.max(start + 1, i);
      flush(cut);
      // overlap: restart a bit before the cut so context is not lost
      let back = 0;
      let backChars = 0;
      for (let j = cut - 1; j > start && backChars < CHUNK_OVERLAP; j--) {
        backChars += lines[j].length + 1;
        back++;
      }
      start = Math.max(start, cut - back);
      acc = 0;
      for (let j = start; j <= cut; j++) acc += lines[j].length + 1;
      continue;
    }
  }
  flush(lines.length);
  return chunks;
}