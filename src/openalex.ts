/**
 * openalex.ts — fallback paper source for dsh-search.
 *
 * Why it exists: arXiv's API answers a burst with HTTP 429 and then, if you keep asking, simply
 * stops answering — every host (export.arxiv.org, arxiv.org/api, http) timed out at 15s from this
 * machine while arxiv.org/abs/<id> HTML kept loading in 229ms. A paper tool that only knows how to
 * fail is not a tool. OpenAlex is free, needs no key, and answered the same query in 1.3s.
 *
 * Mapped into the same ArxivPaper shape so callers and formatters stay unchanged.
 */
import type { ArxivPaper, ArxivQueryResult } from './arxiv.js';

const API = 'https://api.openalex.org/works';
const UA = 'dsh-search/0.4 (mailto:noreply@example.com)';

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  ids?: Record<string, string> | null;
}

/** OpenAlex stores abstracts as an inverted index (word -> positions). Rebuild it in order. */
export function rebuildAbstract(inv: Record<string, number[]> | null | undefined, maxChars = 1200): string {
  if (inv == null || typeof inv !== 'object') return '';
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) if (Number.isInteger(p) && p >= 0) slots[p] = word;
  }
  const text = slots.filter((s) => s !== undefined).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}

/** A stable, citable id: the arXiv id when the work has one, else the DOI, else the OpenAlex id. */
export function workId(w: OpenAlexWork): string {
  const arxiv = w.ids?.arxiv;
  if (typeof arxiv === 'string' && arxiv) return arxiv.replace(/^https?:\/\/arxiv\.org\/abs\//, '');
  if (typeof w.doi === 'string' && w.doi) return w.doi.replace(/^https?:\/\/doi\.org\//, '');
  return String(w.id ?? '').replace(/^https?:\/\/openalex\.org\//, '');
}

export async function openAlexSearch(query: string, opts: { maxResults?: number } = {}): Promise<ArxivQueryResult> {
  const params = new URLSearchParams({
    search: query.replace(/^(all|ti|abs|au|cat):/i, ''),
    'per-page': String(Math.max(1, Math.min(opts.maxResults ?? 5, 25))),
    select: 'id,doi,title,publication_year,authorships,abstract_inverted_index,ids',
  });
  try {
    const res = await fetch(API + '?' + params.toString(), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { query, papers: [], error: 'OpenAlex HTTP ' + res.status };
    const json = (await res.json()) as { results?: OpenAlexWork[] };
    const papers: ArxivPaper[] = (json.results ?? [])
      .filter((w) => String(w.title ?? '').trim().length > 0)
      .map((w) => ({
        id: workId(w),
        title: String(w.title).replace(/\s+/g, ' ').trim(),
        summary: rebuildAbstract(w.abstract_inverted_index),
        published: w.publication_year ? String(w.publication_year) : '',
        updated: '',
        authors: (w.authorships ?? []).map((a) => String(a.author?.display_name ?? '')).filter(Boolean),
        categories: [],
        pdfUrl: '',
      }));
    return { query, papers, total: papers.length };
  } catch (err) {
    return { query, papers: [], error: 'OpenAlex ' + String((err as Error).message ?? err).slice(0, 90) };
  }
}
