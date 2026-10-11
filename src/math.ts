import type { Instrument } from './types.js';
import { WAD } from './units.js';

/**
 * Papertrade settlement math, reproduced from live settlements.
 *
 * Every formula here is checked against real protocol output in test/math.test.ts:
 * liquidation prices match all 205 sampled live positions to the raw unit, and
 * winning-close PnL matches leaderboard settlements to within float precision.
 */

/** Win fee on the post-impact gain, and the LP-side fee carved from losses while the queue is empty. */
export const WIN_FEE = 0.02;
export const LOSS_FEE = 0.02;
/** Exit is measured `entryPriceRaw / 50000` (0.2 bps) less favourably on wins, in integer raw price units. */
export const DEADBAND_DIVISOR = 50_000n;

/** PAPER mint curve defaults (PaperTokenomics). */
export const PAPER_MINT_CURVE = {
  flatRate: 100,
  lpFlatThresholdUsd: 2_000_000,
  tailDecayScaleUsd: 120_000_000,
} as const;

const toNum = (wad: bigint) => Number(wad) / 1e18;

export interface ImpactParams {
  baseRate: number;
  rateMultiplier: number;
  positionMultiplier: number;
  referenceNotionalUsd: number;
}

export function impactParams(instrument: Pick<Instrument, 'baseRateRaw' | 'rateMultiplierRaw' | 'positionMultiplierRaw' | 'referenceNotionalRaw'>): ImpactParams {
  return {
    baseRate: toNum(instrument.baseRateRaw),
    rateMultiplier: toNum(instrument.rateMultiplierRaw),
    positionMultiplier: toNum(instrument.positionMultiplierRaw),
    referenceNotionalUsd: toNum(instrument.referenceNotionalRaw),
  };
}

/**
 * Asymmetric-impact scale factor for a winning close whose (post-deadband)
 * entry-to-exit move is `move` (a fraction, e.g. 0.01 for 1%).
 * scale = (1 - baseRate) / (1 + 1/(move*rateMultiplier) + referenceNotional/(1e6*move*positionMultiplier))
 */
export function impactScale(move: number, p: ImpactParams): number {
  if (!(move > 0)) return 0;
  return (1 - p.baseRate) / (1 + 1 / (move * p.rateMultiplier) + p.referenceNotionalUsd / (1e6 * move * p.positionMultiplier));
}

/**
 * Liquidation (bust) price in raw price units, exactly as the protocol computes it.
 * Long:  p0 = ceil(entry * (L - 1) / L),  bust = floor(p0 * (1 + buffer))
 * Short: p0 = floor(entry * (L + 1) / L), bust = ceil(p0 * (1 - buffer))
 */
export function liquidationPriceRaw(params: { entryPriceRaw: bigint; leverage: number; isLong: boolean; bustBufferRaw: bigint }): bigint {
  const { entryPriceRaw: e, isLong, bustBufferRaw: b } = params;
  const L = BigInt(params.leverage);
  if (L < 1n) throw new RangeError('leverage must be at least 1');
  if (isLong) {
    const p0 = ceilDiv(e * (L - 1n), L);
    return (p0 * (WAD + b)) / WAD;
  }
  const p0 = (e * (L + 1n)) / L;
  return ceilDiv(p0 * (WAD - b), WAD);
}

function ceilDiv(a: bigint, b: bigint) {
  return (a + b - 1n) / b;
}

export interface CloseEstimate {
  /** Price move times notional, before deadband, impact or fees (negative on a loss). */
  rawPnlUsd: number;
  /** Gain after deadband and impact, before the win fee (equals rawPnlUsd on a loss). */
  adjustedPnlUsd: number;
  /** 2% win fee the trader pays on a win; 0 on a loss. */
  winFeeUsd: number;
  /** What the trader's balance changes by. */
  netPnlUsd: number;
  /** Fraction of the raw gain kept after deadband, impact and fee (wins only, else 1). */
  keptFraction: number;
  /** Loss basis PAPER mints on, assuming the LP-side fee is charged (queue empty). */
  paperMintBasisUsd: number;
  /** True if this price is past the position's bust price (the position is liquidated, losing all margin). */
  liquidated: boolean;
}

/**
 * Estimate what closing a position at `exitPriceRaw` pays. Wins apply the
 * integer deadband, the asymmetric-impact scale and the 2% win fee; losses pay
 * the raw loss with nothing on top. Crossing the bust price forfeits the full margin.
 */
export function estimateClose(params: {
  instrument: Pick<Instrument, 'priceScale' | 'baseRateRaw' | 'rateMultiplierRaw' | 'positionMultiplierRaw' | 'referenceNotionalRaw' | 'bustBufferRaw'>;
  isLong: boolean;
  entryPriceRaw: bigint;
  exitPriceRaw: bigint;
  marginRaw: bigint;
  leverage: number;
}): CloseEstimate {
  const { instrument, isLong, entryPriceRaw: e, exitPriceRaw: x, leverage } = params;
  const margin = toNum(params.marginRaw);
  const notional = margin * leverage;
  const entry = Number(e);
  const bust = liquidationPriceRaw({ entryPriceRaw: e, leverage, isLong, bustBufferRaw: instrument.bustBufferRaw });
  const liquidated = isLong ? x <= bust : x >= bust;
  if (liquidated) {
    return { rawPnlUsd: -margin, adjustedPnlUsd: -margin, winFeeUsd: 0, netPnlUsd: -margin, keptFraction: 1, paperMintBasisUsd: margin, liquidated: true };
  }
  const rawPnlUsd = (notional * Number(isLong ? x - e : e - x)) / entry;
  if (rawPnlUsd <= 0) {
    const loss = Math.min(-rawPnlUsd, margin);
    return { rawPnlUsd: -loss, adjustedPnlUsd: -loss, winFeeUsd: 0, netPnlUsd: -loss, keptFraction: 1, paperMintBasisUsd: loss * (1 - LOSS_FEE), liquidated: false };
  }
  const deadband = e / DEADBAND_DIVISOR;
  const gainRaw = (isLong ? x - e : e - x) - deadband;
  if (gainRaw <= 0n) {
    return { rawPnlUsd, adjustedPnlUsd: 0, winFeeUsd: 0, netPnlUsd: 0, keptFraction: 0, paperMintBasisUsd: 0, liquidated: false };
  }
  const move = Number(gainRaw) / entry;
  const adjustedPnlUsd = notional * move * impactScale(move, impactParams(instrument));
  const winFeeUsd = adjustedPnlUsd * WIN_FEE;
  const netPnlUsd = adjustedPnlUsd - winFeeUsd;
  return { rawPnlUsd, adjustedPnlUsd, winFeeUsd, netPnlUsd, keptFraction: netPnlUsd / rawPnlUsd, paperMintBasisUsd: 0, liquidated: false };
}

/**
 * USD value of an instrument's open interest or cap. The protocol stores OI and
 * caps as base-asset quantities (wad BTC or ETH), so they are priced at the mark:
 * `longOiRaw` times the BTC mark equals the house `bl` open notional.
 */
export function openInterestUsd(quantityRaw: bigint, markPriceRaw: bigint, priceScale: bigint): number {
  return (toNum(quantityRaw) * Number(markPriceRaw)) / Number(priceScale);
}

/** Base-asset quantity (wad) a USD notional (wad) buys at a mark price, as the OI cap counts it. */
export function notionalToQuantityRaw(notionalRaw: bigint, markPriceRaw: bigint, priceScale: bigint): bigint {
  if (markPriceRaw <= 0n) throw new RangeError('mark price must be positive');
  return (notionalRaw * priceScale) / markPriceRaw;
}

/** Mark-to-market PnL of an open position at a given price (raw units), before any close-side haircut. */
export function unrealizedPnlUsd(params: { isLong: boolean; entryPriceRaw: bigint; markPriceRaw: bigint; marginRaw: bigint; leverage: number }): number {
  const notional = toNum(params.marginRaw) * params.leverage;
  const diff = params.isLong ? params.markPriceRaw - params.entryPriceRaw : params.entryPriceRaw - params.markPriceRaw;
  return (notional * Number(diff)) / Number(params.entryPriceRaw);
}

/** Distance from a mark price to the bust price as a fraction of the mark (how far price can move before liquidation). */
export function distanceToLiquidation(params: { isLong: boolean; markPriceRaw: bigint; bustPriceRaw: bigint }): number {
  const mark = Number(params.markPriceRaw);
  const bust = Number(params.bustPriceRaw);
  return params.isLong ? (mark - bust) / mark : (bust - mark) / mark;
}

/**
 * Marginal PAPER minted per $1 of loss basis. Flat at 100 while tracked LP is
 * below $2M (including underwater); past that it decays as 100 * (S / (S + H))^2,
 * where H is the never-decreasing tail-progress high-water mark.
 */
export function paperMintRate(params: { trackedLpUsd: number; tailProgressUsd: number }, curve = PAPER_MINT_CURVE): number {
  if (params.trackedLpUsd < curve.lpFlatThresholdUsd) return curve.flatRate;
  const S = curve.tailDecayScaleUsd;
  return curve.flatRate * (S / (S + Math.max(0, params.tailProgressUsd))) ** 2;
}

/** Estimated PAPER minted for a loss basis at the current curve position. */
export function estimatePaperMinted(lossBasisUsd: number, state: { trackedLpUsd: number; tailProgressUsd: number }, curve = PAPER_MINT_CURVE): number {
  return lossBasisUsd * paperMintRate(state, curve);
}

/** PaperStaking scales accRewardPerShare by 1e27 (verified against PaperStaking.pendingReward on mainnet). */
export const ACC_REWARD_PRECISION = 10n ** 27n;

/**
 * Pending USDC staking reward (wad), computed from live wallet state and the
 * trading state's accRewardPerShare without an RPC call:
 * pendingBase + staked * accRewardPerShare / 1e27 - rewardDebt.
 */
export function pendingStakingRewardRaw(params: { stakedRaw: bigint; accRewardPerShareRaw: bigint; rewardDebtRaw: bigint; pendingBaseRaw: bigint }): bigint {
  const accrued = (params.stakedRaw * params.accRewardPerShareRaw) / ACC_REWARD_PRECISION - params.rewardDebtRaw;
  return params.pendingBaseRaw + (accrued > 0n ? accrued : 0n);
}
