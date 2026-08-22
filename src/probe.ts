/**
 * dsh-search probe — deep-web / forum / feed mining.
 * The 'probe' layer digs where search engines cannot reach:
 *  - RSSHub-compatible feed aggregation (public https://rsshub.app or
 *    self-hosted DSH_SEARCH_RSSHUB_URL). Zero code copied from RSSHub —
 *    we only consume its HTTP API (RSS/Atom output), so AGPL-3.0 is a non-issue.
 *  - Forum search endpoints (phpBB / XenForo / Flarum / Discourse / vBulletin)
 *  - Reddit JSON API + Hacker News Algolia API (keyless, rate-limit friendly)
 *  - sitemap.xml discovery, Disqus public API, relatedSearches consumption
 *  - URL normalization + dedupe cache so the same page is never mined twice
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';

// ---------- precompiled regexes ----------
const RE_ITEM = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi;
const RE_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const RE_LINK = /<link[^>]*href=["']([^"']+)["'][^>]*\/?>|<link[^>]*>([\s\S]*?)<\/link>/gi;
const RE_DESC = /<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i;
const RE_DATE = /<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i;
const RE_GUID = /<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i;
const RE_HTML_TAG = /<[^>]+>/g;
const RE_WS = /\s+/g;
const RE_RSS_ALT = /<link[^>]*rel=["']alternate["'][^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i;
const RE_RSS_ALT2 = /<link[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i;
const RE_SITEMAP = /<loc>([\s\S]*?)<\/loc>/gi;
const RE_SITEMAP_INDEX = /<sitemap>([\s\S]*?)<\/sitemap>/gi;

// ---------- feed parsing (dependency-free RSS 2.0 + Atom) ----------
export interface FeedItem {
  title: string;
  link: string;
  description: string;
  date?: string;
  id?: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCodePoint(Number(n)))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function firstMatch(re: RegExp, s: string): string {
  const m = re.exec(s);
  return m ? decodeXml(m[1]).replace(RE_HTML_TAG, ' ').replace(RE_WS, ' ').trim() : '';
}

function extractFirstLink(block: string): string {
  let m: RegExpExecArray | null;
  RE_LINK.lastIndex = 0;
  while ((m = RE_LINK.exec(block)) !== null) {
    const href = m[1] ?? m[2] ?? '';
    if (href && !href.startsWith('{')) return decodeXml(href).trim();
  }
  return '';
}

export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  let m: RegExpExecArray | null;
  RE_ITEM.lastIndex = 0;
  while ((m = RE_ITEM.exec(xml)) !== null) {
    const block = m[0];
    const link = extractFirstLink(block);
    if (!link) continue;
    out.push({
      title: firstMatch(RE_TITLE, block) || '(untitled)',
      link,
      description: firstMatch(RE_DESC, block),
      date: firstMatch(RE_DATE, block),
      id: firstMatch(RE_GUID, block) || undefined,
    });
  }
  return out;
}
// ---------- URL normalization + dedupe ----------
export function normalizeUrl(raw: string): string {
  let u = String(raw).trim();
  try {
    const p = new URL(u);
    p.hash = '';
    for (const k of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','fbclid','gclid']) p.searchParams.delete(k);
    u = p.href.replace(/\/$/, '');
  } catch { /* keep raw */ }
  return u;
}

export class SeenCache {
  private db: DatabaseSync;
  constructor(dir = join(homedir(), '.dsh', 'dsh-search-cache')) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, 'seen.sqlite'));
    this.db.exec('CREATE TABLE IF NOT EXISTS seen (url TEXT PRIMARY KEY, first_seen INTEGER)');
  }
  /** true if the URL was already mined */
  seen(url: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM seen WHERE url = ?').get(normalizeUrl(url)) as any;
    return !!row;
  }
  mark(url: string): void {
    this.db.prepare('INSERT OR IGNORE INTO seen (url, first_seen) VALUES (?, ?)').run(normalizeUrl(url), Date.now());
  }
  clear(): void { this.db.exec('DELETE FROM seen'); }
  close(): void { this.db.close(); }
}

// ---------- fetch helpers ----------
async function getText(url: string, headers: Record<string, string> = {}, timeoutMs = 20000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (dsh-search-probe)', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? '';
  const m = /charset=([\w-]+)/i.exec(ct);
  return m ? new TextDecoder(m[1] === 'utf8' ? 'utf-8' : m[1]).decode(buf) : buf.toString('utf-8');
}

// ---------- RSSHub compatibility layer ----------
const RSSHUB_DEFAULT = 'https://rsshub.app';

export function rsshubBase(): string {
  return (process.env.DSH_SEARCH_RSSHUB_URL ?? RSSHUB_DEFAULT).replace(/\/$/, '');
}

/**
 * Fetch a feed (RSS/Atom) from a URL — either a raw feed URL or an RSSHub route.
 * A bare route like 'reddit/user/DIYgod' is prefixed with the RSSHub base.
 */
export async function fetchFeed(feedUrl: string, limit = 20): Promise<{ source: string; items: FeedItem[] }> {
  let url = feedUrl;
  if (!/^https?:\/\//i.test(url)) {
    url = rsshubBase() + (url.startsWith('/') ? url : '/' + url);
  }
  const xml = await getText(url, { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' });
  return { source: url, items: parseFeed(xml).slice(0, limit) };
}

/**
 * Discover the feed URL of a site by scanning its HTML for <link rel=alternate type=application/rss+xml>.
 */
export async function discoverFeed(siteUrl: string): Promise<string | null> {
  const html = await getText(siteUrl, {}, 12000);
  const m = RE_RSS_ALT.exec(html) ?? RE_RSS_ALT2.exec(html);
  if (!m) return null;
  try { return new URL(m[1], siteUrl).href; } catch { return m[1]; }
}
// ---------- Reddit + HN (keyless public APIs) ----------
export async function redditSearch(q: string, subreddit?: string, limit = 10): Promise<FeedItem[]> {
  const sub = subreddit ? '/r/' + subreddit : '';
  const url = 'https://www.reddit.com' + sub + '/search.json?q=' + encodeURIComponent(q) + '&limit=' + limit + '&sort=relevance&t=all&raw_json=1';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'dsh-search-probe/0.1 (local)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('Reddit HTTP ' + res.status);
  const data = await res.json();
  const kids: any[] = data?.data?.children ?? [];
  return kids.map((k: any) => {
    const d = k.data ?? {};
    return {
      title: d.title ?? '',
      link: 'https://www.reddit.com' + (d.permalink ?? ''),
      description: (d.selftext ?? '').slice(0, 600),
      date: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
      id: d.id ?? undefined,
    };
  }).filter((i: FeedItem) => i.title);
}

export async function hnSearch(q: string, limit = 10): Promise<FeedItem[]> {
  const url = 'https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(q) + '&hitsPerPage=' + limit;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HN HTTP ' + res.status);
  const data = await res.json();
  const hits: any[] = data?.hits ?? [];
  return hits.map((h: any) => ({
    title: h.title ?? h.story_title ?? '',
    link: h.url ?? 'https://news.ycombinator.com/item?id=' + h.objectID,
    description: (h.comment_text ?? h.story_text ?? '').replace(RE_HTML_TAG, ' ').replace(RE_WS, ' ').slice(0, 600),
    date: h.created_at ?? undefined,
    id: h.objectID ?? undefined,
  })).filter((i: FeedItem) => i.title);
}

// ---------- sitemap.xml ----------
export async function sitemapUrls(sitemapUrl: string, max = 50): Promise<string[]> {
  const xml = await getText(sitemapUrl, {}, 15000);
  const out: string[] = [];
  if (RE_SITEMAP_INDEX.test(xml)) {
    RE_SITEMAP_INDEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_SITEMAP_INDEX.exec(xml)) !== null && out.length < max) {
      const inner = m[1].match(/<loc>([\s\S]*?)<\/loc>/i);
      if (inner) out.push(decodeXml(inner[1]).trim());
    }
  } else {
    RE_SITEMAP.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_SITEMAP.exec(xml)) !== null && out.length < max) out.push(decodeXml(m[1]).trim());
  }
  return out;
}

// ---------- forum deep mining ----------
export interface ForumSpec {
  name: string;
  searchUrl: (base: string, q: string) => string;
  resultSel: RegExp;
}

const FORUM_PLATFORMS: ForumSpec[] = [
  { name: 'phpBB', searchUrl: (b, q) => b + '/search.php?keywords=' + encodeURIComponent(q), resultSel: /href=["']([^"']*?viewtopic[^"']*?)["']/gi },
  { name: 'XenForo', searchUrl: (b, q) => b + '/search/?q=' + encodeURIComponent(q), resultSel: /href=["']([^"']*?threads\/[^"']*?)["']/gi },
  { name: 'Flarum', searchUrl: (b, q) => b + '/?q=' + encodeURIComponent(q), resultSel: /href=["']([^"']*?d\/\d+[^"']*?)["']/gi },
  { name: 'Discourse', searchUrl: (b, q) => b + '/search?q=' + encodeURIComponent(q), resultSel: /href=["']([^"']*?t\/[^"']*?)["']/gi },
  { name: 'vBulletin', searchUrl: (b, q) => b + '/search.php?do=process&query=' + encodeURIComponent(q), resultSel: /href=["']([^"']*?showthread[^"']*?)["']/gi },
];

/**
 * Probe a forum for search results via platform-specific search endpoints.
 * Returns mined thread links — the caller decides what to fetch.
 */
export async function probeForum(baseUrl: string, q: string): Promise<{ platform: string; links: string[] }> {
  const base = baseUrl.replace(/\/$/, '');
  for (const spec of FORUM_PLATFORMS) {
    try {
      const html = await getText(spec.searchUrl(base, q), {}, 15000);
      const links: string[] = [];
      let m: RegExpExecArray | null;
      spec.resultSel.lastIndex = 0;
      while ((m = spec.resultSel.exec(html)) !== null) {
        try { links.push(normalizeUrl(new URL(m[1], base).href)); } catch { /* skip */ }
      }
      if (links.length) return { platform: spec.name, links: [...new Set(links)].slice(0, 15) };
    } catch { /* try next platform */ }
  }
  return { platform: 'unknown', links: [] };
}

// ---------- Disqus public API ----------
export async function disqusRecent(forum: string, limit = 10): Promise<FeedItem[]> {
  const url = 'https://disqus.com/api/3.0/forums/listThreads.json?forum=' + encodeURIComponent(forum) + '&limit=' + limit + '&order=desc';
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('Disqus HTTP ' + res.status);
  const data = await res.json();
  const resp: any[] = data?.response ?? [];
  return resp.map((t: any) => ({
    title: t.title ?? '',
    link: t.link ?? '',
    description: (t.message ?? '').slice(0, 600),
    date: t.createdAt ?? undefined,
    id: t.id ?? undefined,
  })).filter((i: FeedItem) => i.title && i.link);
}

// ---------- relatedSearches consumption ----------
// Mine adjacent query space from DDG SERP so the deep loop can branch.
export async function relatedSearches(q: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const html = await getText(url, {}, 15000);
    const re = /class=["']result-link["'][^>]*href=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const u = new URL(decodeXml(m[1]), url).href;
        const qp = u.includes('?') ? (new URL(u).searchParams.get('q') ?? '') : '';
        if (qp && qp.length > 2 && qp.length < 80) out.add(qp);
      } catch { /* skip */ }
    }
  } catch { /* offline ok */ }
  return [...out].slice(0, 8);
}

// ---------- unified probe entry ----------
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
export async function probeAll(
  q: string,
  opts: { targets?: string; forumBase?: string; subreddit?: string; maxPerSource?: number } = {},
): Promise<ProbeResult> {
  const max = opts.maxPerSource ?? 10;
  const targets = (opts.targets ?? 'all').split(',').map((s) => s.trim());
  const want = (t: string) => targets.includes('all') || targets.includes(t);
  const sources: ProbeSource[] = [];
  const seen = new SeenCache();
  const tasks: Promise<void>[] = [];
  const guard = (kind: string, label: string, p: Promise<FeedItem[]>, mark = true) => {
    tasks.push(p.then((items) => {
      if (mark) items.forEach((i) => i.link && seen.mark(i.link));
      sources.push({ kind, label, items });
    }).catch((e: any) => { sources.push({ kind, label, items: [], error: String(e?.message ?? e) }); }));
  };
  if (want('hn')) guard('hn', 'Hacker News (Algolia)', hnSearch(q, max));
  if (want('reddit')) guard('reddit', opts.subreddit ? 'Reddit r/' + opts.subreddit : 'Reddit', redditSearch(q, opts.subreddit, max));
  if (want('forum') && opts.forumBase) {
    tasks.push(probeForum(opts.forumBase, q).then(({ platform, links }) => {
      links.forEach((l) => seen.mark(l));
      sources.push({ kind: 'forum', label: 'Forum (' + platform + ')', items: links.map((link) => ({ title: link, link, description: '' })) });
    }).catch((e: any) => { sources.push({ kind: 'forum', label: 'Forum', items: [], error: String(e?.message ?? e) }); }));
  }
  await Promise.all(tasks);
  const dedupedLinks: string[] = [];
  for (const s of sources) for (const i of s.items) {
    const n = normalizeUrl(i.link);
    if (n && !seen.seen(n)) { seen.mark(n); dedupedLinks.push(n); }
  }
  seen.close();
  return { sources, dedupedLinks };
}