export interface FeedItem {
    title: string;
    link: string;
    description: string;
    date?: string;
    id?: string;
}
export declare function parseFeed(xml: string): FeedItem[];
export declare function normalizeUrl(raw: string): string;
export declare class SeenCache {
    private db;
    constructor(dir?: string);
    /** true if the URL was already mined */
    seen(url: string): boolean;
    mark(url: string): void;
    clear(): void;
    close(): void;
}
export declare function rsshubBase(): string;
/**
 * Fetch a feed (RSS/Atom) from a URL — either a raw feed URL or an RSSHub route.
 * A bare route like 'reddit/user/DIYgod' is prefixed with the RSSHub base.
 */
export declare function fetchFeed(feedUrl: string, limit?: number): Promise<{
    source: string;
    items: FeedItem[];
}>;
/**
 * Discover the feed URL of a site by scanning its HTML for <link rel=alternate type=application/rss+xml>.
 */
export declare function discoverFeed(siteUrl: string): Promise<string | null>;
export declare function redditSearch(q: string, subreddit?: string, limit?: number): Promise<FeedItem[]>;
export declare function hnSearch(q: string, limit?: number): Promise<FeedItem[]>;
export declare function sitemapUrls(sitemapUrl: string, max?: number): Promise<string[]>;
export interface ForumSpec {
    name: string;
    searchUrl: (base: string, q: string) => string;
    resultSel: RegExp;
}
/**
 * Probe a forum for search results via platform-specific search endpoints.
 * Returns mined thread links — the caller decides what to fetch.
 */
export declare function probeForum(baseUrl: string, q: string): Promise<{
    platform: string;
    links: string[];
}>;
export declare function disqusRecent(forum: string, limit?: number): Promise<FeedItem[]>;
export declare function relatedSearches(q: string): Promise<string[]>;
export interface ProbeSource {
    kind: string;
    label: string;
    items: FeedItem[];
    error?: string;
}
export interface ProbeResult {
    sources: ProbeSource[];
    dedupedLinks: string[];
}
/**
 * One-shot multi-source probe for a query. Used by search_deep.
 * targets: 'all' | 'hn' | 'reddit' | 'forum' | comma-separated mix.
 */
export declare function probeAll(q: string, opts?: {
    targets?: string;
    forumBase?: string;
    subreddit?: string;
    maxPerSource?: number;
}): Promise<ProbeResult>;
