import { reciprocalRankFusion } from './rrf.util';

describe('reciprocalRankFusion', () => {
  it('merges two ranked lists and boosts items appearing in both', () => {
    const vector = [
      { id: 'a', content: 'doc a', rank: 1 },
      { id: 'b', content: 'doc b', rank: 2 },
      { id: 'c', content: 'doc c', rank: 3 },
    ];
    const es = [
      { id: 'b', content: 'doc b', rank: 1 },
      { id: 'd', content: 'doc d', rank: 2 },
      { id: 'a', content: 'doc a', rank: 3 },
    ];

    const fused = reciprocalRankFusion([vector, es], 60);

    expect(fused[0].id).toBe('b');
    expect(fused.map((item) => item.id)).toEqual(
      expect.arrayContaining(['a', 'b', 'c', 'd']),
    );
    expect(fused.find((item) => item.id === 'b')!.score).toBeGreaterThan(
      fused.find((item) => item.id === 'c')!.score,
    );
  });

  it('returns empty array for no input lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
