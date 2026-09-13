/** File walking: extension allowlist, default-ignored dirs, 1MB cap. */
export declare const MAX_FILE_BYTES = 1000000;
export interface IndexedFile {
    path: string;
    source: string;
}
/** Walk root recursively; returns repo-relative paths with source text. */
export declare function walkFiles(root: string, maxBytes?: number): IndexedFile[];
