/**
 * core.ts — second fallback paper source (CORE, https://core.ac.uk).
 *
 * Verified from this machine: HTTP 200 with NO key, ~2.6e8 open-access documents, abstracts and a
 * direct download URL included. It sits BEHIND OpenAlex on purpose: CORE is a full-text index and
 * its relevance is loose (a query about "context compaction in language models" returned a soil-
 * science paper about subsoil compaction). Breadth is worth having; precision comes first.
 */
import type { ArxivPaper, ArxivQueryResult } from './arxiv.js';

const API = 'https://api.core.ac.uk/v3/search/works';
const UA = 'dsh-search/0.5 (local research agent; core api client)';

interface CoreRecord {
  id?: number | string;
  title?: string | null;
  abstract?: string | null;
  yearPublished?: number | null;
  doi?: string | null;
  arxivId?: string | null;
  downloadUrl?: string | null;
  authors?: { name?: string }[] | null;
}

/** Pure mapping so it can be tested without the network. */
export function mapCoreRecord(r: CoreRecord): ArxivPaper | null {
  const title = String(r.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const doi = typeof r.doi === 'string' && r.doi ? r.doi.replace(/^https?:\/\/doi\.org\//, '') : '';
  const arxiv = typeof r.arxivId === 'string' && r.arxivId ? r.arxivId.replace(/^https?:\/\/arxiv\.org\/abs\//, '') : '';
  return {
    id: arxiv || doi || String(r.id ?? ''),
    title,
    summary: String(r.abstract ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200),
    published: r.yearPublished ? String(r.yearPublished) : '',
    updated: '',
    authors: (r.authors ?? []).map((a) => String(a?.name ?? '')).filter(Boolean),
    categories: [],
    pdfUrl: String(r.downloadUrl ?? ''),
  };
}

export async function coreSearch(query: string, opts: { maxResults?: number } = {}): Promise<ArxivQueryResult> {
  const params = new URLSearchParams({ q: query.replace(/^(all|ti|abs|au|cat):/i, ''), limit: String(Math.max(1, Math.min(opts.maxResults ?? 5, 20))) });
  try {
    const res = await fetch(API + '?' + params.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { query, papers: [], error: 'CORE HTTP ' + res.status };
    const json = (await res.json()) as { results?: CoreRecord[] };
    const papers = (json.results ?? []).map(mapCoreRecord).filter((p): p is ArxivPaper => p !== null);
    return { query, papers, total: papers.length };
  } catch (err) {
    return { query, papers: [], error: 'CORE ' + String((err as Error).message ?? err).slice(0, 90) };
  }
}
