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
}

const API = 'https://export.arxiv.org/api/query';
const UA = 'Mozilla/5.0 (dsh-search/0.3 arxiv)';
// arXiv politely asks for ~3s between API calls; keep a module-level throttle.
let lastCall = 0;
async function throttle() {
  const wait = lastCall + 3100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
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
  try {
    await throttle();
    const res = await fetch(API + '?' + params.toString(), {
      headers: { 'User-Agent': UA, Accept: 'application/atom+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { query, papers: [], error: 'HTTP ' + res.status };
    const xml = await res.text();
    const totalM = xml.match(/opensearch:totalResults>([0-9]+)</);
    return { query, papers: parseAtom(xml), total: totalM ? Number(totalM[1]) : undefined };
  } catch (err) {
    return { query, papers: [], error: String((err as Error).message ?? err) };
  }
}

/**
 * Batch query with arXiv-mandated throttling between calls.
 * Keeps per-query results separate so the caller can group by cluster.
 */
export async function arxivSearchBatch(queries: string[], opts: ArxivSearchOpts = {}): Promise<ArxivQueryResult[]> {
  const out: ArxivQueryResult[] = [];
  for (const q of queries) {
    const r = await arxivSearch(q, opts);
    out.push(r);
  }
  return out;
}

/** Format papers as compact text (for the search_arxiv tool output). */
export function formatPapers(r: ArxivQueryResult, summaryChars = 280): string {
  const head = 'arXiv: ' + r.query + (r.total !== undefined ? '  (total ' + r.total + ')' : '');
  if (r.error) return head + '\nERROR: ' + r.error;
  if (!r.papers.length) return head + '\nNo results.';
  const lines = [head, ''];
  for (const p of r.papers) {
    lines.push('▪ [' + p.id + '] ' + p.title + '  (' + p.published + ')');
    if (p.authors.length) lines.push('  ' + p.authors.slice(0, 4).join(', ') + (p.authors.length > 4 ? ' et al.' : ''));
    if (p.categories.length) lines.push('  cat: ' + p.categories.slice(0, 4).join(' '));
    lines.push('  https://arxiv.org/abs/' + p.id);
    lines.push('  ' + (p.summary.length > summaryChars ? p.summary.slice(0, summaryChars) + '…' : p.summary));
    lines.push('');
  }
  return lines.join('\n');
}
