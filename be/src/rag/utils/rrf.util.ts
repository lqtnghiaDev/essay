export interface RankedItem {
  id: string;
  content: string;
  rank: number;
}

export interface RrfResult {
  id: string;
  content: string;
  score: number;
}

/**
 * Reciprocal Rank Fusion: merge multiple ranked lists by summing 1/(k + rank).
 * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html
 */
export function reciprocalRankFusion(
  rankedLists: RankedItem[][],
  k = 60,
): RrfResult[] {
  const scores = new Map<string, { content: string; score: number }>();

  for (const list of rankedLists) {
    for (const item of list) {
      const rrfScore = 1 / (k + item.rank);
      const existing = scores.get(item.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(item.id, { content: item.content, score: rrfScore });
      }
    }
  }

  return Array.from(scores.entries())
    .map(([id, { content, score }]) => ({ id, content, score }))
    .sort((a, b) => b.score - a.score);
}
