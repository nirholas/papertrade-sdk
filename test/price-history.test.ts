import { describe, expect, it } from 'vitest';
import { chooseTier, mergePriceTiles, planPriceTiles, PRICE_TIERS, toOhlc } from '../src/index.js';

const NOW = 1_791_660_000_000;

describe('price tile planning', () => {
  it('uses 125ms tiles for the last few minutes', () => {
    const { tier, tiles } = planPriceTiles({ fromMs: NOW - 120_000, toMs: NOW, nowMs: NOW });
    expect(tier.intervalMs).toBe(125);
    expect(tiles.every((t) => t.toMs - t.fromMs === 60_000 && t.fromMs % 60_000 === 0)).toBe(true);
  });

  it('steps to 1s then 1m tiles as the window grows or ages', () => {
    expect(chooseTier(NOW - 3_600_000, NOW, NOW).intervalMs).toBe(1000);
    expect(chooseTier(NOW - 86_400_000, NOW, NOW).intervalMs).toBe(60_000);
    expect(chooseTier(NOW - 14_400_000, NOW - 14_000_000, NOW).intervalMs).toBe(60_000);
  });

  it('covers the whole window with aligned, contiguous tiles', () => {
    const { tiles } = planPriceTiles({ lookbackMs: 24 * 3_600_000, nowMs: NOW });
    expect(tiles[0].fromMs).toBeLessThanOrEqual(NOW - 24 * 3_600_000);
    expect(tiles.at(-1)!.toMs).toBeGreaterThan(NOW);
    tiles.slice(1).forEach((t, i) => expect(t.fromMs).toBe(tiles[i].toMs));
    expect(tiles[0].fromMs % PRICE_TIERS[2].tileMs).toBe(0);
  });

  it('rejects an empty window', () => {
    expect(() => planPriceTiles({ fromMs: NOW, toMs: NOW, nowMs: NOW })).toThrow(RangeError);
  });
});

describe('merging and bars', () => {
  const tile = (base: number, prices: number[], gaps: number[] = []) => ({
    fromMs: base,
    toMs: base + prices.length * 1000,
    baseTimeMs: base,
    timeOffsetsMs: prices.map((_, i) => i * 1000),
    gapIndices: gaps,
    columns: { price: prices },
  });

  it('merges out-of-order tiles, dedupes overlaps and clips to the window', () => {
    const pts = mergePriceTiles([tile(3000, [4, 5]), tile(0, [1, 2, 3, 4], [2])] as never, 1000, 5000);
    expect(pts.map((p) => [p.t, p.price, p.gapBefore])).toEqual([[1000, 2, false], [2000, 3, true], [3000, 4, false], [4000, 5, false]]);
  });

  it('buckets into OHLC bars', () => {
    const bars = toOhlc(mergePriceTiles([tile(0, [10, 12, 9, 11, 15])] as never), 3000);
    expect(bars).toEqual([
      { time: 0, open: 10, high: 12, low: 9, close: 9 },
      { time: 3000, open: 11, high: 15, low: 11, close: 15 },
    ]);
  });
});
