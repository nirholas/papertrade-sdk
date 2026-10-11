import type { PriceHistory } from './types.js';

/**
 * Price history is published as fixed tiles at three resolutions. A request must
 * cover exactly one tile, and finer tiers are only retained for a short window.
 * These mirror the tiers the official exchange frontend plans against.
 */
export const PRICE_TIERS = [
  { intervalMs: 125, tileMs: 60_000, retentionMs: 300_000 },
  { intervalMs: 1_000, tileMs: 900_000, retentionMs: 10_800_000 },
  { intervalMs: 60_000, tileMs: 21_600_000, retentionMs: Infinity },
] as const;

/** Most points the API serves in a single planned window before stepping to a coarser tier. */
export const MAX_POINTS_PER_WINDOW = 5000;
/** Margin the frontend keeps between a tier's retention edge and the requested start. */
const RETENTION_MARGIN_MS = 5000;

export type PriceTier = (typeof PRICE_TIERS)[number];

export interface PriceTile {
  fromMs: number;
  toMs: number;
  intervalMs: number;
}

export interface PriceWindowRequest {
  instrumentId: number;
  /** Window start (ms). Defaults to `toMs - lookbackMs`. */
  fromMs?: number;
  /** Window end (ms). Defaults to now. */
  toMs?: number;
  /** Lookback from `toMs` when `fromMs` is omitted. Default 6 hours. */
  lookbackMs?: number;
  /** Force a resolution (125, 1000 or 60000). Otherwise the finest tier that covers the window is used. */
  intervalMs?: 125 | 1000 | 60000;
  /** Clock for retention checks (tests). Default Date.now(). */
  nowMs?: number;
}

const floorTo = (value: number, step: number) => Math.floor(value / step) * step;

/** Pick the finest tier whose retention still covers `fromMs` and keeps the window under 5000 points. */
export function chooseTier(fromMs: number, toMs: number, nowMs = Date.now()): PriceTier {
  return (
    PRICE_TIERS.find(
      (tier) =>
        floorTo(fromMs, tier.tileMs) >= Math.max(0, nowMs - tier.retentionMs + RETENTION_MARGIN_MS) &&
        (toMs - fromMs) / tier.intervalMs <= MAX_POINTS_PER_WINDOW,
    ) ?? PRICE_TIERS[2]
  );
}

/** Split a window into the exact tile requests the API accepts. */
export function planPriceTiles(request: Omit<PriceWindowRequest, 'instrumentId'>): { tier: PriceTier; tiles: PriceTile[] } {
  const nowMs = request.nowMs ?? Date.now();
  const toMs = request.toMs ?? nowMs;
  const fromMs = request.fromMs ?? toMs - (request.lookbackMs ?? 6 * 3_600_000);
  if (!(toMs > fromMs)) throw new RangeError('toMs must be after fromMs');
  const tier = request.intervalMs
    ? (PRICE_TIERS.find((t) => t.intervalMs === request.intervalMs) ?? PRICE_TIERS[2])
    : chooseTier(fromMs, toMs, nowMs);
  const start = floorTo(fromMs, tier.intervalMs);
  const end = floorTo(toMs, tier.intervalMs) + tier.intervalMs;
  const tiles: PriceTile[] = [];
  for (let t = floorTo(start, tier.tileMs); t < end; t += tier.tileMs) {
    tiles.push({ fromMs: t, toMs: t + tier.tileMs, intervalMs: tier.intervalMs });
  }
  return { tier, tiles };
}

export interface PricePoint {
  /** Timestamp (ms). */
  t: number;
  price: number;
  /** True when there is missing data immediately before this point. */
  gapBefore: boolean;
}

/**
 * Merge tile responses into one ordered point list clipped to [fromMs, toMs).
 * Prices are already in quote units (USD), not raw integers.
 */
export function mergePriceTiles(tiles: PriceHistory[], fromMs = -Infinity, toMs = Infinity): PricePoint[] {
  const out: PricePoint[] = [];
  const seen = new Set<number>();
  for (const tile of [...tiles].sort((a, b) => a.fromMs - b.fromMs)) {
    const gaps = new Set(tile.gapIndices);
    tile.timeOffsetsMs.forEach((offset, i) => {
      const t = tile.baseTimeMs + offset;
      if (t < fromMs || t >= toMs || seen.has(t)) return;
      seen.add(t);
      out.push({ t, price: tile.columns.price[i], gapBefore: gaps.has(i) });
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Bucket points into OHLC bars of `barMs` (for charting at a coarser resolution than the tier). */
export function toOhlc(points: PricePoint[], barMs: number) {
  const bars: { time: number; open: number; high: number; low: number; close: number }[] = [];
  for (const p of points) {
    const time = floorTo(p.t, barMs);
    const last = bars[bars.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, p.price);
      last.low = Math.min(last.low, p.price);
      last.close = p.price;
    } else {
      bars.push({ time, open: p.price, high: p.price, low: p.price, close: p.price });
    }
  }
  return bars;
}
