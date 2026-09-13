/**
 * opensources.ts — the A-tier of the free-API list: sources that answer with NO credential at all.
 *
 * Each one was probed from this machine before being wired (see .rlab/literature/free-api-sources-
 * verified.md). They are kept as a REGISTRY rather than eight bespoke tools, because the value is
 * coverage and the shape of "search a catalogue, return some records" never changes.
 *
 * Sources that need a login (Semantic Scholar, Kaggle competitions, ModelScope search, Zenodo,
 * Lens, EPO OPS, Springer, PatentsView) are deliberately absent -- not out of caution, but because
 * a tool that silently 401s is worse than no tool.
 */
export type OpenSourceId = 'crossref' | 'europepmc' | 'pubmed' | 'figshare' | 'clinicaltrials' | 'openfda' | 'chembl';

export interface OpenHit { title: string; url: string; detail: string }
export interface OpenResult { source: OpenSourceId; query: string; hits: OpenHit[]; error?: string; note?: string }

const UA = 'dsh-search/0.6 (local research agent; open-source client)';

export const OPEN_SOURCES: Record<OpenSourceId, { label: string; docs: string }> = {
  crossref: { label: 'Crossref — DOI metadata for every registered work', docs: 'https://api.crossref.org' },
  europepmc: { label: 'Europe PMC — life-science literature + preprints, 10 rps', docs: 'https://europepmc.org/RestfulWebService' },
  pubmed: { label: 'PubMed — biomedical index (NCBI E-utilities)', docs: 'https://www.ncbi.nlm.nih.gov/books/NBK25501/' },
  figshare: { label: 'Figshare — research outputs, datasets, figures', docs: 'https://docs.figshare.com' },
  clinicaltrials: { label: 'ClinicalTrials.gov v2 — registered studies', docs: 'https://clinicaltrials.gov/data-api/api' },
  openfda: { label: 'openFDA — drug adverse-event reports', docs: 'https://open.fda.gov/apis/' },
  chembl: { label: 'ChEMBL — compounds and bioactivity', docs: 'https://www.ebi.ac.uk/chembl/api/data/docs' },
};

const enc = encodeURIComponent;
const str = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v));

/** Crossref: message.items[] */
export function mapCrossref(it: Record<string, unknown>): OpenHit {
  const doi = str(it.DOI);
  const authors = Array.isArray(it.author) ? (it.author as Record<string, unknown>[]).slice(0, 3).map((a) => [str(a.given), str(a.family)].filter(Boolean).join(' ')).filter(Boolean) : [];
  const year = str(((it.issued as Record<string, unknown>)?.['date-parts'] as number[][])?.[0]?.[0]);
  return {
    title: str(it.title) || doi,
    url: doi ? 'https://doi.org/' + doi : '',
    detail: [year, authors.join(', '), str(it.publisher), str(it.type), 'cited-by ' + str(it['is-referenced-by-count'])].filter(Boolean).join(' · '),
  };
}

/** Europe PMC: resultList.result[] */
export function mapEuropePmc(r: Record<string, unknown>): OpenHit {
  const id = str(r.id);
  const doi = str(r.doi);
  return {
    title: str(r.title) || id,
    url: doi ? 'https://doi.org/' + doi : 'https://europepmc.org/article/' + str(r.source) + '/' + id,
    detail: [str(r.pubYear), str(r.authorString), str(r.pubType), r.isOpenAccess === 'Y' ? 'open access' : '', 'cited-by ' + str(r.citedByCount)].filter(Boolean).join(' · '),
  };
}

/** Figshare: a bare array of articles. */
export function mapFigshare(r: Record<string, unknown>): OpenHit {
  const id = str(r.id);
  const doi = str(r.doi);
  return {
    title: str(r.title) || id,
    url: doi ? 'https://doi.org/' + doi : 'https://figshare.com/articles/' + id,
    detail: [String(r.published_date ?? '').slice(0, 10), str(r.defined_type_name)].filter(Boolean).join(' · '),
  };
}

/** ClinicalTrials.gov v2: studies[] */
export function mapClinicalTrial(s: Record<string, unknown>): OpenHit {
  const proto = (s.protocolSection ?? {}) as Record<string, any>;
  const nct = str(proto.identificationModule?.nctId);
  return {
    title: str(proto.identificationModule?.briefTitle) || nct,
    url: 'https://clinicaltrials.gov/study/' + nct,
    detail: [str(proto.statusModule?.overallStatus), (proto.conditionsModule?.conditions ?? []).slice(0, 3).join(', '), str(proto.designModule?.phases)].filter(Boolean).join(' · '),
  };
}

/** ChEMBL: molecules[] */
export function mapChembl(m: Record<string, unknown>): OpenHit {
  const id = str(m.molecule_chembl_id);
  const name = str(m.pref_name) || str(m.molecule_synonyms);
  const props = (m.molecule_properties ?? {}) as Record<string, unknown>;
  return {
    title: (name ? name + ' — ' : '') + id,
    url: 'https://www.ebi.ac.uk/chembl/compound_report_card/' + id + '/',
    detail: [props.full_mwt ? 'MW ' + props.full_mwt : '', props.alogp ? 'logP ' + props.alogp : '', str(m.max_phase) ? 'max phase ' + str(m.max_phase) : ''].filter(Boolean).join(' · '),
  };
}

export async function openSourceSearch(source: OpenSourceId, query: string, limit = 5): Promise<OpenResult> {
  const q = String(query ?? '').trim();
  const n = Math.max(1, Math.min(limit, 25));
  if (!q) return { source, query: q, hits: [], error: 'query required' };
  try {
    if (source === 'crossref') {
      const r = await get('https://api.crossref.org/works?rows=' + n + '&query=' + enc(q));
      const items = ((r?.message as Record<string, unknown>)?.items ?? []) as Record<string, unknown>[];
      return { source, query: q, hits: items.map(mapCrossref) };
    }
    if (source === 'europepmc') {
      const r = await get('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=' + n + '&query=' + enc(q));
      const items = ((r?.resultList as Record<string, unknown>)?.result ?? []) as Record<string, unknown>[];
      return { source, query: q, hits: items.map(mapEuropePmc) };
    }
    if (source === 'pubmed') {
      // Two calls are unavoidable: esearch returns IDS only. Titles live in esummary.
      const s = await get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=' + n + '&term=' + enc(q));
      const ids = ((s?.esearchresult as Record<string, unknown>)?.idlist ?? []) as string[];
      if (ids.length === 0) return { source, query: q, hits: [] };
      const sum = await get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + ids.join(','));
      const res = (sum?.result ?? {}) as Record<string, any>;
      const hits: OpenHit[] = ids.map((id) => {
        const rec = res[id] ?? {};
        return {
          title: str(rec.title) || id,
          url: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/',
          detail: [String(rec.pubdate ?? '').slice(0, 16), str(rec.source), str(rec.sortpubdate) ? '' : ''].filter(Boolean).join(' · '),
        };
      });
      return { source, query: q, hits, note: 'titles via esummary (' + ids.length + ' ids)' };
    }
    if (source === 'figshare') {
      const r = await get('https://api.figshare.com/v2/articles?page_size=' + n + '&search_for=' + enc(q));
      const items = (Array.isArray(r) ? r : []) as Record<string, unknown>[];
      return { source, query: q, hits: items.map(mapFigshare) };
    }
    if (source === 'clinicaltrials') {
      const r = await get('https://clinicaltrials.gov/api/v2/studies?pageSize=' + n + '&query.term=' + enc(q));
      const items = ((r?.studies ?? []) as Record<string, unknown>[]);
      return { source, query: q, hits: items.map(mapClinicalTrial) };
    }
    if (source === 'openfda') {
      const r = await get('https://api.fda.gov/drug/event.json?limit=' + n + '&search=patient.drug.medicinalproduct:' + enc('"' + q + '"'));
      const items = ((r?.results ?? []) as Record<string, unknown>[]);
      return {
        source, query: q,
        hits: items.map((x) => ({
          title: 'report ' + str(x.safetyreportid),
          url: 'https://open.fda.gov/apis/drug/event/',
          detail: [str(x.receivedate), x.serious === '1' ? 'serious' : 'non-serious', str((x.primarysource as Record<string, unknown>)?.reportercountry)].filter(Boolean).join(' · '),
        })),
      };
    }
    const r = await get('https://www.ebi.ac.uk/chembl/api/data/molecule.json?limit=' + n + '&search=' + enc(q));
    const items = ((r?.molecules ?? []) as Record<string, unknown>[]);
    return { source, query: q, hits: items.map(mapChembl) };
  } catch (err) {
    return { source, query: q, hits: [], error: String((err as Error).message ?? err).slice(0, 140) };
  }
}

async function get(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + new URL(url).host);
  return res.json();
}
