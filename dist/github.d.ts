export type GitHubKind = 'repo' | 'code' | 'issue' | 'commit';
export interface GitHubHit {
    kind: GitHubKind;
    title: string;
    url: string;
    detail: string;
    extra?: Record<string, unknown>;
}
/** Token lookup: env first, then credentials file refs, then gh CLI keyring (gh auth token). */
export declare function githubToken(): string;
/** Query one GitHub search endpoint. Returns {hits, total, rateLimited, authRequired}. */
/** Human-readable quota state from GitHub's own headers (remaining / reset / retry-after). */
export declare function rateLimitNote(res: Response): string;
export declare function githubSearch(kind: GitHubKind, q: string, opts?: {
    perPage?: number;
    sort?: string;
    order?: string;
}): Promise<{
    hits: GitHubHit[];
    total: number;
    error?: string;
    note?: string;
}>;
