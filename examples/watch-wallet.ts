// Stream a wallet's live state and print every position with its bust price and distance to liquidation.
// Run: npx tsx examples/watch-wallet.ts 0xWALLET
import { isAddress, type Address } from 'viem';
import { PapertradeClient, distanceToLiquidation, instrumentById, priceFromRaw, priceToRaw, streamWallet, unrealizedPnlUsd, wadToNumber } from '../src/index.js';

const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) {
  console.error('Usage: npx tsx examples/watch-wallet.ts 0xWALLET');
  process.exit(1);
}

const client = new PapertradeClient();
const marks = new Map<number, number>();
async function refreshMarks() {
  for (const id of [0, 1]) {
    const { points } = await client.priceHistory({ instrumentId: id, lookbackMs: 60_000 });
    const last = points.at(-1);
    if (last) marks.set(id, last.price);
  }
}
await refreshMarks();
setInterval(() => refreshMarks().catch((e) => console.error('price refresh failed:', e.message)), 5_000).unref();

const stop = streamWallet({
  wallet: wallet as Address,
  onStatus: (s, detail) => console.error(`[stream] ${s}${detail ? `: ${detail}` : ''}`),
  onState(state, kind) {
    console.log(`\n${kind} rev ${state.accountRevision}  balance $${wadToNumber(state.balance).toFixed(2)}  locked $${wadToNumber(state.locked).toFixed(2)}`);
    for (const p of state.positions) {
      const inst = instrumentById(p.instrumentId);
      const mark = marks.get(p.instrumentId);
      const line = `#${p.positionId} ${inst.name} ${p.isLong ? 'LONG' : 'SHORT'} ${p.leverage}x margin $${wadToNumber(p.marginRaw)} entry ${priceFromRaw(p.entryPriceRaw, inst.priceScale)} bust ${priceFromRaw(p.bustPriceRaw, inst.priceScale)}`;
      if (mark === undefined) {
        console.log(line);
        continue;
      }
      const markRaw = priceToRaw(mark, inst.priceScale);
      const pnl = unrealizedPnlUsd({ ...p, markPriceRaw: markRaw });
      const dist = distanceToLiquidation({ isLong: p.isLong, markPriceRaw: markRaw, bustPriceRaw: p.bustPriceRaw });
      console.log(`${line}  mark ${mark}  uPnL $${pnl.toFixed(2)}  ${(dist * 100).toFixed(3)}% to bust`);
    }
    for (const c of state.closedPositions) console.log(`closed #${c.positionId}${c.liquidated ? ' (liquidated)' : ''} net $${wadToNumber(c.netPnlRaw).toFixed(2)}`);
  },
});
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
