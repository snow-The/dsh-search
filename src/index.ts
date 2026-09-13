/**
 * dsh-search — universal search toolkit for DSH.
 *  - search_fetch: browser-less page fetch + text extraction (headless hosts ok)
 *  - search_github: first-party GitHub search (repos/code/issues/commits, no Google)
 *  - search_corpus_add / search_corpus_search / search_corpus_clear:
 *    ephemeral vector corpus (node:sqlite + ARK embedding w/ local fallback)
 *  - optional hono HTTP API (DSH_SEARCH_HTTP_PORT)
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { extractText, chunkText, embedTexts, getStore, resetStore } from './query.js';
import { githubSearch, githubToken, type GitHubKind } from './github.js';
import { callOpenApi } from './openapi.js';
import { arxivSearchBatch, formatBatch } from './arxiv.js';
import { hubSearch, type HubKind } from './hubs.js';
import { openSourceSearch, OPEN_SOURCES, type OpenSourceId } from './opensources.js';
import { maybeStartServer } from './server.js';
import { registerWebProvider, registerPlatformSearchTool, type SearchConfig } from './websearch.js';

const textOut = { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] };

export const name = 'dsh-search';
export const inject = ['tools', 'web'];

export async function apply(ctx: any) {
  console.log('[dsh-search] apply called, ctx.web =', !!ctx.web, ', registerSearchProvider =', typeof (ctx.web as any)?.registerSearchProvider);
  const searchCfg = (): SearchConfig => ({
    provider: process.env.DSH_SEARCH_PROVIDER || 'bing',
    cache: true,
    cacheTtl: 5});
  // provider 注册放最前：任何工具注册失败都不阻断 web 搜索 provider
  registerWebProvider(ctx, searchCfg);
  registerPlatformSearchTool(ctx, searchCfg);
  // --- search_code: local codebase semantic/lexical search (semble-inspired) ---
  ctx.tools.register(defineTool({
    name: 'search_code',
    description: 'Search a local codebase with a natural-language or symbol query (semble-style: BM25 + identifier tokens + definition-aware reranking; ARK semantic layer when ARK_API_KEY is present, local hash otherwise). Returns precise file:line snippets so you do not need grep+read to find code. Filter syntax: +"word" required, -"word" excluded, file:"glob" (e.g. +"auth" file:"*.ts"). Index is cached at ~/.dsh/search-index/ and refreshed incrementally on file changes.',
    parameters: {
      path: { type: 'string', required: true, description: 'absolute path to the codebase root' },
      query: { type: 'string', required: true, description: 'natural-language or symbol query, e.g. "how is authentication handled" or "parseConfig"' },
      topK: { type: 'number', description: 'max results (default 10, max 30)' },
      maxSnippetLines: { type: 'number', description: 'lines of content per result (default 0 = file:line only; N = first N lines; -1 = full chunk)' },
      filter: { type: 'string', description: 'khoj-style filter: +"word" -"word" file:"glob"' },
      rebuild: { type: 'boolean', description: 'force full index rebuild (default false)' }},
    output: textOut,
    timeoutMs: 300000,
    async execute(args: any) {
      const path = String(args?.path ?? '').trim();
      const query = String(args?.query ?? '').trim();
      if (!path) throw new Error('path required');
      if (!query) throw new Error('query required');
      const { searchCode } = await import('./code/search.js');
      const hits = await searchCode({
        path,
        query,
        topK: Number(args?.topK) || 10,
        filter: args?.filter ? String(args.filter) : undefined,
        rebuild: args?.rebuild === true});
      if (!hits.length) return 'No results for: ' + query;
      const maxLines = Number(args?.maxSnippetLines ?? 0);
      const lines: string[] = ['Code search: ' + query + ' (' + hits.length + ' hits)', ''];
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        lines.push('[' + (i + 1) + '] ' + h.filePath + ':' + h.startLine + '-' + h.endLine + '  (score ' + h.score.toFixed(3) + ')');
        if (maxLines > 0) {
          const content = h.content.split('\n').slice(0, maxLines).join('\n');
          lines.push(content);
        } else if (maxLines < 0) {
          lines.push(h.content);
        }
        lines.push('');
      }
      return lines.join('\n');
    }}));

  // --- search_fetch ---
  ctx.tools.register(defineTool({
    name: 'search_fetch',
    description: 'Fetch a URL WITHOUT a browser (pure Node fetch) and return extracted page text. Works on headless/remote hosts with no Chrome. Use for pure information queries; use browser_open (dsh-browser) when real page interaction is needed.',
    parameters: { url: { type: 'string', required: true, description: 'http(s) URL' } },
    output: textOut,
    timeoutMs: 30000,
    async execute(args: any) {
      const url = String(args?.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('url must start with http(s)://');
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (dsh-search)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(25000)});
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = extractText(await res.text());
      return 'URL: ' + url + '\nchars: ' + text.length + '\n\n' + text;
    }}));

  // --- search_github ---
  ctx.tools.register(defineTool({
    name: 'search_github',
    description: 'Search GitHub directly via its REST API (no Google). Types: repo (default), code, issue, commit. Code search requires a token (GITHUB_TOKEN/GH_PAT env or ~/.dsh/.credentials.yaml refs). Use qualifiers like "lang:ts stars:>100" or "repo:owner/name".',
    parameters: {
      q: { type: 'string', required: true, description: 'search query, may include GitHub qualifiers' },
      type: { type: 'string', description: 'repo | code | issue | commit (default repo)' },
      perPage: { type: 'number', description: '1-50 (default 10)' },
      sort: { type: 'string', description: 'repo: stars/forks/updated; issue: comments/reactions/created/updated' },
      order: { type: 'string', description: 'asc | desc' }},
    output: textOut,
    timeoutMs: 30000,
    async execute(args: any) {
      const kind = (String(args?.type ?? 'repo').toLowerCase() as GitHubKind);
      if (!['repo', 'code', 'issue', 'commit'].includes(kind)) throw new Error('type must be repo|code|issue|commit');
      const q = String(args?.q ?? '').trim();
      if (!q) throw new Error('q required');
      const r = await githubSearch(kind, q, {
        perPage: Number(args?.perPage) || 10,
        sort: args?.sort ? String(args.sort) : undefined,
        order: args?.order ? String(args.order) : undefined});
      if (r.error) return 'ERROR: ' + r.error;
      if (!r.hits.length) return 'No results (total ' + r.total + ')';
      const token = githubToken() ? 'authed' : 'UNAUTHED (rate limit 10/min)';
      const lines = ['GitHub ' + kind + ' search: ' + q, 'total: ' + r.total + ' | auth: ' + token, ''];
      for (const h of r.hits) {
        lines.push('• ' + h.title);
        lines.push('  ' + h.url);
        if (h.detail) lines.push('  ' + h.detail);
        lines.push('');
      }
      return lines.join('\n');
    }}));


  // --- search_open: the A-tier free sources (no credential, all probed from this machine) ---
  ctx.tools.register(defineTool({
    name: 'search_open',
    description: 'Search credential-free research sources: crossref (DOI metadata for any registered work), europepmc (life sciences + preprints), pubmed (biomedical index), figshare (research outputs/datasets), clinicaltrials (registered studies), openfda (drug adverse-event reports), chembl (compounds/bioactivity). Every one answered HTTP 200 from this machine with no key. Sources that need a login are deliberately NOT here.',
    parameters: {
      source: { type: 'string', required: true, description: 'crossref | europepmc | pubmed | figshare | clinicaltrials | openfda | chembl' },
      query: { type: 'string', required: true, description: 'search terms (for openfda: a drug name)' },
      limit: { type: 'number', description: 'max results (default 5, max 25)' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    timeoutMs: 45000,
    async execute(args: any) {
      const source = String(args?.source ?? '').trim() as OpenSourceId;
      if (!Object.prototype.hasOwnProperty.call(OPEN_SOURCES, source)) throw new Error('source must be one of: ' + Object.keys(OPEN_SOURCES).join(' | '));
      const q = String(args?.query ?? '').trim();
      if (!q) throw new Error('query required');
      const r = await openSourceSearch(source, q, Number(args?.limit) || 5);
      const head = OPEN_SOURCES[source].label + '  |  query: ' + JSON.stringify(q) + (r.note ? '  [' + r.note + ']' : '');
      if (r.error) return head + '\nERROR: ' + r.error;
      if (!r.hits.length) return head + '\nNo results.';
      const lines = [head, ''];
      for (const h of r.hits) { lines.push('• ' + h.title); if (h.url) lines.push('  ' + h.url); if (h.detail) lines.push('  ' + h.detail); lines.push(''); }
      return lines.join('\n');
    }}));

  // --- search_hubs: model / dataset hub search (no credential needed for any of these) ---
  ctx.tools.register(defineTool({
    name: 'search_hubs',
    description: 'Search model and dataset hubs: hf-models, hf-datasets (HuggingFace) and kaggle-datasets. ALL THREE ANSWER WITHOUT ANY LOGIN (measured 200/~210-420ms) and report size + popularity so a wrong pick is visible before downloading. Kaggle competitions/notebooks and ModelScope search are the credentialed half and are deliberately not covered.',
    parameters: {
      query: { type: 'string', required: true, description: 'search terms, e.g. "bge embedding zh" or "protein embeddings"' },
      kind: { type: 'string', description: 'hf-models (default) | hf-datasets | kaggle-datasets' },
      limit: { type: 'number', description: 'max results (default 10, max 25)' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    timeoutMs: 30000,
    async execute(args: any) {
      const kind = String(args?.kind ?? 'hf-models') as HubKind;
      if (!['hf-models', 'hf-datasets', 'kaggle-datasets'].includes(kind)) throw new Error('kind must be hf-models|hf-datasets|kaggle-datasets');
      const q = String(args?.query ?? '').trim();
      if (!q) throw new Error('query required');
      const r = await hubSearch(kind, q, Number(args?.limit) || 10);
      if (r.error) return 'ERROR: ' + r.error;
      if (!r.hits.length) return 'No results for ' + JSON.stringify(q) + ' on ' + kind;
      const lines = [kind + ' search: ' + q + '  (' + r.hits.length + ' hits, ' + (r.note ?? '') + ')', ''];
      for (const h of r.hits) { lines.push('• ' + h.title); lines.push('  ' + h.url); lines.push('  ' + h.detail); lines.push(''); }
      return lines.join('\n');
    }}));

  // --- search_api: OpenAPI 3.x generic API caller (any spec: JSON/YAML URL, file, or inline) ---
  ctx.tools.register(defineTool({
    name: 'search_api',
    description: 'Call any REST API described by an OpenAPI 3.x spec (OAS 3.0/3.1). Pass spec= as an http(s) URL, a local file path, or an inline JSON/YAML string; operation= as an operationId or "METHOD /path" (e.g. "get /search/repositories"). params= maps parameter names to values (path/query/header + body via params.body). auth= accepts a bearer/apiKey token, "env:VAR" for an env var, or "github"/"gh" to use the gh CLI keyring token. server= overrides the spec server URL. Uses @scalar/openapi-parser + yaml under the hood. Example: spec="https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json" operation="get /search/repositories" params={"q":"mem0","sort":"stars"} auth="gh".',
    parameters: {
      spec: { type: 'string', required: true, description: 'OpenAPI spec: http(s) URL | local file path | inline JSON/YAML string' },
      operation: { type: 'string', required: true, description: 'operationId, or "METHOD /path" (e.g. "get /search/repositories")' },
      params: { type: 'object', additionalProperties: true, description: 'parameter name -> value (path/query/header); request body via params.body' },
      server: { type: 'string', description: 'override the spec server base URL' },
      auth: { type: 'string', description: 'bearer/apiKey token | "env:VAR" | "github"/"gh" (gh CLI keyring)' },
      timeoutMs: { type: 'number', description: 'request timeout (default 60000)' }},
    output: textOut,
    timeoutMs: 120000,
    async execute(args: any) {
      const spec = args?.spec;
      const operation = String(args?.operation ?? '').trim();
      if (!spec) throw new Error('spec required (URL, file path, or inline JSON/YAML)');
      if (!operation) throw new Error('operation required (operationId or "METHOD /path")');
      const params = args?.params && typeof args.params === 'object' ? args.params as Record<string, unknown> : undefined;
      return await callOpenApi({
        spec,
        operation,
        params,
        server: args?.server ? String(args.server) : undefined,
        auth: args?.auth ? String(args.auth) : undefined,
        timeoutMs: args?.timeoutMs ? Number(args.timeoutMs) : undefined,
      });
    }}));

  // --- search_arxiv: arXiv API (papers, no browser needed) ---
  ctx.tools.register(defineTool({
    name: 'search_arxiv',
    description: 'Search arXiv papers via the official export API (Atom, no key). Supports arXiv query syntax: field prefixes all:/ti:/au:/abs:/cat:, boolean AND/OR/ANDNOT, quoted phrases (e.g. all:"mean-shift" AND all:"representation learning" OR ti:distillation). Pass multiple queries to cover several angles of one research question — each query is rate-limited politely (arXiv requires ~3s between calls). Returns id, title, authors, categories, published date, abstract, abs URL per hit.',
    parameters: {
      queries: { type: 'array', required: true, description: '1-8 arXiv search_query strings (see syntax above)' },
      maxResultsPerQuery: { type: 'number', description: 'max hits per query (default 5, max 20)' },
      sortBy: { type: 'string', description: 'relevance (default) | recent' },
      summaryChars: { type: 'number', description: 'abstract chars per paper (default 280)' }},
    output: textOut,
    timeoutMs: 120000,
    async execute(args: any) {
      const queries = Array.isArray(args?.queries) ? args.queries.filter((q: unknown) => typeof q === 'string' && q.trim().length > 0).map((q: unknown) => String(q).trim()) : [];
      if (!queries.length) throw new Error('queries required (1-8 strings)');
      if (queries.length > 8) throw new Error('max 8 queries per call');
      const maxResults = Math.min(Number(args?.maxResultsPerQuery) || 5, 20);
      const sortBy = (args?.sortBy === 'recent' ? 'submittedDate' : 'relevance') as 'relevance' | 'submittedDate';
      const summaryChars = Number(args?.summaryChars) || 280;
      const results = await arxivSearchBatch(queries, { maxResults, sortBy });
      return formatBatch(results, summaryChars);
    }}));

  // --- search_corpus_add ---
  ctx.tools.register(defineTool({
    name: 'search_corpus_add',
    description: 'Fetch a list of URLs, extract text, chunk, embed, and index into the ephemeral search corpus (SQLite at ~/.dsh/browser-shots/corpus.db). Use with search_corpus_search for multi-page research; clear with search_corpus_clear when done.',
    parameters: { urls: { type: 'array', required: true, description: 'http(s) URLs to index' } },
    output: textOut,
    timeoutMs: 120000,
    async execute(args: any) {
      const urls = Array.isArray(args?.urls) ? args.urls.filter((u: unknown) => typeof u === 'string' && /^https?:\/\//i.test(u)) : [];
      if (!urls.length) throw new Error('no valid urls');
      const store = getStore();
      let indexed = 0;
      const errors: string[] = [];
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (dsh-search)' },
            redirect: 'follow',
            signal: AbortSignal.timeout(25000)});
          if (!res.ok) { errors.push(url + ' HTTP ' + res.status); continue; }
          const chunks = chunkText(extractText(await res.text()));
          if (!chunks.length) { errors.push(url + ' empty'); continue; }
          const vecs = await embedTexts(chunks);
          indexed += store.add(url, chunks, vecs);
        } catch (e) { errors.push(url + ' ' + String((e as Error).message)); }
      }
      return 'indexed ' + indexed + ' chunks from ' + urls.length + ' url(s) (total ' + store.count() + ')' +
        (errors.length ? '\nerrors: ' + errors.join('; ') : '');
    }}));

  // --- search_corpus_search ---
  ctx.tools.register(defineTool({
    name: 'search_corpus_search',
    description: 'Semantic search over the ephemeral corpus (see search_corpus_add). Returns top-k chunks with cosine scores.',
    parameters: {
      q: { type: 'string', required: true, description: 'query text' },
      k: { type: 'number', description: 'top-k (default 5, max 20)' }},
    output: textOut,
    timeoutMs: 60000,
    async execute(args: any) {
      const q = String(args?.q ?? '').trim();
      if (!q) throw new Error('q required');
      const k = Math.min(Math.max(Number(args?.k) || 5, 1), 20);
      const vec = (await embedTexts([q]))[0];
      const hits = getStore().search(vec, k);
      if (!hits.length) return 'corpus empty — add urls first via search_corpus_add';
      return hits.map((h, i) => '[' + (i + 1) + '] ' + h.score.toFixed(3) + ' ' + h.url + '\n  ' + h.chunk.slice(0, 240)).join('\n');
    }}));

  // --- search_corpus_clear ---
  ctx.tools.register(defineTool({
    name: 'search_corpus_clear',
    description: 'Clear the ephemeral search corpus (throwaway research state).',
    parameters: {},
    output: textOut,
    timeoutMs: 10000,
    execute() {
      getStore().clear();
      return 'corpus cleared';
    }}));


  // --- search_probe ---
  ctx.tools.register(defineTool({
    name: 'search_probe',
    description: 'Deep-web probe: mine content search engines cannot reach — Hacker News (Algolia), Reddit (JSON API), forum search endpoints (phpBB/XenForo/Flarum/Discourse/vBulletin), and RSSHub feeds (public https://rsshub.app or DSH_SEARCH_RSSHUB_URL). Returns items per source with deduped links.',
    parameters: {
      q: { type: 'string', required: true, description: 'search query' },
      targets: { type: 'string', description: 'all | hn | reddit | forum | comma-mix (default all)' },
      forumBase: { type: 'string', description: 'forum base URL to mine (e.g. https://forum.example.com)' },
      subreddit: { type: 'string', description: 'restrict Reddit to a subreddit' },
      maxPerSource: { type: 'number', description: 'items per source (default 10)' }},
    output: textOut,
    timeoutMs: 60000,
    async execute(args: any) {
      const q = String(args?.q ?? '').trim();
      if (!q) throw new Error('q required');
      const { probeAll } = await import('./probe.js');
      const result = await probeAll(q, {
        targets: args?.targets ? String(args.targets) : undefined,
        forumBase: args?.forumBase ? String(args.forumBase) : undefined,
        subreddit: args?.subreddit ? String(args.subreddit) : undefined,
        maxPerSource: Number(args?.maxPerSource) || 10});
      const lines: string[] = ['Probe: ' + q, ''];
      let total = 0;
      for (const s of result.sources) {
        lines.push('## ' + s.label + (s.error ? ' [error: ' + s.error + ']' : ''));
        for (const item of s.items) {
          total++;
          lines.push('- ' + item.title.slice(0, 140));
          lines.push('  ' + item.link);
          if (item.description) lines.push('  ' + item.description.slice(0, 200));
        }
        lines.push('');
      }
      lines.push('items: ' + total + ' | deduped links: ' + result.dedupedLinks.length);
      return lines.join('\n');
    }}));

  // --- search_deep ---
  ctx.tools.register(defineTool({
    name: 'search_deep',
    description: 'Agentic deep-web investigation: plan -> parallel probe (HN/Reddit/forums/RSSHub) -> reflect -> synthesize with [n] citation anchors. Unlike plain search it digs into forums and communities search engines cannot index. Requires ctx.llm (host LLM). maxIterations 1-5, maxQueries 1-10, depth light (snippets) | deep (full-page fetch).',
    parameters: {
      question: { type: 'string', required: true, description: 'the research question' },
      maxIterations: { type: 'number', description: '1-5 (default 3)' },
      maxQueries: { type: 'number', description: '1-10 (default 4)' },
      depth: { type: 'string', description: 'light | deep (default light)' },
      targets: { type: 'string', description: 'all | hn | reddit | forum | mix' },
      forumBase: { type: 'string', description: 'forum URL to mine' },
      subreddit: { type: 'string', description: 'Reddit subreddit filter' }},
    output: textOut,
    timeoutMs: 300000,
    async execute(args: any) {
      const question = String(args?.question ?? '').trim();
      if (!question) throw new Error('question required');
      const llm: any = ctx.llm;
      if (!llm?.stream) throw new Error('ctx.llm not available — search_deep needs the host LLM service');
      const { deepSearch } = await import('./deepsearch.js');
      const res = await deepSearch(llm, question, {
        maxIterations: Number(args?.maxIterations) || 3,
        maxQueries: Number(args?.maxQueries) || 4,
        depth: args?.depth === 'deep' ? 'deep' : 'light',
        targets: args?.targets ? String(args.targets) : undefined,
        forumBase: args?.forumBase ? String(args.forumBase) : undefined,
        subreddit: args?.subreddit ? String(args.subreddit) : undefined});
      return 'iterations: ' + res.iterations + ' | queries: ' + res.queries.length + ' | sources: ' + res.sources.length + '\n\n' + res.answer;
    }}));

  // --- v0.4 web search provider (Bing/DDG/SearXNG free; Exa/Tavily keyed) ---
  // Config: env EXA_API_KEY / TAVILY_API_KEY; optional env DSH_SEARCH_PROVIDER (default engine)
  
  // optional hono HTTP daemon
  const stop = maybeStartServer();
  if (stop) {
    ctx.onDispose?.(stop);
  }
}

export async function dispose() {
  resetStore();
}