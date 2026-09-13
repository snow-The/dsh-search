/**
 * arxiv.ts — arXiv API client for dsh-search.
 * Wraps https://export.arxiv.org/api/query (Atom XML) with zero dependencies.
 *
 * Query syntax (arXiv search_query):
 *   field prefixes: all:  ti:  au:  abs:  cat:  (e.g. ti:"drift field")
 *   boolean: AND OR ANDNOT
 *   phrase: "quoted phrase"
 *   examples:
 *     all:"mean-shift" AND all:"representation learning"
 *     au:"Chen" AND cat:cs.LG AND all:embedding
 *     ti:diffusion AND abs:distillation
 */

export interface ArxivPaper {
  id: string;          // arXiv id incl. version, e.g. "2602.04770v2"
  title: string;
  published: string;   // YYYY-MM-DD
  updated: string;
  authors: string[];
  categories: string[];
  summary: string;     // full abstract
  pdfUrl: string;
}

export interface ArxivQueryResult {
  query: string;
  papers: ArxivPaper[];
  total?: number;
  error?: string;
  /** Which source actually answered. A fallback result must never look like an arXiv result. */
  source?: 'arxiv' | 'openalex' | 'core';
  note?: string;
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { openAlexSearch } from './openalex.js';
import { coreSearch } from './core.js';

const API = 'https://export.arxiv.org/api/query';
// A descriptive UA is what info.arxiv.org asks for, and it is what an operator sees before deciding
// to block the IP.
const UA = 'dsh-search/0.5 (local research agent; arxiv api client; +https://info.arxiv.org/help/api/)';

/**
 * arXiv documents a rate limit of ~1 request per 3 seconds and says exceeding it gets the IP
 * TEMPORARILY BLOCKED. A module-level `lastCall` only serialises ONE process: the main agent, a
 * subagent and a headless run each load their own copy and fire together, which is exactly how a
 * polite 4-query batch still ends up as a burst. The gate therefore lives on disk, shared by every
 * dsh process on the machine.
 */
const MIN_GAP_MS = 3100;
const THROTTLE_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.arxiv-throttle');
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
async function throttle() {
  for (;;) {
    let last = 0;
    try { last = Number(readFileSync(THROTTLE_FILE, 'utf8')) || 0; } catch { last = 0; }
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  try { mkdirSync(dirname(THROTTLE_FILE), { recursive: true }); writeFileSync(THROTTLE_FILE, String(Date.now())); } catch { /* pacing is best-effort */ }
}

/**
 * Repeated identical queries are the norm (an agent retries, two tools ask the same thing), so memo
 * the answers for a few minutes. Every cached hit is one request the API never sees -- the cheapest
 * possible way to stay under a rate limit.
 */
const RESULT_TTL_MS = 10 * 60 * 1000;
const MEMO_MAX = 60;
const memo = new Map<string, { at: number; value: ArxivQueryResult }>();

/** Retry-After is the server telling us exactly how long to wait; ignoring it is how a soft limit
 *  turns into a block. Values are seconds per RFC 9110 (arXiv sends seconds when it sends it). */
/** Exported for tests: the gate is what keeps the IP unblocked, so it must be verifiable. */
export const __arxivInternals = {
  throttle,
  MIN_GAP_MS,
  THROTTLE_FILE,
};

export function parseRetryAfter(header: string | null): number {
  const n = Number(String(header ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.min(n * 1000, 60000) : 0;
}

/** Parse Atom feed into papers. Regex-based; the Atom layout is regular enough. */
export function parseAtom(xml: string): ArxivPaper[] {
  const out: ArxivPaper[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const grab = (tag: string) => {
      const mm = e.match(new RegExp('<[a-z]*:' + tag + '>([\\s\\S]*?)<\/[a-z]*:' + tag + '>'));
      return mm ? mm[1].trim() : '';
    };
    const idFull = grab('id');
    const id = idFull.split('/abs/').pop() ?? '';
    const title = grab('title').replace(/\s+/g, ' ').trim();
    const summary = grab('summary').replace(/\s+/g, ' ').trim();
    const published = grab('published').slice(0, 10);
    const updated = grab('updated').slice(0, 10);
    const authors = [...e.matchAll(/<author>([\s\S]*?)<\/author>/g)].map((am) => {
      const nm = am[1].match(/<name>([\s\S]*?)<\/name>/);
      return nm ? nm[1].trim() : '';
    });
    const categories = [...e.matchAll(/<category term="([^"]*)"\/>/g)].map((cm) => cm[1]);
    if (!id || !title) continue;
    out.push({ id, title, summary, published, updated, authors, categories, pdfUrl: 'https://arxiv.org/pdf/' + id.replace(/v\d+$/, '') });
  }
  return out;
}

export interface ArxivSearchOpts {
  maxResults?: number; // 1..100 (default 5)
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate';
  start?: number;
}

/** Single arXiv query. */
export async function arxivSearch(query: string, opts: ArxivSearchOpts = {}): Promise<ArxivQueryResult> {
  const params = new URLSearchParams({
    search_query: query,
    start: String(opts.start ?? 0),
    max_results: String(Math.max(1, Math.min(opts.maxResults ?? 5, 100))),
    sortBy: opts.sortBy ?? 'relevance',
    sortOrder: 'descending',
  });
  const key = params.toString();
  const hit = memo.get(key);
  if (hit != null && Date.now() - hit.at < RESULT_TTL_MS) return { ...hit.value, note: hit.value.note ?? 'cached' };

  // arXiv answers a burst with 429/503 and a 14-byte body ("Rate exceeded."), then stops answering
  // entirely for a while. Three attempts with real backoff, and when the server sends Retry-After we
  // wait exactly that long: ignoring it is how a soft limit becomes a block.
  const delays = [0, 4000, 12000];
  let lastError = '';
  let serverAskedWait = 0;
  for (let i = 0; i < delays.length; i++) {
    const wait = Math.max(delays[i], i > 0 ? serverAskedWait : 0);
    if (wait > 0) await sleep(wait);
    serverAskedWait = 0;
    try {
      await throttle();
      const res = await fetch(API + '?' + params.toString(), {
        headers: { 'User-Agent': UA, Accept: 'application/atom+xml' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status === 503) {
        serverAskedWait = parseRetryAfter(res.headers.get('retry-after'));
        lastError = 'HTTP ' + res.status + ' (arXiv rate limit: at most one request per 3s, and a'
          + ' burst gets the IP temporarily blocked)'
          + (serverAskedWait ? '; server asked to wait ' + Math.round(serverAskedWait / 1000) + 's' : '');
        continue;
      }
      if (!res.ok) return { query, papers: [], error: 'HTTP ' + res.status };
      const xml = await res.text();
      const totalM = xml.match(/opensearch:totalResults>([0-9]+)</);
      const value: ArxivQueryResult = { query, papers: parseAtom(xml), total: totalM ? Number(totalM[1]) : undefined };
      if (memo.size >= MEMO_MAX) { const oldest = memo.keys().next().value; if (oldest !== undefined) memo.delete(oldest); }
      memo.set(key, { at: Date.now(), value });
      return value;
    } catch (err) {
      lastError = String((err as Error).message ?? err);
    }
  }
  return { query, papers: [], error: lastError || 'unknown failure' };
}

/**
 * Batch query with arXiv-mandated throttling between calls.
 * Keeps per-query results separate so the caller can group by cluster.
 */
export async function arxivSearchBatch(queries: string[], opts: ArxivSearchOpts = {}): Promise<ArxivQueryResult[]> {
  const out: ArxivQueryResult[] = [];
  for (const q of queries) {
    const r = await arxivSearch(q, opts);
    out.push({ ...r, source: 'arxiv' });
  }
  // Every query failed -> the API is unreachable (blocked, throttled, or hanging). Fall back to a
  // source that answers, and SAY SO: a result that came from somewhere else must never be
  // presented as an arXiv result.
  // Tier 2: OpenAlex (verified here: HTTP 200 with no key, tight relevance, abstracts included).
  if (out.length > 0 && out.every((r) => r.error != null)) {
    const alt: ArxivQueryResult[] = [];
    for (const q of queries) {
      const r = await openAlexSearch(q, { maxResults: opts.maxResults });
      alt.push({ ...r, source: 'openalex', note: 'arXiv API unreachable; served by OpenAlex' });
    }
    if (alt.some((r) => r.papers.length > 0)) return alt;

    // Tier 3: CORE (2.6e8 open-access documents, no key). Last on purpose -- it is a full-text
    // index and its relevance is loose, so breadth is only worth having after precision failed.
    const third: ArxivQueryResult[] = [];
    for (const q of queries) {
      const r = await coreSearch(q, { maxResults: opts.maxResults });
      third.push({ ...r, source: 'core', note: 'arXiv + OpenAlex unreachable; served by CORE' });
    }
    if (third.some((r) => r.papers.length > 0)) return third;
  }
  return out;
}

/**
 * Build the citable link. The FIRST live fallback run printed https://arxiv.org/abs/10.1145/... —
 * an arXiv URL wrapped around a DOI, i.e. a link that 404s while looking perfectly plausible.
 * The URL must follow the id, not the tool name.
 */
export function paperUrl(id: string, source?: string): string {
  const s = String(id ?? '').trim();
  if (/^10\.\d{4,}/.test(s)) return 'https://doi.org/' + s;
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) return 'https://arxiv.org/abs/' + s;
  if (source === 'openalex') return 'https://openalex.org/' + s;
  if (source === 'core') return 'https://core.ac.uk/works/' + s;
  return 'https://arxiv.org/abs/' + s;
}

/** Format papers as compact text (for the search_arxiv tool output). */
export function formatPapers(r: ArxivQueryResult, summaryChars = 280): string {
  const label = r.source === 'openalex' ? 'OpenAlex (arXiv fallback)' : r.source === 'core' ? 'CORE (arXiv fallback)' : 'arXiv';
  const head = label + ': ' + r.query + (r.total !== undefined ? '  (total ' + r.total + ')' : '') + (r.note ? '  [' + r.note + ']' : '');
  if (r.error) return head + '\nERROR: ' + r.error;
  if (!r.papers.length) return head + '\nNo results.';
  const lines = [head, ''];
  for (const p of r.papers) {
    lines.push('▪ [' + p.id + '] ' + p.title + '  (' + p.published + ')');
    if (p.authors.length) lines.push('  ' + p.authors.slice(0, 4).join(', ') + (p.authors.length > 4 ? ' et al.' : ''));
    if (p.categories.length) lines.push('  cat: ' + p.categories.slice(0, 4).join(' '));
    lines.push('  ' + paperUrl(p.id, r.source));
    lines.push('  ' + (p.summary.length > summaryChars ? p.summary.slice(0, summaryChars) + '…' : p.summary));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Batch output for the tool. A FAILED query must never be reported as "no results": arXiv answers
 * a burst with HTTP 429 and a 14-byte body, and the old caller counted papers across the batch and
 * returned "No results for any query." whenever the count was zero -- throwing away the ERROR line
 * that formatPapers had just built. The distinction between "nothing exists" and "the request
 * failed" is the difference between retrying and giving up on the question.
 */
export function formatBatch(results: ArxivQueryResult[], summaryChars = 280): string {
  const parts = results.map((r) => formatPapers(r, summaryChars));
  const papers = results.reduce((n, r) => n + r.papers.length, 0);
  const failed = results.filter((r) => r.error != null).length;
  if (papers === 0 && failed === 0) return 'No results for any query.';
  const note = failed > 0
    ? '\n\n' + failed + '/' + results.length + ' queries FAILED (see ERROR above) -- this is NOT an empty result set.'
      + ' The source was unreachable or rate-limited; retry shortly, or use a different source.'
    : '';
  return parts.join('\n\n----------\n\n') + note;
}
