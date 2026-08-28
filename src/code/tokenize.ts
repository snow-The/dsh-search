/**
 * Identifier tokenization: split camelCase/PascalCase/snake_case identifiers
 * into sub-tokens so partial matches work. The original compound token is
 * kept (lowercased) for exact-match boosting. Ported from semble tokens.py.
 */

const CAMEL_RE = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;

export function splitIdentifier(token: string): string[] {
  const lower = token.toLowerCase();
  let parts: string[] = [];
  if (token.includes('_')) {
    parts = lower.split('_').filter(Boolean);
  } else {
    parts = (token.match(CAMEL_RE) ?? []).map((s) => s.toLowerCase());
  }
  if (parts.length >= 2) return [lower, ...parts];
  return [lower];
}

const IDENT_RE = /[a-zA-Z_][a-zA-Z0-9_]*/g;

/** Lowercase identifier-like tokens with compound expansion. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IDENT_RE.lastIndex = 0;
  while ((m = IDENT_RE.exec(text))) out.push(...splitIdentifier(m[0]));
  return out;
}

/** Enrich BM25 content with repo-relative path components (stem x2 + last 3 dirs). */
export function enrichForBM25(content: string, filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  const stem = (parts.pop() ?? '').replace(/\.[^.]+$/, '');
  const dirs = parts.slice(-3).join(' ');
  return content + ' ' + stem + ' ' + stem + ' ' + dirs;
}