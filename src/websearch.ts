/**
 * dsh-search v0.4 — unified web search provider.
 * Engines (no key): bing, ddg, ddg-lite, searxng (multi-instance failover)
 * Engines (keyed, optional): exa (EXA_API_KEY), tavily (TAVILY_API_KEY)
 * Fallback chain: explicit engine > keyed engines > free engines.
 * LRU result cache (TTL configurable, default 5 min) to dodge rate limits.
 * Registered via ctx.web.registerSearchProvider (id: "dsh-search").
 * Engine-parsing patterns reference DDDMUC/dsh-free-search (MIT).
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

export const SEARCH_ENGINES = ['bing', 'ddg', 'ddg-lite', 'searxng', 'exa', 'tavily'] as const;
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
  provider?: string;            // default engine
  searxngInstances?: string[];  // custom SearXNG instances
  bingMarket?: string;
  region?: string;
  safeSearch?: 'off' | 'moderate' | 'strict';
  cache?: boolean;
  cacheTtl?: number;            // minutes 0-5
}

const BING_URL = 'https://www.bing.com/search';
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/';
const TAVILY_URL = 'https://api.tavily.com/search';
const EXA_URL = 'https://api.exa.ai/search';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const ACCEPT_LANG = 'zh-CN,zh;q=0.9,en;q=0.8';
const SEARXNG_INSTANCES = [
  'https://opnxng.com',
  'https://priv.au',
  'https://searx.be',
  'https://searx.tiekoetter.com',
  'https://search.inetol.net',
  'https://paulgo.io',
];

// ---------- helpers ----------
function decodeEntities(text: string): string {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: string): string {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractDdgUrl(rel: string): string | null {
  if (!rel) return null;
  const m = rel.match(/uddg=([^&]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  if (rel.startsWith('//')) return 'https:' + rel;
  return rel;
}

function uniqueSources(sources: SearchHit[], limit: number): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      out.push(s);
    }
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchText(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, 'accept-language': ACCEPT_LANG, ...headers },
      redirect: 'follow',
      signal: controller.signal});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function fetchHtmlWithRetry(url: string, signal?: AbortSignal): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchText(url, signal);
      if (html.length > 500) return html;
      lastError = new Error('empty response (' + html.length + ' bytes)');
    } catch (e) {
      lastError = e;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError ?? new Error('fetch failed');
}

function approximateTimeRange(days: number): 'day' | 'week' | 'month' | 'year' {
  if (days <= 2) return 'day';
  if (days <= 14) return 'week';
  if (days <= 90) return 'month';
  return 'year';
}

function parseTimeRange(tr: unknown): { days?: number; label?: string } | null {
  if (tr == null) return null;
  if (typeof tr === 'object') {
    const o = tr as Record<string, unknown>;
    if (typeof o.days === 'number') return { days: o.days, label: String(o.days) + 'd' };
    return null;
  }
  const s = String(tr).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+)([dwmoy])$/);
  if (m) {
    const n = Number(m[1]);
    const days = m[2] === 'd' ? n : m[2] === 'w' ? n * 7 : m[2] === 'm' ? n * 30 : n * 365;
    return { days, label: s };
  }
  if (s === 'day' || s === 'week' || s === 'month' || s === 'year') {
    const days = s === 'day' ? 1 : s === 'week' ? 7 : s === 'month' ? 30 : 365;
    return { days, label: s };
  }
  return null;
}

// ---------- engines ----------
async function searchBing(query: string, maxResults: number, cfg: SearchConfig, signal?: AbortSignal): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query, mkt: cfg.bingMarket ?? 'zh-CN' });
  const adlt = cfg.safeSearch ?? 'off';
  if (adlt === 'off') params.set('adlt', 'off');
  else if (adlt === 'moderate') params.set('adlt', 'moderate');
  else params.set('adlt', 'strict');
  const html = await fetchHtmlWithRetry(BING_URL + '?' + params, signal);
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  const sources: SearchHit[] = [];
  for (const block of blocks) {
    const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (!hrefMatch) continue;
    sources.push({
      url: hrefMatch[1],
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippetMatch ? { snippet: stripTags(snippetMatch[1]) } : {})});
  }
  return uniqueSources(sources, maxResults);
}

async function searchDdgHtml(query: string, maxResults: number, cfg: SearchConfig, signal?: AbortSignal, timeRange?: { days?: number }): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query });
  if (cfg.region) params.set('kl', cfg.region);
  const adlt = cfg.safeSearch ?? 'off';
  params.set('adlt', adlt === 'strict' ? '1' : adlt === 'moderate' ? '0' : '-1');
  if (timeRange?.days != null) {
    const df = { day: 'd', week: 'w', month: 'm', year: 'y' }[approximateTimeRange(timeRange.days)];
    if (df) params.set('df', df);
  }
  const html = await fetchHtmlWithRetry(DDG_HTML_URL + '?' + params, signal);
  const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? [];
  const sources: SearchHit[] = [];
  for (const block of blocks) {
    const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/);
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);
    const dateMatch = block.match(/<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/);
    const url = extractDdgUrl(urlMatch?.[1] ?? '');
    if (!url) continue;
    sources.push({
      url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippetMatch ? { snippet: stripTags(snippetMatch[1]) } : {}),
      ...(dateMatch ? { publishedAt: dateMatch[1] } : {})});
  }
  return uniqueSources(sources, maxResults);
}

async function searchDdgLite(query: string, maxResults: number, cfg: SearchConfig, signal?: AbortSignal, timeRange?: { days?: number }): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query });
  const adlt = cfg.safeSearch ?? 'off';
  params.set('adlt', adlt === 'strict' ? '1' : adlt === 'moderate' ? '0' : '-1');
  if (timeRange?.days != null) {
    const df = { day: 'd', week: 'w', month: 'm', year: 'y' }[approximateTimeRange(timeRange.days)];
    if (df) params.set('df', df);
  }
  const html = await fetchHtmlWithRetry(DDG_LITE_URL + '?' + params, signal);
  const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? [];
  const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? [];
  const sources: SearchHit[] = [];
  for (let i = 0; i < linkMatches.length; i++) {
    const tag = linkMatches[i];
    const hrefMatch = tag.match(/href="([^"]*)"/);
    const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/);
    if (!hrefMatch) continue;
    const url = extractDdgUrl(hrefMatch[1]);
    if (!url) continue;
    const snippet = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1];
    sources.push({
      url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippet ? { snippet: stripTags(snippet) } : {})});
  }
  return uniqueSources(sources, maxResults);
}

async function searchSearxng(query: string, maxResults: number, cfg: SearchConfig, signal?: AbortSignal, timeRange?: { days?: number }): Promise<SearchHit[]> {
  const instances = cfg.searxngInstances?.length ? cfg.searxngInstances : SEARXNG_INSTANCES;
  const errors: string[] = [];
  for (const base of instances) {
    try {
      const params = new URLSearchParams({ q: query, format: 'json' });
      if (timeRange?.days != null) {
        const tr = { day: 'day', week: 'week', month: 'month', year: 'year' }[approximateTimeRange(timeRange.days)];
        if (tr) params.set('time_range', tr);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort);
      let response: Response;
      try {
        response = await fetch(base + '/search?' + params, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: controller.signal});
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      if (!response.ok) {
        errors.push(base + ': HTTP ' + response.status);
        continue;
      }
      const data = (await response.json().catch(() => null)) as { results?: { url?: string; title?: string; content?: string }[] } | null;
      if (!data || !Array.isArray(data.results)) {
        errors.push(base + ': invalid JSON');
        continue;
      }
      const sources = data.results
        .filter((r) => r.url)
        .map((r) => ({
          url: r.url!,
          ...(r.title ? { title: String(r.title) } : {}),
          ...(r.content ? { snippet: String(r.content) } : {})}));
      if (sources.length > 0) return uniqueSources(sources, maxResults);
      errors.push(base + ': 0 results');
    } catch (e) {
      errors.push(base + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  throw new Error('searxng: all instances failed — ' + errors.join(' | '));
}

async function searchTavily(query: string, maxResults: number, apiKey: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({ api_key: apiKey, query, max_results: Math.min(maxResults, 10), search_depth: 'basic' }),
    signal});
  if (!res.ok) throw new Error('tavily: HTTP ' + res.status);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return uniqueSources(
    (data.results ?? []).map((r) => ({
      url: r.url ?? '',
      ...(r.title ? { title: r.title } : {}),
      ...(r.content ? { snippet: r.content } : {})})).filter((s) => s.url),
    maxResults,
  );
}

async function searchExa(query: string, maxResults: number, apiKey: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const res = await fetch(EXA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'user-agent': USER_AGENT },
    body: JSON.stringify({ query, numResults: Math.min(maxResults, 10) }),
    signal});
  if (!res.ok) throw new Error('exa: HTTP ' + res.status);
  const data = (await res.json()) as { results?: { title?: string; url?: string; text?: string }[] };
  return uniqueSources(
    (data.results ?? []).map((r) => ({
      url: r.url ?? '',
      ...(r.title ? { title: r.title } : {}),
      ...(r.text ? { snippet: r.text.slice(0, 300) } : {})})).filter((s) => s.url),
    maxResults,
  );
}

// ---------- cache (LRU) ----------
interface CacheEntry {
  value: WebSearchOut;
  expiresAt: number;
}
const CACHE_MAX = 50;
const cache = new Map<string, CacheEntry>();

function cacheKey(query: string, maxResults: number, engine: string, timeLabel: string): string {
  return engine + '|' + maxResults + '|' + timeLabel + '|' + query;
}

function cacheGet(key: string): WebSearchOut | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  // LRU touch
  cache.delete(key);
  cache.set(key, e);
  return e.value;
}

function cacheSet(key: string, value: WebSearchOut, ttlMs: number): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---------- engine registry ----------
type EngineFn = (query: string, maxResults: number, cfg: SearchConfig, signal?: AbortSignal, timeRange?: { days?: number }) => Promise<SearchHit[]>;

const KEYED_ENGINES: Record<string, { fn: EngineFn; keyEnv: string }> = {
  exa: { fn: (q, m, _c, s) => searchExa(q, m, process.env.EXA_API_KEY ?? '', s), keyEnv: 'EXA_API_KEY' },
  tavily: { fn: (q, m, _c, s) => searchTavily(q, m, process.env.TAVILY_API_KEY ?? '', s), keyEnv: 'TAVILY_API_KEY' }};
/** Free-engine order = preference order. ddg first: measured on a rare-term query,
 *  ddg returned the exact target while bing returned a page about the general topic and
 *  ignored the distinctive token. A wrong-but-plausible answer is worse than a failure. */
const FREE_ENGINES: Record<string, EngineFn> = {
  ddg: searchDdgHtml,
  'ddg-lite': searchDdgLite,
  searxng: searchSearxng,
  bing: searchBing,
};

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'best', 'vs', 'not', 'from', 'into', 'that', 'this', 'are', 'was', 'you', 'your', 'can', 'a', 'an', 'of', 'in', 'to', 'on']);

/**
 * A result set that shares NO token with the query is answering a different question.
 * This is the "results from another context" failure: the engine's parser returns the
 * right-looking topic and silently ignores the distinctive token, so the caller gets
 * plausible junk instead of an error. Fail loudly instead; the chain moves on.
 */
export function looksOffTopic(query: string, hits: SearchHit[]): boolean {
  const tokens = (String(query).toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
  if (tokens.length === 0) return false;
  const hay = hits.map((h) => ((h.title ?? '') + ' ' + (h.snippet ?? '') + ' ' + (h.url ?? ''))).join(' ').toLowerCase();
  return !tokens.some((t) => hay.includes(t));
}

function keyedEngineAvailable(id: string): boolean {
  return Boolean(process.env[KEYED_ENGINES[id].keyEnv]);
}

function engineChain(preferred: string | undefined): string[] {
  const order: string[] = [];
  const push = (id: string) => { if (!order.includes(id)) order.push(id); };
  if (preferred) push(preferred);
  // keyed engines first (when their key exists), then free engines
  for (const id of Object.keys(KEYED_ENGINES)) if (keyedEngineAvailable(id)) push(id);
  for (const id of Object.keys(FREE_ENGINES)) push(id);
  return order;
}

/**
 * Run one search with fallback chain. Returns normalized result + which engine served it.
 */
export async function runSearchChain(req: SearchRequest, cfg: SearchConfig, signal?: AbortSignal): Promise<WebSearchOut> {
  const query = String(req.query ?? '').trim();
  if (!query) throw new Error('query is required');
  const maxResults = Math.min(Math.max(Number(req.maxResults) || 5, 1), 20);
  const tr = parseTimeRange(req.timeRange);
  const timeLabel = tr?.label ?? '';
  const preferred = typeof req.engine === 'string' && SEARCH_ENGINES.includes(req.engine as SearchEngine)
    ? req.engine
    : cfg.provider && SEARCH_ENGINES.includes(cfg.provider as SearchEngine)
      ? cfg.provider
      : undefined;

  const cacheTtlMs = (Math.min(Math.max(Number(req.cacheTtl ?? cfg.cacheTtl ?? 5), 0), 5)) * 60 * 1000;
  const cacheEnabled = req.cache !== false && cfg.cache !== false && cacheTtlMs > 0;
  const key = cacheEnabled ? cacheKey(query, maxResults, preferred ?? 'auto', timeLabel) : null;
  if (key) {
    const hit = cacheGet(key);
    if (hit) return { ...hit, note: (hit.note ?? '') + ' [cache hit]' };
  }

  const chain = engineChain(preferred);
  const errors: string[] = [];
  // Best of the rejected sets: returning nothing is worse than returning something labelled.
  let offTopicBest: { id: string; sources: SearchHit[] } | null = null;
  for (const id of chain) {
    try {
      let sources: SearchHit[];
      if (KEYED_ENGINES[id]) {
        if (!keyedEngineAvailable(id)) { errors.push(id + ': missing ' + KEYED_ENGINES[id].keyEnv); continue; }
        sources = await KEYED_ENGINES[id].fn(query, maxResults, cfg, signal, tr ?? undefined);
      } else {
        sources = await FREE_ENGINES[id](query, maxResults, cfg, signal, tr ?? undefined);
      }
      if (sources.length === 0) { errors.push(id + ': 0 results'); continue; }
      if (looksOffTopic(query, sources)) {
        errors.push(id + ': ' + sources.length + ' results share no query token (off-topic)');
        if (offTopicBest == null) offTopicBest = { id, sources };
        continue;
      }
      const out: WebSearchOut = {
        sources,
        engine: id,
        note: id === preferred || !preferred ? undefined : 'preferred "' + preferred + '" failed, fell back to "' + id + '"' + (errors.length ? ' (' + errors.join('; ') + ')' : '')};
      if (key) {
        // fallback hits get 1/5 TTL so the preferred engine recovers quickly
        cacheSet(key, out, id === preferred || !preferred ? cacheTtlMs : Math.max(Math.round(cacheTtlMs / 5), 1000));
      }
      return out;
    } catch (e) {
      errors.push(id + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  if (offTopicBest != null) {
    const best: WebSearchOut = {
      sources: offTopicBest.sources,
      engine: offTopicBest.id,
      note: 'WARNING: no engine returned on-topic results (none shared a query token); best-effort from "' + offTopicBest.id + '". Tried: ' + errors.join(' | '),
    };
    if (key) cacheSet(key, best, Math.max(Math.round(cacheTtlMs / 5), 1000));
    return best;
  }
  throw new Error('all search engines failed: ' + errors.join(' | '));
}

/**
 * The WebSearchProvider registered on ctx.web.
 * Accepts the official WebSearchRequest (query/maxResults) plus optional
 * extensions (engine/timeRange/cache) passed through by the seam.
 */
export function createWebSearchProvider(cfg: () => SearchConfig): {
  id: string;
  available(): boolean;
  search(request: SearchRequest, signal?: AbortSignal): Promise<{ content?: string; sources: SearchHit[]; truncated: boolean }>;
} {
  return {
    id: 'dsh-search',
    available() { return true; },
    async search(request, signal) {
      const out = await runSearchChain(request, cfg(), signal);
      return { content: out.content, sources: out.sources, truncated: false };
    }};
}

/** platform_search tool: explicit engine control + time filtering + engine notes. */
export function registerPlatformSearchTool(ctx: any, cfg: () => SearchConfig): void {
  ctx.tools.register(defineTool({
    name: 'platform_search',
    description: 'Web search with explicit engine control (dsh-search v0.4). Engines: bing, ddg, ddg-lite, searxng (free, no key); exa, tavily (require EXA_API_KEY / TAVILY_API_KEY). Unknown or failed engines fall back automatically with a note. timeRange filters results (day/week/month/year). Returns citeable sources.',
    parameters: {
      query: { type: 'string', required: true, description: 'search query' },
      engine: { type: 'string', description: 'engine override: bing | ddg | ddg-lite | searxng | exa | tavily (default: auto)' },
      maxResults: { type: 'number', description: 'max results (default 5, max 20)' },
      timeRange: { type: 'string', description: 'time filter: "day" | "week" | "month" | "year" or "3d"/"2w"/"1m"' }},
    // The host validates tool schemas and aborts the plugin tree on a bad one:
    // `type: 'json'` is not a JSON-schema type, and an object schema must declare
    // `additionalProperties` explicitly.
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 60000,
    async execute(args: any) {
      const out = await runSearchChain({
        query: String(args?.query ?? ''),
        maxResults: Number(args?.maxResults) || 5,
        engine: args?.engine ? String(args.engine) : undefined,
        timeRange: args?.timeRange ? String(args.timeRange) : undefined}, cfg());
      return {
        engine: out.engine,
        ...(out.note ? { note: out.note } : {}),
        sources: out.sources};
    }}));
}

/** Register the ctx.web search provider; takes over when none configured. */
export function registerWebProvider(ctx: any, cfg: () => SearchConfig): void {
  // 姿势对齐 dsh-free-search / dsh-web-search-deepseek：apply 时直接注册，
  // 时机由模块级 export inject = ["web"] 交给 loader（等 web 服务就绪后才 apply）。
  // 不要用 ctx.inject(['web'], ...)——"web" 不是 cordis service（settings/webServer 才是），
  // 回调永远不会触发，导致 provider 未注册（"configured web provider ... is not registered"）。
  if (!ctx.web || typeof ctx.web.registerSearchProvider !== 'function') {
    console.warn('[dsh-search] ctx.web.registerSearchProvider unavailable (ctx.web=' + !!ctx.web + '), provider NOT registered');
    return;
  }
  console.log('[dsh-search] registering provider dsh-search');
  const disposer = ctx.web.registerSearchProvider(createWebSearchProvider(cfg));
  console.log('[dsh-search] provider registered OK');
  try {
    if (!ctx.web.searchProviderId) {
      ctx.web.searchProviderId = 'dsh-search';
    }
  } catch { /* runtime override not supported on this version */ }
  try {
    if (typeof ctx.onDispose === 'function') {
      ctx.onDispose(() => { try { disposer(); } catch { /* noop */ } });
    }
  } catch { /* onDispose requires inject on some hosts; registration already succeeded */ }
}
