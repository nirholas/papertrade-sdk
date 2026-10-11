import { describe, expect, it } from 'vitest';
import trading from './fixtures/trading.json';
import positions from './fixtures/live-positions.json';
import leaderboard from './fixtures/lbpos.json';
import accountTrades from './fixtures/acct_trades.json';
import {
  decodeTradingState,
  distanceToLiquidation,
  estimateClose,
  estimatePaperMinted,
  liquidationPriceRaw,
  paperMintRate,
  pendingStakingRewardRaw,
  unrealizedPnlUsd,
} from '../src/index.js';

const state = decodeTradingState(trading as Parameters<typeof decodeTradingState>[0]);
const inst = (id: number) => state.instruments.find((i) => i.id === id)!;
const usd = (raw: string) => Number(raw) / 1e18;

describe('liquidationPriceRaw', () => {
  it(`matches the bust price of all ${positions.length} sampled live positions exactly`, () => {
    const mismatches = positions.filter(
      (p) =>
        liquidationPriceRaw({
          entryPriceRaw: BigInt(p.entryPriceRaw),
          leverage: p.leverage,
          isLong: p.isLong,
          bustBufferRaw: inst(p.instrumentId).bustBufferRaw,
        }) !== BigInt(p.bustPriceRaw),
    );
    expect(positions.length).toBeGreaterThan(200);
    expect(mismatches).toEqual([]);
  });

  it('rejects leverage below 1', () => {
    expect(() => liquidationPriceRaw({ entryPriceRaw: 1000n, leverage: 0, isLong: true, bustBufferRaw: 0n })).toThrow(RangeError);
  });
});

describe('estimateClose on winning leaderboard settlements', () => {
  const rows = leaderboard.rows.filter((r) => BigInt(r.pnl) > 0n);
  it.each(rows.map((r) => [r.rank, r] as const))('rank %i net PnL matches the protocol to 1e-6', (_rank, r) => {
    const est = estimateClose({
      instrument: inst(r.instrumentId),
      isLong: r.side === 'long',
      entryPriceRaw: BigInt(r.entryPrice),
      exitPriceRaw: BigInt(r.exitPrice),
      marginRaw: BigInt(r.margin),
      leverage: r.leverage,
    });
    expect(est.liquidated).toBe(false);
    expect(est.netPnlUsd / usd(r.pnl)).toBeCloseTo(1, 6);
    expect(est.netPnlUsd).toBeLessThan(est.rawPnlUsd);
  });
});

describe('estimateClose on an account trade history', () => {
  const byId = Object.fromEntries(accountTrades.items.map((t) => [t.positionId, t]));
  const estimate = (t: (typeof accountTrades.items)[number]) =>
    estimateClose({
      instrument: inst(t.instrumentId),
      isLong: t.isLong,
      entryPriceRaw: BigInt(t.entryPriceRaw),
      exitPriceRaw: BigInt(t.exitPriceRaw!),
      marginRaw: BigInt(t.marginRaw),
      leverage: t.leverage,
    });

  it('a loss pays the raw move and mints PAPER on 98% of it', () => {
    const t = byId['3912'];
    const est = estimate(t);
    expect(est.adjustedPnlUsd / usd(t.adjustedPnlRaw!)).toBeCloseTo(1, 9);
    expect(est.paperMintBasisUsd / usd(t.paperMintBasisRaw!)).toBeCloseTo(1, 9);
    expect(est.winFeeUsd).toBe(0);
  });

  it('a win charges 2% of the post-impact gain', () => {
    const t = byId['3969'];
    const est = estimate(t);
    expect(est.adjustedPnlUsd / usd(t.adjustedPnlRaw!)).toBeCloseTo(1, 6);
    expect(est.winFeeUsd / usd(t.userPaidFeeRaw!)).toBeCloseTo(1, 6);
  });

  it('a mainnet liquidation (ETH #55400, settled at its bust price) mints PAPER on the full margin', () => {
    // From /query/accounts/{w}/trades: kind Liquidated, adjustedPnlRaw = -marginRaw, paperMintBasisRaw = marginRaw.
    const est = estimateClose({ instrument: inst(1), isLong: true, entryPriceRaw: 250945n, exitPriceRaw: 250815n, marginRaw: 497n * 10n ** 18n, leverage: 1000 });
    expect(liquidationPriceRaw({ entryPriceRaw: 250945n, leverage: 1000, isLong: true, bustBufferRaw: inst(1).bustBufferRaw })).toBe(250815n);
    expect(est.liquidated).toBe(true);
    expect(est.netPnlUsd).toBeCloseTo(-497, 9);
    expect(est.paperMintBasisUsd).toBeCloseTo(497, 9);
  });

  it('crossing the bust price forfeits the whole margin', () => {
    const est = estimateClose({ instrument: inst(0), isLong: true, entryPriceRaw: 829915n, exitPriceRaw: 747279n, marginRaw: 50n * 10n ** 21n, leverage: 10 });
    expect(est.liquidated).toBe(true);
    expect(est.netPnlUsd).toBeCloseTo(-50_000, 6);
  });

  it('a gain inside the deadband pays nothing', () => {
    const est = estimateClose({ instrument: inst(0), isLong: true, entryPriceRaw: 1_000_000n, exitPriceRaw: 1_000_020n, marginRaw: 10n ** 21n, leverage: 10 });
    expect(est.netPnlUsd).toBe(0);
  });
});

describe('mark-to-market helpers', () => {
  it('unrealized PnL is notional times the move', () => {
    expect(unrealizedPnlUsd({ isLong: false, entryPriceRaw: 1000n, markPriceRaw: 990n, marginRaw: 10n ** 20n, leverage: 10 })).toBeCloseTo(10, 9);
  });
  it('distance to liquidation is positive while safe', () => {
    expect(distanceToLiquidation({ isLong: true, markPriceRaw: 1000n, bustPriceRaw: 900n })).toBeCloseTo(0.1, 9);
    expect(distanceToLiquidation({ isLong: false, markPriceRaw: 1000n, bustPriceRaw: 1050n })).toBeCloseTo(0.05, 9);
  });
});

describe('PAPER mint curve', () => {
  it('is flat at 100 below $2M tracked LP', () => {
    expect(paperMintRate({ trackedLpUsd: 1_999_999, tailProgressUsd: 1e9 })).toBe(100);
    expect(paperMintRate({ trackedLpUsd: -5e5, tailProgressUsd: 1e9 })).toBe(100);
  });
  it('decays as 100 * (S/(S+H))^2 past the threshold', () => {
    // Mainnet summary at block 48197160: tracked LP $5.99M, tail progress $58.2M.
    const rate = paperMintRate({ trackedLpUsd: 5.99e6, tailProgressUsd: 58.2e6 });
    expect(rate).toBeCloseTo(100 * (120 / 178.2) ** 2, 9);
    expect(estimatePaperMinted(10, { trackedLpUsd: 5.99e6, tailProgressUsd: 58.2e6 })).toBeCloseTo(rate * 10, 9);
  });
});

describe('pendingStakingRewardRaw', () => {
  it('matches PaperStaking.pendingReward exactly for a mainnet staker', () => {
    expect(
      pendingStakingRewardRaw({
        stakedRaw: 5907898593653126417497594n,
        accRewardPerShareRaw: 8709904278374229395401056n,
        rewardDebtRaw: 47398729825429853961857n,
        pendingBaseRaw: 0n,
      }),
    ).toBe(4058501411630604788773n);
  });
});
