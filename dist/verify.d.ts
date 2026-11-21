/**
 * verify.ts — link verification for search results.
 *
 * Why this exists: `web_search` returns citeable sources, but a source is a claim, not a
 * fact. Measured on this host, the same query returned SEO farms, dead links, and pages
 * behind a login. A caller that cites them without checking is repeating a guess.
 *
 * What it checks, per URL, with ONE request each:
 *   - reachable: the HTTP status, and whether it is a 2xx
 *   - finalUrl:  where redirects landed (a farm that redirects to a paywall is not the farm)
 *   - kind:      html | text | binary, from content-type
 *   - authWall:  401/403 — the page exists but needs a credential
 *   - farm:      a known content-mill domain (the user's original complaint)
 *   - primary:   a known primary source (docs, repo, paper)
 *
 * It does NOT fetch the body by default: verification is about whether the link is worth
 * opening, and downloading every page to answer that is the expensive way to be wrong.
 * `read: true` opts into the body, bounded.
 *
 * This is deliberately NOT a `ctx.web` fetch provider. The seam's `WebFetchRequest` carries
 * only a URL (anonymous by design), so a provider cannot send a token; and `WebFetchBody` is
 * a closed union owned by `dsh-web`. Verification is a different question from retrieval, so
 * it lives here rather than bending the official seam.
 */
export interface VerifyOptions {
    /** Read the body too, bounded. Default false: verification is not retrieval. */
    read?: boolean;
    /** Per-URL timeout in ms. Default 12000. */
    timeoutMs?: number;
    /** Max body characters kept when `read` is true. Default 2000. */
    maxChars?: number;
}
export interface VerifiedLink {
    url: string;
    ok: boolean;
    status: number;
    finalUrl: string;
    kind: 'html' | 'text' | 'binary' | 'unknown';
    /** 401/403: the page exists but the request needs a credential. */
    authWall: boolean;
    /** A known content mill. */
    farm: boolean;
    /** A known primary source. */
    primary: boolean;
    /** Milliseconds spent on this URL. */
    ms: number;
    /** Present only when `read` was requested. */
    title?: string;
    excerpt?: string;
    /** Why it failed, when it did. */
    error?: string;
}
/**
 * Verify one URL. Never throws: a failure is a result, because the caller is asking
 * "is this link usable", and "it is not" is an answer.
 */
export declare function verifyOne(url: string, opts?: VerifyOptions): Promise<VerifiedLink>;
/**
 * Verify several URLs with bounded concurrency. Sequential verification of 20 links at a
 * 12s timeout is 4 minutes; the caller asked a question, not for a timeout budget.
 */
export declare function verifyMany(urls: string[], opts?: VerifyOptions, concurrency?: number): Promise<VerifiedLink[]>;
/** One-line verdict for a set, so a caller can decide without reading every row. */
export declare function summarize(links: VerifiedLink[]): {
    total: number;
    ok: number;
    dead: number;
    authWall: number;
    farm: number;
    primary: number;
    /** True when nothing usable came back: the caller must not cite this set. */
    unusable: boolean;
};
