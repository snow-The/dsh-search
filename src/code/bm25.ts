/**
 * BM25 inverted index with incremental document updates. Ported from semble
 * index/bm25.py (K1=1.5, B=0.75). Chunk ids are 'path:slot'.
 */

const K1 = 1.5;
const B = 0.75;

export class BM25 {
  private docs = new Map<string, Map<string, number>>();
  private lengths = new Map<string, number>();
  private totalLen = 0;
  private postings = new Map<string, Map<string, number>>();
  private positions = new Map<string, number>();
  docOrder: string[] = [];

  addDocument(id: string, tokens: string[]): void {
    if (this.docs.has(id)) throw new Error('chunk already indexed: ' + id);
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    this.docs.set(id, counts);
    this.lengths.set(id, tokens.length);
    this.totalLen += tokens.length;
    for (const [term, n] of counts) {
      let p = this.postings.get(term);
      if (!p) { p = new Map(); this.postings.set(term, p); }
      p.set(id, n);
    }
  }

  removeDocument(id: string): void {
    const counts = this.docs.get(id);
    if (!counts) return;
    this.totalLen -= this.lengths.get(id) ?? 0;
    this.docs.delete(id);
    this.lengths.delete(id);
    for (const term of counts.keys()) {
      const p = this.postings.get(term);
      if (!p) continue;
      p.delete(id);
      if (p.size === 0) this.postings.delete(term);
    }
  }

  setDocOrder(ids: string[]): void {
    this.docOrder = ids;
    this.positions = new Map(ids.map((id, i) => [id, i]));
  }

  getScores(tokens: string[], mask?: boolean[]): Float32Array {
    const n = this.docOrder.length;
    const scores = new Float32Array(n);
    if (!tokens.length || !this.docs.size) return scores;
    const avgdl = this.totalLen / this.docs.size;
    const qtf = new Map<string, number>();
    for (const t of tokens) qtf.set(t, (qtf.get(t) ?? 0) + 1);
    for (const [term, queryTf] of qtf) {
      const docs = this.postings.get(term);
      if (!docs) continue;
      const df = docs.size;
      const idf = Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5));
      for (const [chunkId, tf] of docs) {
        const idx = this.positions.get(chunkId);
        if (idx === undefined) continue;
        const dl = this.lengths.get(chunkId) ?? 0;
        const tfc = tf / (K1 * (1 - B + (B * dl) / avgdl) + tf);
        scores[idx] += queryTf * idf * tfc;
      }
    }
    if (mask) for (let i = 0; i < n; i++) if (!mask[i]) scores[i] = 0;
    return scores;
  }

  serialize(): { docs: [string, [string, number][]][]; order: string[] } {
    return {
      docs: [...this.docs.entries()].map(([id, c]) => [id, [...c.entries()]]),
      order: this.docOrder,
    };
  }

  static deserialize(data: { docs: [string, [string, number][]][]; order: string[] }): BM25 {
    const b = new BM25();
    for (const [id, counts] of data.docs) {
      const m = new Map<string, number>(counts);
      b.docs.set(id, m);
      let len = 0;
      for (const [term, n] of m) {
        len += n;
        let p = b.postings.get(term);
        if (!p) { p = new Map(); b.postings.set(term, p); }
        p.set(id, n);
      }
      b.lengths.set(id, len);
      b.totalLen += len;
    }
    b.setDocOrder(data.order);
    return b;
  }
}