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
export const inject = { config: { queryTools: true, githubSearch: true, httpPort: process.env.DSH_SEARCH_HTTP_PORT ?? '' } };

export async function apply(ctx: any) {
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

  // optional hono HTTP daemon
  const stop = maybeStartServer();
  if (stop) {
    ctx.onDispose?.(stop);
  }
}

export async function dispose() {
  resetStore();
}
