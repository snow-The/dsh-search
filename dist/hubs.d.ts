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
export interface HubHit {
    id: string;
    title: string;
    url: string;
    detail: string;
}
export interface HubResult {
    kind: HubKind;
    query: string;
    hits: HubHit[];
    error?: string;
    note?: string;
}
/** 1081206403 -> "1.0 GB". Sizes are how you avoid downloading a 40 GB mistake. */
export declare function humanBytes(n: unknown): string;
export declare function humanCount(n: unknown): string;
export declare function mapHfModel(m: Record<string, unknown>): HubHit;
export declare function mapHfDataset(m: Record<string, unknown>): HubHit;
export declare function mapKaggleDataset(d: Record<string, unknown>): HubHit;
/**
 * HuggingFace treats `search=` as AND across every term: "bge" -> 3 hits, "bge embedding" -> 3 hits,
 * but "bge embedding zh" -> 0, because no model id contains "zh". A model that gets 0 back concludes
 * "the hub has nothing", which is false. Dropping the last term is a guess, so the retry is LABELLED
 * -- an unlabelled relaxed search would be a silent lie about what was asked.
 */
export declare function relaxQuery(query: string): string | null;
export declare function hubSearch(kind: HubKind, query: string, limit?: number): Promise<HubResult>;
