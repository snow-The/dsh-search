/**
 * dsh-search deepsearch — agentic deep-web investigation loop.
 *
 * Absorbed from google-gemini/gemini-fullstack-langgraph-quickstart,
 * RyotaOzawa0/langgraph-deepsearch-mcp and sentient-agi/OpenDeepSearch:
 *  - plan -> search/probe -> reflect -> synthesize loop (dual termination:
 *    LLM self-assessment OR max iterations)
 *  - parallel multi-query fan-out (map-reduce) with bounded width
 *  - reference anchors [n] appended in the final answer; only sources
 *    actually cited are back-filled
 *  - depth: 'light' (snippets only) vs 'deep' (full-page fetch + chunk + rerank)
 *  - maxIterations clamp 1-5, maxQueries clamp 1-10 (langgraph-deepsearch-mcp)
 *  - probe layer (probe.ts): HN / Reddit / forum endpoints / RSSHub feeds —
 *    the "search engine can't reach" content
 */
export interface Llm {
    stream: (opts: {
        model?: string;
        system?: string;
        messages: {
            role: string;
            content: string;
        }[];
        temperature?: number;
        maxTokens?: number;
    }) => AsyncIterable<{
        text?: string;
        content?: string;
    }>;
    listProviders?: () => Promise<{
        id: string;
        model?: string;
    }[]>;
}
export interface DeepSearchOptions {
    maxIterations?: number;
    maxQueries?: number;
    depth?: 'light' | 'deep';
    targets?: string;
    forumBase?: string;
    subreddit?: string;
    model?: string;
    timeoutMs?: number;
}
export declare function deepSearch(llm: Llm, question: string, opts?: DeepSearchOptions): Promise<{
    answer: string;
    sources: {
        n: number;
        title: string;
        url: string;
        snippet: string;
    }[];
    iterations: number;
    queries: string[];
}>;
