import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import trading from './fixtures/oi-trading.json';
import house from './fixtures/oi-house.json';
import { PapertradeTrader, decodeTradingState, notionalToQuantityRaw, openInterestUsd, priceToRaw, usdToWad } from '../src/index.js';

const state = decodeTradingState(trading as Parameters<typeof decodeTradingState>[0]);
const [, , , , bl, bs, el, es] = house.head;

describe('open interest units', () => {
  it('OI is a base-asset quantity: priced at the mark it equals the house open notional', () => {
    const cases = [
      { id: 0, mid: Number(house.hyperliquidMids.BTC), long: bl, short: bs },
      { id: 1, mid: Number(house.hyperliquidMids.ETH), long: el, short: es },
    ];
    for (const c of cases) {
      const inst = state.instruments.find((i) => i.id === c.id)!;
      const mark = priceToRaw(c.mid, inst.priceScale);
      expect(openInterestUsd(inst.longOiRaw, mark, inst.priceScale) / c.long).toBeCloseTo(1, 2);
      expect(openInterestUsd(inst.shortOiRaw, mark, inst.priceScale) / c.short).toBeCloseTo(1, 2);
    }
  });

  it('converts a USD notional to the quantity the cap counts', () => {
    const btc = state.instruments.find((i) => i.id === 0)!;
    expect(notionalToQuantityRaw(usdToWad(83_000), priceToRaw(83_000, btc.priceScale), btc.priceScale)).toBe(usdToWad(1));
  });
});

describe('validateOpen OI cap', () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const trader = new PapertradeTrader({ user: account.address, wallet: account });
  const btc = state.instruments.find((i) => i.id === 0)!;
  const mark = priceToRaw(83_034.5, btc.priceScale);
  const open = { market: 'BTC', side: 'long', marginUsd: 10, leverage: 1000 } as const;

  it('accepts an open with headroom under the live cap', () => {
    expect(() => trader.validateOpen({ ...open, markPriceRaw: mark }, state)).not.toThrow();
  });

  it('rejects an open whose quantity crosses the cap, counted in base units', () => {
    const headroomUsd = Number(btc.longCapRaw - btc.longOiRaw) / 1e18 * 83_034.5;
    const tight = { ...state, instruments: state.instruments.map((i) => (i.id === 0 ? { ...i, longCapRaw: i.longOiRaw + usdToWad(0.1) } : i)) };
    expect(headroomUsd).toBeGreaterThan(10_000);
    expect(() => trader.validateOpen({ ...open, markPriceRaw: mark }, tight)).toThrow(/open interest cap/);
    expect(() => trader.validateOpen(open, tight)).not.toThrow();
  });
});
