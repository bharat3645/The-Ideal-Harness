/**
 * BM25 ranking — real relevance, not recency.
 *
 * Implemented directly (no FTS5 dependency) so episodic recall ranks by term
 * relevance with the standard Okapi BM25 formula. A SQLite-FTS5 backend is a
 * v0.2 scaling option behind the same search contract.
 */

const K1 = 1.5;
const B = 0.75;

export interface Bm25Doc {
  readonly id: string;
  readonly text: string;
}

export interface ScoredDoc {
  readonly id: string;
  readonly score: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
}

export class Bm25Index {
  private readonly docs: ReadonlyArray<{ id: string; tokens: string[]; length: number }>;
  private readonly df = new Map<string, number>();
  private readonly avgdl: number;

  constructor(documents: readonly Bm25Doc[]) {
    this.docs = documents.map((doc) => {
      const tokens = tokenize(doc.text);
      return { id: doc.id, tokens, length: tokens.length };
    });
    for (const doc of this.docs) {
      for (const term of new Set(doc.tokens)) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
    const total = this.docs.reduce((sum, doc) => sum + doc.length, 0);
    this.avgdl = this.docs.length > 0 ? total / this.docs.length : 0;
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log((n - df + 0.5) / (df + 0.5) + 1);
  }

  search(query: string, limit = 10): ScoredDoc[] {
    const terms = tokenize(query);
    const scored: ScoredDoc[] = this.docs.map((doc) => {
      let score = 0;
      for (const term of terms) {
        const tf = doc.tokens.filter((t) => t === term).length;
        if (tf === 0) {
          continue;
        }
        const denom = tf + K1 * (1 - B + (B * doc.length) / (this.avgdl || 1));
        score += this.idf(term) * ((tf * (K1 + 1)) / denom);
      }
      return { id: doc.id, score };
    });
    return scored
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
