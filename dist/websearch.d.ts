export declare const SEARCH_ENGINES: readonly ['bing', 'ddg', 'ddg-lite', 'searxng', 'exa', 'tavily'];
export type SearchEngine = (typeof SEARCH_ENGINES)[number];
export interface SearchHit {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}
export interface WebSearchOut {
    sources: SearchHit[];
    content?: string;
    engine: string;
    note?: string;
}
export interface SearchRequest {
    query: string;
    maxResults?: number;
    /** explicit engine override (platform_search only) */
    engine?: string;
    /** time filter: "day" | "week" | "month" | "year" or {days} or raw string like "1w" */
    timeRange?: unknown;
    cache?: boolean;
    cacheTtl?: number;
}
export interface SearchConfig {
    provider?: string;
    searxngInstances?: string[];
    bingMarket?: string;
    region?: string;
    safeSearch?: 'off' | 'moderate' | 'strict';
    cache?: boolean;
    cacheTtl?: number;
}
/**
 * A result set that shares NO token with the query is answering a different question.
 * This is the "results from another context" failure: the engine's parser returns the
 * right-looking topic and silently ignores the distinctive token, so the caller gets
 * plausible junk instead of an error. Fail loudly instead; the chain moves on.
 */
/** A site root is a directory listing, not an answer. https://arxiv.org/ answers nothing. */
export declare function isNavigational(url: string): boolean;
export declare function looksOffTopic(query: string, hits: SearchHit[]): boolean;
/**
 * Run one search with fallback chain. Returns normalized result + which engine served it.
 */
export declare function runSearchChain(req: SearchRequest, cfg: SearchConfig, signal?: AbortSignal): Promise<WebSearchOut>;
/**
 * The WebSearchProvider registered on ctx.web.
 * Accepts the official WebSearchRequest (query/maxResults) plus optional
 * extensions (engine/timeRange/cache) passed through by the seam.
 */
export declare function createWebSearchProvider(cfg: () => SearchConfig): {
    id: string;
    available(): boolean;
    search(request: SearchRequest, signal?: AbortSignal): Promise<{
        content?: string;
        sources: SearchHit[];
        truncated: boolean;
    }>;
};
/** platform_search tool: explicit engine control + time filtering + engine notes. */
export declare function registerPlatformSearchTool(ctx: any, cfg: () => SearchConfig): void;
/** Register the ctx.web search provider; takes over when none configured. */
export declare function registerWebProvider(ctx: any, cfg: () => SearchConfig): void;
