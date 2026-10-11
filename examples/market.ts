// Live market overview: instruments, limits, open interest, protocol balances and the PAPER mint rate.
// Run: npx tsx examples/market.ts
import { PapertradeClient, paperMintRate, priceFromRaw, wadToNumber, formatUsdCompact } from '../src/index.js';

const client = new PapertradeClient();
const [trading, summary] = await Promise.all([client.tradingState(), client.protocolSummary()]);

for (const inst of trading.instruments) {
  const { points } = await client.priceHistory({ instrumentId: inst.id, lookbackMs: 5 * 60_000 });
  const last = points.at(-1);
  console.log(
    `${inst.symbol.padEnd(4)} ${last ? `$${last.price.toLocaleString()}` : 'no recent price'}  max ${inst.maxLeverage}x  ` +
      `OI long ${formatUsdCompact(wadToNumber(inst.longOiRaw))} / short ${formatUsdCompact(wadToNumber(inst.shortOiRaw))}  ` +
      `${inst.openable ? 'open' : 'closed'}`,
  );
  if (inst.frozenBidRaw !== null) console.log(`  frozen bid ${priceFromRaw(inst.frozenBidRaw, inst.priceScale)}`);
}

const usd = (raw: string) => formatUsdCompact(wadToNumber(raw));
console.log(`\nTVL ${usd(summary.balances.tvl)}  LP ${usd(summary.balances.lp)}  queue ${usd(summary.balances.queue)}  volume ${usd(summary.activity.volume)}`);
console.log(`PAPER supply ${wadToNumber(summary.paper.supply).toLocaleString()}  staked ${wadToNumber(summary.paper.staked).toLocaleString()}`);
const rate = paperMintRate({ trackedLpUsd: wadToNumber(summary.paper.trackedLp), tailProgressUsd: wadToNumber(summary.paper.tailProgress) });
console.log(`PAPER minted per $1 of loss right now: ${rate.toFixed(4)}`);
