/**
 * Identifier tokenization: split camelCase/PascalCase/snake_case identifiers
 * into sub-tokens so partial matches work. The original compound token is
 * kept (lowercased) for exact-match boosting. Ported from semble tokens.py.
 */
export declare function splitIdentifier(token: string): string[];
/** Lowercase identifier-like tokens with compound expansion. */
export declare function tokenize(text: string): string[];
/** Enrich BM25 content with repo-relative path components (stem x2 + last 3 dirs). */
export declare function enrichForBM25(content: string, filePath: string): string;
