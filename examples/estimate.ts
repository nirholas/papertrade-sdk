// What would a close pay? Uses the live instrument parameters and the verified settlement math.
// Run: npx tsx examples/estimate.ts BTC long 100 500 [entry] [exit]
//      (market, side, margin USD, leverage, optional entry and exit prices; defaults to the live price and +0.5%)
import { PapertradeClient, estimateClose, liquidationPriceRaw, priceFromRaw, priceToRaw, usdToWad } from '../src/index.js';

const [market = 'BTC', side = 'long', margin = '100', lev = '100', entryArg, exitArg] = process.argv.slice(2);
const client = new PapertradeClient();
const trading = await client.tradingState();
const inst = trading.instruments.find((i) => i.symbol === market.toUpperCase());
if (!inst) throw new Error(`Unknown market ${market}. Live markets: ${trading.instruments.map((i) => i.symbol).join(', ')}`);
const isLong = side === 'long';
const leverage = Number(lev);

const { points } = await client.priceHistory({ instrumentId: inst.id, lookbackMs: 60_000 });
const live = points.at(-1)?.price;
const entry = Number(entryArg ?? live);
if (!Number.isFinite(entry)) throw new Error('No live price available; pass an entry price.');
const exit = Number(exitArg ?? entry * (isLong ? 1.005 : 0.995));

const entryPriceRaw = priceToRaw(entry, inst.priceScale);
const est = estimateClose({ instrument: inst, isLong, entryPriceRaw, exitPriceRaw: priceToRaw(exit, inst.priceScale), marginRaw: usdToWad(margin), leverage });
const bust = liquidationPriceRaw({ entryPriceRaw, leverage, isLong, bustBufferRaw: inst.bustBufferRaw });

console.log(`${inst.symbol} ${side.toUpperCase()} $${margin} x${leverage} (notional $${(Number(margin) * leverage).toLocaleString()})`);
console.log(`entry ${priceFromRaw(entryPriceRaw, inst.priceScale)}  exit ${priceFromRaw(priceToRaw(exit, inst.priceScale), inst.priceScale)}  bust ${priceFromRaw(bust, inst.priceScale)}`);
console.log(`raw PnL       $${est.rawPnlUsd.toFixed(4)}`);
console.log(`after impact  $${est.adjustedPnlUsd.toFixed(4)}`);
console.log(`win fee       $${est.winFeeUsd.toFixed(4)}`);
console.log(`net           $${est.netPnlUsd.toFixed(4)}${est.liquidated ? '  (liquidated)' : ''}`);
if (est.rawPnlUsd > 0) console.log(`you keep ${(est.keptFraction * 100).toFixed(2)}% of the raw gain`);
if (est.paperMintBasisUsd > 0) console.log(`PAPER mint basis $${est.paperMintBasisUsd.toFixed(4)}`);
