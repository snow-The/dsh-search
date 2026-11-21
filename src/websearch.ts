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

/**
 * Raised by fetchHtmlWithRetry when the body is a refusal page. It carries only the reason;
 * the engine name is attached by the caller, which is the layer that knows it.
 */
class RefusalDetected extends Error {
  readonly why: string;
  constructor(why: string) {
    super('BLOCKED — ' + why);
    this.name = 'RefusalDetected';
    this.why = why;
  }
}

async function fetchHtmlWithRetry(url: string, signal?: AbortSignal): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchText(url, signal);
      // A refusal page is often SHORT — the measured DDG CAPTCHA body was 108 bytes. The
      // size check below would discard it as "empty response" and the caller would never
      // learn the host was refused. Refusal is checked first, and it is not retried:
      // a bot wall does not go away because you asked again.
      const refusal = detectRefusal(html);
      if (refusal) throw new RefusalDetected(refusal);
      if (html.length > 500) return html;
      lastError = new Error('empty response (' + html.length + ' bytes)');
    } catch (e) {
      if (e instanceof RefusalDetected) throw e;
      lastError = e;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError ?? new Error('fetch failed');
}

/**
 * A refusal is not an empty result set.
 *
 * Measured on this machine: DuckDuckGo answered HTTP 202 with a page whose visible text
 * was "Unfortunately, bots use DuckDuckGo too... Select all squares containing a duck",
 * and its challenge URL carried `cc=botnet`. That page parses to zero results, so the
 * chain recorded "ddg: 0 results" — indistinguishable from a query that genuinely has no
 * answers. The caller then saw a fallback engine's junk and called it "bad search quality".
 *
 * Detecting the refusal is what makes a service change visible: BLOCKED means "this host
 * is not allowed to ask", EMPTY means "the answer is nothing". They need different fixes.
 */
const REFUSAL_MARKERS: { re: RegExp; why: string }[] = [
  { re: /cc=botnet|Select all squares containing a duck/i, why: 'bot challenge (DDG botnet CAPTCHA)' },
  { re: /anubis_challenge/i, why: 'proof-of-work challenge (Anubis)' },
  { re: /unusual traffic|verify you are human|are you a robot/i, why: 'CAPTCHA wall' },
  { re: /<title>\s*(?:429|403|Access Denied|Forbidden)/i, why: 'access denied page' },
];

export function detectRefusal(html: string): string | null {
  const s = String(html);
  for (const m of REFUSAL_MARKERS) if (m.re.test(s)) return m.why;
  return null;
}

/** Thrown when an engine answered with a refusal page instead of results. */
export class EngineBlockedError extends Error {
  readonly engine: string;
  readonly why: string;
  constructor(engine: string, why: string) {
    super(engine + ': BLOCKED — ' + why);
    this.name = 'EngineBlockedError';
    this.engine = engine;
    this.why = why;
  }
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
  const blocked = detectRefusal(html);
  if (blocked) throw new EngineBlockedError('bing', blocked);
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
  const blocked = detectRefusal(html);
  if (blocked) throw new EngineBlockedError('ddg', blocked);
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
  const blocked = detectRefusal(html);
  if (blocked) throw new EngineBlockedError('ddg-lite', blocked);
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
  // Instances are asked CONCURRENTLY. Serially, nine dead instances cost 9 x 8s = 72s before
  // the engine admitted failure — measured as the dominant term in a 63s chain. Concurrently
  // the same nine cost one 8s timeout. Priority is preserved: the first instance in the list
  // that returns results wins, not the fastest one to answer.
  const params = new URLSearchParams({ q: query, format: 'json' });
  if (timeRange?.days != null) {
    const tr = { day: 'day', week: 'week', month: 'month', year: 'year' }[approximateTimeRange(timeRange.days)];
    if (tr) params.set('time_range', tr);
  }

  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  signal?.addEventListener('abort', onOuterAbort);

  const ask = async (base: string): Promise<{ base: string; hits?: SearchHit[]; err?: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const onInnerAbort = () => controller.abort();
    inner.signal.addEventListener('abort', onInnerAbort);
    try {
      const response = await fetch(base + '/search?' + params, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: controller.signal});
      if (!response.ok) return { base, err: 'HTTP ' + response.status };
      const data = (await response.json().catch(() => null)) as { results?: { url?: string; title?: string; content?: string }[] } | null;
      if (!data || !Array.isArray(data.results)) return { base, err: 'invalid JSON' };
      const hits = data.results
        .filter((r) => r.url)
        .map((r) => ({
          url: r.url!,
          ...(r.title ? { title: String(r.title) } : {}),
          ...(r.content ? { snippet: String(r.content) } : {})}));
      return hits.length > 0 ? { base, hits } : { base, err: '0 results' };
    } catch (e) {
      return { base, err: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
      inner.signal.removeEventListener('abort', onInnerAbort);
    }
  };

  const settled = new Array<{ base: string; hits?: SearchHit[]; err?: string } | undefined>(instances.length).fill(undefined);
  let pending = instances.length;
  const winner = await new Promise<{ index: number; hits: SearchHit[] } | null>((resolve) => {
    let done = false;
    const check = () => {
      if (done) return;
      for (let i = 0; i < instances.length; i += 1) {
        const s = settled[i];
        if (s === undefined) return; // a higher-priority instance is still in flight
        if (s.hits) { done = true; resolve({ index: i, hits: s.hits }); return; }
      }
      if (pending === 0) { done = true; resolve(null); }
    };
    instances.forEach((base, i) => {
      ask(base).then((s) => { settled[i] = s; pending -= 1; check(); });
    });
  });

  inner.abort();
  signal?.removeEventListener('abort', onOuterAbort);

  if (winner) return uniqueSources(winner.hits, maxResults);
  const errors = settled.filter(Boolean).map((s) => s!.base + ': ' + (s!.err ?? 'unknown'));
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
/** A site root is a directory listing, not an answer. https://arxiv.org/ answers nothing. */
export function isNavigational(url: string): boolean {
  try { const u = new URL(String(url)); return u.pathname === '/' || u.pathname === ''; } catch { return false; }
}

/**
 * CJK has no spaces, so the latin tokenizer below yields ZERO tokens for a Chinese query
 * and the guard returned false before looking at a single hit — the off-topic check was
 * silently disabled for every CJK query. Measured: "爬蟲 原理" -> 0 tokens, and the
 * results were a WPS pricing page and a Sogou IME download page.
 *
 * Overlapping bigrams are the standard cheap fix: "網路爬蟲" -> 網路, 路爬, 爬蟲. A hit
 * that shares no bigram with the query is about something else. Single-character queries
 * are left unjudged (one char is not evidence of a topic).
 */
function cjkBigrams(text: string): string[] {
  const out: string[] = [];
  // CJK Unified Ideographs + Extension A + compatibility, plus kana/hangul ranges that
  // also lack spaces. Anything outside these ranges is handled by the latin tokenizer.
  const runs = String(text).match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+/g) ?? [];
  for (const run of runs) {
    const chars = [...run];
    if (chars.length === 1) continue;
    for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i] + chars[i + 1]);
  }
  return out;
}

export function looksOffTopic(query: string, hits: SearchHit[]): boolean {
  const q = String(query).toLowerCase();
  const tokens = (q.match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
  const bigrams = cjkBigrams(q);
  // Nothing to match on in either script: the query carries no judgeable content.
  if (tokens.length === 0 && bigrams.length === 0) return false;
  const hay = (h: SearchHit) => ((h.title ?? '') + ' ' + (h.snippet ?? '') + ' ' + (h.url ?? '')).toLowerCase();
  const all = hits.map(hay).join(' ');
  const matched = tokens.filter((t) => all.includes(t));
  const matchedBigrams = bigrams.filter((b) => all.includes(b));
  // A CJK query is judged on bigrams when it has them; a mixed query must satisfy the
  // latin half too, because that half is usually the distinctive token ("dsh-search 插件").
  if (tokens.length > 0 && matched.length === 0) return true;
  if (bigrams.length > 0 && matchedBigrams.length === 0) return true;
  // Matching ONLY the ubiquitous word is not evidence of relevance. A query about "when to compact
  // agent context" came back as pages titled "什么是 arXiv" and "arXiv - 维基百科": every one of them
  // matched the single token "arxiv" and nothing else, so the old rule passed them as on-topic.
  if (tokens.length >= 3 && matched.length === 1 && hits.length > 1) {
    const word = matched[0];
    if (hits.every((h) => hay(h).includes(word))) return true;
  }
  // A set that is entirely site roots is a set of directories.
  if (hits.length > 0 && hits.every((h) => isNavigational(String(h.url ?? '')))) return true;
  return false;
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
 * The settled result of asking ONE engine. Every failure mode is a distinct variant because
 * they need different responses: BLOCKED means the host is refused (retrying is pointless),
 * EMPTY means the query has no answers, OFFTOPIC means the engine answered a different
 * question, ERROR means the transport broke.
 */
type ChainOutcome =
  | { kind: 'hit'; id: string; sources: SearchHit[] }
  | { kind: 'offtopic'; id: string; sources: SearchHit[] }
  | { kind: 'empty'; id: string }
  | { kind: 'blocked'; id: string; why: string }
  | { kind: 'error'; id: string; msg: string };

/** Ask one engine and classify the answer. Never throws: a failure is a value. */
async function runOneEngine(
  id: string,
  query: string,
  maxResults: number,
  cfg: SearchConfig,
  signal: AbortSignal | undefined,
  tr: { days?: number } | undefined,
): Promise<ChainOutcome> {
  try {
    let sources: SearchHit[];
    if (KEYED_ENGINES[id]) {
      if (!keyedEngineAvailable(id)) return { kind: 'error', id, msg: 'missing ' + KEYED_ENGINES[id].keyEnv };
      sources = await KEYED_ENGINES[id].fn(query, maxResults, cfg, signal, tr);
    } else {
      sources = await FREE_ENGINES[id](query, maxResults, cfg, signal, tr);
    }
    if (sources.length === 0) return { kind: 'empty', id };
    if (looksOffTopic(query, sources)) return { kind: 'offtopic', id, sources };
    return { kind: 'hit', id, sources };
  } catch (e) {
    // fetchHtmlWithRetry raises RefusalDetected without an engine name (it does not know
    // which engine called it); attach the name here, where it is known.
    if (e instanceof RefusalDetected) return { kind: 'blocked', id, why: e.why };
    if (e instanceof EngineBlockedError) return { kind: 'blocked', id, why: e.why };
    return { kind: 'error', id, msg: e instanceof Error ? e.message : String(e) };
  }
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
  // All engines are asked at once. Selection still follows the priority order EXACTLY: the
  // first engine in `chain` that returns an on-topic set wins, and a lower-priority answer
  // is never preferred just because it arrived sooner. What changes is the wall time when
  // several engines fail — they fail together instead of one after another.
  //
  // Measured 2026-11-16 on a throttled host: the serial chain took 63s because four engines
  // each burned their own timeout in turn. The same four failing concurrently cost one
  // timeout. On a healthy host the preferred engine answers in <1s and this returns at once,
  // so the common case does not regress.
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  signal?.addEventListener('abort', onOuterAbort);

  const outcomes = new Array<ChainOutcome | undefined>(chain.length).fill(undefined);
  let pending = chain.length;
  let decided = false;

  const decision = new Promise<{ index: number; outcome: ChainOutcome } | null>((resolve) => {
    const check = () => {
      if (decided) return;
      for (let j = 0; j < chain.length; j += 1) {
        const o = outcomes[j];
        // A higher-priority engine is still running: its answer would outrank anything
        // below it, so nothing can be decided yet.
        if (o === undefined) return;
        if (o.kind === 'hit') { decided = true; resolve({ index: j, outcome: o }); return; }
      }
      if (pending === 0) { decided = true; resolve(null); }
    };
    chain.forEach((id, i) => {
      runOneEngine(id, query, maxResults, cfg, inner.signal, tr ?? undefined).then((o) => {
        outcomes[i] = o;
        pending -= 1;
        check();
      });
    });
  });

  const won = await decision;
  // Stop the engines we no longer need. Once an answer is chosen the rest are wasted
  // requests, and on a rate-limited host wasted requests make the NEXT call worse.
  inner.abort();
  signal?.removeEventListener('abort', onOuterAbort);

  const errors: string[] = [];
  let blockedCount = 0;
  let offTopicBest: { id: string; sources: SearchHit[] } | null = null;
  for (let i = 0; i < chain.length; i += 1) {
    const o = outcomes[i];
    if (o === undefined) continue; // aborted before it settled; not evidence of anything
    if (o.kind === 'blocked') { blockedCount += 1; errors.push(o.id + ': BLOCKED — ' + o.why); }
    else if (o.kind === 'empty') errors.push(o.id + ': 0 results');
    else if (o.kind === 'error') errors.push(o.id + ': ' + o.msg);
    else if (o.kind === 'offtopic') {
      errors.push(o.id + ': ' + o.sources.length + ' results share no query token (off-topic)');
      if (offTopicBest == null) offTopicBest = { id: o.id, sources: o.sources };
    }
  }

  if (won != null && won.outcome.kind === 'hit') {
    const id = won.outcome.id;
    const out: WebSearchOut = {
      sources: won.outcome.sources,
      engine: id,
      note: id === preferred || !preferred ? undefined : 'preferred "' + preferred + '" failed, fell back to "' + id + '"' + (errors.length ? ' (' + errors.join('; ') + ')' : '')};
    if (key) {
      // fallback hits get 1/5 TTL so the preferred engine recovers quickly
      cacheSet(key, out, id === preferred || !preferred ? cacheTtlMs : Math.max(Math.round(cacheTtlMs / 5), 1000));
    }
    return out;
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
  // Name the dominant cause. "all engines failed" hides the difference between a blocked
  // host and a query with no answers, and those need different responses from the caller.
  const cause = blockedCount > 0
    ? blockedCount + ' of ' + chain.length + ' engines BLOCKED this host (refusal page, not an empty result)'
    : 'no engine returned results';
  throw new Error('all search engines failed — ' + cause + ': ' + errors.join(' | '));
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

/**
 * 真正生效的搜索后端。
 *
 * rc.2+ 的 `WebRuntime.search()` 每次调用都取 `this.config.searchProvider.get()`
 * （未配置时再用 `DSH_WEB_SEARCH_PROVIDER`），未配置则解析到唯一注册的 provider；
 * 那个私有字段 `searchProviderId` 只是 pre-rc.2 的形态。
 *
 * 所以要报告「实际是谁」必须读 config 引用，否则读到的是个不参与选择的残影。
 */
function effectiveSearchProvider(web: any): string {
  try {
    const ref = web?.config?.searchProvider;
    const v = typeof ref?.get === 'function' ? ref.get() : ref;
    if (v) return String(v);
  } catch { /* config 不可读 */ }
  try {
    if (web?.searchProviderId) return String(web.searchProviderId);
  } catch { /* noop */ }
  return String(process.env.DSH_WEB_SEARCH_PROVIDER ?? '');
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
  const disposer = ctx.web.registerSearchProvider(createWebSearchProvider(cfg));

  // 只在 pre-rc.2 的引擎上写内存字段。
  //
  // rc.2+ 的后端选择是 `config.searchProvider` 这个引用：直接写内存「能生效，但不落
  // profile —— 那个条目下一次 commit（哪怕只是改 fetchProvider）就会重新解析原始配置
  // 覆盖掉」（dsh-commandcode-provider 的 seam 文档原话）。写它是假动作，甚至会掩盖
  // 真正的选择来源。
  let hasConfigRef = false;
  try { hasConfigRef = typeof ctx.web?.config?.searchProvider?.get === 'function'; } catch { /* noop */ }
  if (!hasConfigRef) {
    try {
      if (!ctx.web.searchProviderId) ctx.web.searchProviderId = 'dsh-search';
    } catch { /* 该版本不支持运行期覆盖 */ }
  }

  // 注册成功 ≠ 生效：config 可以被别的插件或补丁层指到别家，而本插件的
  // platform_search 走自己的免费链（bing/ddg/searxng），完全不看那个字段。
  // 两条路一分岔，症状就是「搜索坏了」：
  //   2026-10-27 实例 —— searchProvider 被写成 commandcode，web_search 于是去买对方
  //   的搜索额度，用完即 400 insufficient credits；同期 platform_search 一切正常。
  //
  // 这个字段能被两处改写：本插件的 config（searchProvider）与 commandcode 插件的
  // `webSearch` 开关（默认 true）。后者会把自家 provider 选上 —— 用中转站时「默认被
  // 填成 commandcode」就是它干的。它判断的依据是 settings 行的 user 成员
  // （`row.user.searchProvider`），不是 patch 层；没有 user 行时，它把 base 当作
  // 部署默认值并接管。要挡住它，是在该插件条目上写 `webSearch: false`。
  const effective = effectiveSearchProvider(ctx.web);
  if (!effective) {
    // 未配置时运行期解析到唯一注册的 provider，也就是我们自己。
    console.log('[dsh-search] provider registered OK (web_search -> dsh-search by default)');
  } else if (effective === 'dsh-search') {
    console.log('[dsh-search] provider registered OK (web_search -> dsh-search)');
  } else {
    console.warn('[dsh-search] provider registered, but web_search routes to "' + effective + '" instead of the free local chain (bing/ddg/searxng); platform_search still uses it');
  }
  try {
    if (typeof ctx.onDispose === 'function') {
      ctx.onDispose(() => { try { disposer(); } catch { /* noop */ } });
    }
  } catch { /* onDispose requires inject on some hosts; registration already succeeded */ }
}
