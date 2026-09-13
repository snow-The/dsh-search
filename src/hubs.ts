/**
 * hubs.ts — model / dataset hub search.
 *
 * MEASURED from this machine, no credential of any kind:
 *   HuggingFace  /api/models, /api/datasets        200, ~210ms
 *   Kaggle       /api/v1/datasets/list             200, ~420ms
 *   Kaggle       /api/v1/competitions/list         401 Unauthenticated   <- the auth'd half
 *   ModelScope   /api/v1/models/<id>               200 (search paths differ; not wired yet)
 *
 * So the half that matters for picking a model or a dataset needs NO login at all. Logins only add
 * the other half (competitions, notebooks, private data), which is why nothing here requires one.
 */
export type HubKind = 'hf-models' | 'hf-datasets' | 'kaggle-datasets';

export interface HubHit { id: string; title: string; url: string; detail: string }
export interface HubResult { kind: HubKind; query: string; hits: HubHit[]; error?: string; note?: string }

const UA = 'dsh-search/0.6 (local research agent; hub client)';

/** 1081206403 -> "1.0 GB". Sizes are how you avoid downloading a 40 GB mistake. */
export function humanBytes(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return (x >= 10 || i === 0 ? Math.round(x) : x.toFixed(1)) + ' ' + units[i];
}

export function humanCount(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
}

export function mapHfModel(m: Record<string, unknown>): HubHit {
  const id = String(m.id ?? m.modelId ?? '');
  const tags = Array.isArray(m.tags) ? (m.tags as string[]).filter((t) => !t.includes(':')).slice(0, 3) : [];
  return {
    id,
    title: id,
    url: 'https://huggingface.co/' + id,
    detail: 'downloads ' + humanCount(m.downloads) + ' · likes ' + humanCount(m.likes)
      + (m.pipeline_tag ? ' · ' + String(m.pipeline_tag) : '') + (tags.length ? ' · ' + tags.join(',') : ''),
  };
}

export function mapHfDataset(m: Record<string, unknown>): HubHit {
  const id = String(m.id ?? '');
  return {
    id,
    title: id,
    url: 'https://huggingface.co/datasets/' + id,
    detail: 'downloads ' + humanCount(m.downloads) + ' · likes ' + humanCount(m.likes),
  };
}

export function mapKaggleDataset(d: Record<string, unknown>): HubHit {
  const ref = String(d.ref ?? d.id ?? '');
  const title = String(d.title ?? d.titleNullable ?? ref);
  const sub = String(d.subtitle ?? d.subtitleNullable ?? '');
  return {
    id: ref,
    title: title + (sub ? ' — ' + sub : ''),
    url: String(d.url ?? d.urlNullable ?? ('https://www.kaggle.com/datasets/' + ref)),
    detail: String(d.creatorName ?? d.creatorNameNullable ?? '?') + ' · ' + humanBytes(d.totalBytes ?? d.totalBytesNullable)
      + ' · downloads ' + humanCount(d.downloadCount) + ' · votes ' + humanCount(d.voteCount),
  };
}

/**
 * HuggingFace treats `search=` as AND across every term: "bge" -> 3 hits, "bge embedding" -> 3 hits,
 * but "bge embedding zh" -> 0, because no model id contains "zh". A model that gets 0 back concludes
 * "the hub has nothing", which is false. Dropping the last term is a guess, so the retry is LABELLED
 * -- an unlabelled relaxed search would be a silent lie about what was asked.
 */
export function relaxQuery(query: string): string | null {
  const terms = String(query ?? '').trim().split(/\s+/).filter(Boolean);
  if (terms.length < 3) return null;
  return terms.slice(0, -1).join(' ');
}

export async function hubSearch(kind: HubKind, query: string, limit = 10): Promise<HubResult> {
  const n = Math.max(1, Math.min(limit, 25));
  const q = query.trim();
  const urls: Record<HubKind, string> = {
    'hf-models': 'https://huggingface.co/api/models?limit=' + n + '&search=' + encodeURIComponent(q),
    'hf-datasets': 'https://huggingface.co/api/datasets?limit=' + n + '&search=' + encodeURIComponent(q),
    'kaggle-datasets': 'https://www.kaggle.com/api/v1/datasets/list?pageSize=' + n + '&search=' + encodeURIComponent(q),
  };
  try {
    const res = await fetch(urls[kind], { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (res.status === 401 || res.status === 403) {
      return { kind, query: q, hits: [], error: 'HTTP ' + res.status + ' — this surface needs a credential (the anonymous ones are hf-models, hf-datasets, kaggle-datasets)' };
    }
    if (!res.ok) return { kind, query: q, hits: [], error: 'HTTP ' + res.status };
    const json = await res.json();
    if (!Array.isArray(json)) return { kind, query: q, hits: [], error: 'unexpected payload' };
    const hits = json
      .map((r: Record<string, unknown>) => (kind === 'kaggle-datasets' ? mapKaggleDataset(r) : kind === 'hf-datasets' ? mapHfDataset(r) : mapHfModel(r)))
      .filter((h: HubHit) => h.id);
    if (hits.length === 0) {
      const relaxed = relaxQuery(q);
      if (relaxed != null) {
        const retry = await hubSearch(kind, relaxed, limit);
        if (retry.hits.length > 0) return { ...retry, note: 'no hits for ' + JSON.stringify(q) + '; retried with ' + JSON.stringify(relaxed) };
      }
    }
    return { kind, query: q, hits, note: 'no credential used' };
  } catch (err) {
    return { kind, query: q, hits: [], error: String((err as Error).message ?? err).slice(0, 120) };
  }
}
