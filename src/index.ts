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
import { maybeStartServer } from './server.js';

const textOut = { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] };

export const name = 'dsh-search';
export const inject = ['tools'];

export async function apply(ctx: any) {
  // --- search_code: local codebase semantic/lexical search (semble-inspired) ---
  ctx.tools.register(defineTool({
    name: 'search_code',
    description: 'Search a local codebase with a natural-language or symbol query (semble-style: BM25 + identifier tokens + definition-aware reranking; ARK semantic layer when ARK_API_KEY is present, local hash otherwise). Returns precise file:line snippets so you do not need grep+read to find code. Filter syntax: +"word" required, -"word" excluded, file:"glob" (e.g. +"auth" file:"*.ts"). Index is cached at ~/.dsh/search-index/ and refreshed incrementally on file changes.',
    parameters: {
      path: { type: 'string', required: true, description: 'absolute path to the codebase root' },
      query: { type: 'string', required: true, description: 'natural-language or symbol query, e.g. "how is authentication handled" or "parseConfig"' },
      topK: { type: 'number', required: false, description: 'max results (default 10, max 30)' },
      maxSnippetLines: { type: 'number', required: false, description: 'lines of content per result (default 0 = file:line only; N = first N lines; -1 = full chunk)' },
      filter: { type: 'string', required: false, description: 'khoj-style filter: +"word" -"word" file:"glob"' },
      rebuild: { type: 'boolean', required: false, description: 'force full index rebuild (default false)' },
    },
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
        rebuild: args?.rebuild === true,
      });
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
    },
  }));

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
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = extractText(await res.text());
      return 'URL: ' + url + '\nchars: ' + text.length + '\n\n' + text;
    },
  }));

  // --- search_github ---
  ctx.tools.register(defineTool({
    name: 'search_github',
    description: 'Search GitHub directly via its REST API (no Google). Types: repo (default), code, issue, commit. Code search requires a token (GITHUB_TOKEN/GH_PAT env or ~/.dsh/.credentials.yaml refs). Use qualifiers like "lang:ts stars:>100" or "repo:owner/name".',
    parameters: {
      q: { type: 'string', required: true, description: 'search query, may include GitHub qualifiers' },
      type: { type: 'string', required: false, description: 'repo | code | issue | commit (default repo)' },
      perPage: { type: 'number', required: false, description: '1-50 (default 10)' },
      sort: { type: 'string', required: false, description: 'repo: stars/forks/updated; issue: comments/reactions/created/updated' },
      order: { type: 'string', required: false, description: 'asc | desc' },
    },
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
        order: args?.order ? String(args.order) : undefined,
      });
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
    },
  }));

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
            signal: AbortSignal.timeout(25000),
          });
          if (!res.ok) { errors.push(url + ' HTTP ' + res.status); continue; }
          const chunks = chunkText(extractText(await res.text()));
          if (!chunks.length) { errors.push(url + ' empty'); continue; }
          const vecs = await embedTexts(chunks);
          indexed += store.add(url, chunks, vecs);
        } catch (e) { errors.push(url + ' ' + String((e as Error).message)); }
      }
      return 'indexed ' + indexed + ' chunks from ' + urls.length + ' url(s) (total ' + store.count() + ')' +
        (errors.length ? '\nerrors: ' + errors.join('; ') : '');
    },
  }));

  // --- search_corpus_search ---
  ctx.tools.register(defineTool({
    name: 'search_corpus_search',
    description: 'Semantic search over the ephemeral corpus (see search_corpus_add). Returns top-k chunks with cosine scores.',
    parameters: {
      q: { type: 'string', required: true, description: 'query text' },
      k: { type: 'number', required: false, description: 'top-k (default 5, max 20)' },
    },
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
    },
  }));

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
    },
  }));


  // --- search_probe ---
  ctx.tools.register(defineTool({
    name: 'search_probe',
    description: 'Deep-web probe: mine content search engines cannot reach — Hacker News (Algolia), Reddit (JSON API), forum search endpoints (phpBB/XenForo/Flarum/Discourse/vBulletin), and RSSHub feeds (public https://rsshub.app or DSH_SEARCH_RSSHUB_URL). Returns items per source with deduped links.',
    parameters: {
      q: { type: 'string', required: true, description: 'search query' },
      targets: { type: 'string', required: false, description: 'all | hn | reddit | forum | comma-mix (default all)' },
      forumBase: { type: 'string', required: false, description: 'forum base URL to mine (e.g. https://forum.example.com)' },
      subreddit: { type: 'string', required: false, description: 'restrict Reddit to a subreddit' },
      maxPerSource: { type: 'number', required: false, description: 'items per source (default 10)' },
    },
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
        maxPerSource: Number(args?.maxPerSource) || 10,
      });
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
    },
  }));

  // --- search_deep ---
  ctx.tools.register(defineTool({
    name: 'search_deep',
    description: 'Agentic deep-web investigation: plan -> parallel probe (HN/Reddit/forums/RSSHub) -> reflect -> synthesize with [n] citation anchors. Unlike plain search it digs into forums and communities search engines cannot index. Requires ctx.llm (host LLM). maxIterations 1-5, maxQueries 1-10, depth light (snippets) | deep (full-page fetch).',
    parameters: {
      question: { type: 'string', required: true, description: 'the research question' },
      maxIterations: { type: 'number', required: false, description: '1-5 (default 3)' },
      maxQueries: { type: 'number', required: false, description: '1-10 (default 4)' },
      depth: { type: 'string', required: false, description: 'light | deep (default light)' },
      targets: { type: 'string', required: false, description: 'all | hn | reddit | forum | mix' },
      forumBase: { type: 'string', required: false, description: 'forum URL to mine' },
      subreddit: { type: 'string', required: false, description: 'Reddit subreddit filter' },
    },
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
        subreddit: args?.subreddit ? String(args.subreddit) : undefined,
      });
      return 'iterations: ' + res.iterations + ' | queries: ' + res.queries.length + ' | sources: ' + res.sources.length + '\n\n' + res.answer;
    },
  }));

  // optional hono HTTP daemon
  const stop = maybeStartServer();
  if (stop) {
    ctx.onDispose?.(stop);
  }
}

export async function dispose() {
  resetStore();
}