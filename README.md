# papertrade-sdk

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0a8f5b?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://github.com/nirholas/papertrade-sdk)
[![HyperEVM](https://img.shields.io/badge/HyperEVM-chain_999-0a8f5b?style=flat-square)](https://papertrade.xyz)
[![GitHub stars](https://img.shields.io/github/stars/nirholas/papertrade-sdk?style=flat-square&color=0a8f5b)](https://github.com/nirholas/papertrade-sdk/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/nirholas/papertrade-sdk?style=flat-square&color=0a8f5b)](https://github.com/nirholas/papertrade-sdk/commits/main)
[![Unofficial](https://img.shields.io/badge/community-unofficial-lightgrey?style=flat-square)](#the-papertrade-toolkit)

[Live site](https://papertrade-sdk.pages.dev) · [Issues](https://github.com/nirholas/papertrade-sdk/issues) · [Discussions](https://github.com/nirholas/papertrade-sdk/discussions) · [Papertrade](https://papertrade.xyz) · [Toolkit](#the-papertrade-toolkit)

TypeScript SDK for [Papertrade](https://papertrade.xyz), the fully on-chain 1000x synthetic perps exchange on Hyperliquid's HyperEVM. It covers the public API, the live account stream, EIP-712 intent signing for trading, deposits, withdrawals and PAPER staking, plus settlement math checked against mainnet.

> **Unofficial.** This is an independent community project, not affiliated with or endorsed by the Papertrade team. Trading at high leverage can lose your whole margin in seconds. Nothing here is financial advice.

```bash
npm install papertrade-sdk viem
```

Works in Node 20+, browsers, Bun, Deno and Cloudflare Workers. ESM and CommonJS. `viem` is a peer dependency.

## What is verified

The test suite runs against recorded mainnet data, and `npm run test:live` re-checks it against production:

- **Signatures.** A real batched Close from mainnet tx `0xde30ba04...f1d9` recovers the trader's registered session key, and the SDK reproduces the relayer's intent ids.
- **Staking domain.** The PaperStaking EIP-712 domain hashes to the contract's on-chain `DOMAIN_SEPARATOR()`.
- **Liquidation prices.** `liquidationPriceRaw` matches the bust price of 205 of 205 live positions exactly.
- **Closes.** `estimateClose` reproduces 15 of 15 leaderboard winning settlements, a losing close's PAPER mint basis, and a mainnet liquidation.
- **Staking rewards.** `pendingStakingRewardRaw` equals `PaperStaking.pendingReward` to the wei.
- **Rejection path.** The relayer rejects an intent signed by an unregistered key with `unauthorized_intent`.

The full protocol reference is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Quick start: read the market

```ts
import { PapertradeClient, paperMintRate, wadToNumber } from 'papertrade-sdk';

const client = new PapertradeClient();
const trading = await client.tradingState();
for (const m of trading.instruments) console.log(m.symbol, `max ${m.maxLeverage}x`, m.openable ? 'open' : 'closed');

const { points } = await client.priceHistory({ instrumentId: 0, lookbackMs: 15 * 60_000 });
console.log('BTC', points.at(-1)?.price);

const s = await client.protocolSummary();
console.log('PAPER per $1 of loss:', paperMintRate({ trackedLpUsd: wadToNumber(s.paper.trackedLp), tailProgressUsd: wadToNumber(s.paper.tailProgress) }));
```

## Watch a wallet live

```ts
import { streamWallet, wadToNumber } from 'papertrade-sdk';

const stop = streamWallet({
  wallet: '0x...',
  onState(state, kind) {
    console.log(kind, wadToNumber(state.balance), state.positions.length, 'open');
  },
  onStatus: (status) => console.log(status),
});
```

The stream applies revision-checked patches, reconnects with backoff, and re-snapshots if it falls out of sync.

## Trade

Trades are signed by a session key, which the wallet authorizes once. A session key can open and close positions but can never withdraw. Every action has a `prepare*` form that signs without sending, so you can show the user exactly what will happen first.

```ts
import { PapertradeTrader, createSessionKey, fetchWalletState } from 'papertrade-sdk';
import { privateKeyToAccount } from 'viem/accounts';

const wallet = privateKeyToAccount(process.env.PAPERTRADE_WALLET_KEY as `0x${string}`);
const trader = new PapertradeTrader({ user: wallet.address, wallet });

await trader.registerSession(createSessionKey());          // one wallet signature

const intent = await trader.prepareOpen({ market: 'BTC', side: 'long', marginUsd: 10, leverage: 1000 });
console.log(intent.summary);                                // show it, ask for confirmation
const { receipt } = await trader.submit(intent);            // then send
console.log('accepted', receipt.intentId);

// Positions appear on the live stream once the batch lands; close them by id.
const state = await fetchWalletState(wallet.address);
await trader.closePositions(state.positions.map((p) => p.positionId));
```

In a browser, pass a viem `WalletClient` (anything with `address` and `signTypedData`) as `wallet`, and `localStorage` as `nonceStorage`.

Other actions:

- `withdraw({ amountUsdc, route: 'hypercore' | 'hyperevm' })`. It checks the available balance, the 10 USDC minimum and the one-time activation fee.
- `stake(paper)`, `unstake(paper)` and `claim()`. Reward distribution is run by the relayer, not by users.
- `cancel(intentId)`.

## Estimate outcomes before trading

```ts
import { PapertradeClient, estimateClose, liquidationPriceRaw, priceFromRaw, priceToRaw, usdToWad } from 'papertrade-sdk';

const btc = (await new PapertradeClient().tradingState()).instruments[0];
const entry = priceToRaw(83000, btc.priceScale);
const est = estimateClose({
  instrument: btc,
  isLong: true,
  entryPriceRaw: entry,
  exitPriceRaw: priceToRaw(83400, btc.priceScale),
  marginRaw: usdToWad(100),
  leverage: 500,
});
console.log(est.netPnlUsd, est.keptFraction);   // net after impact and fee, share of the raw gain kept
const bust = liquidationPriceRaw({ entryPriceRaw: entry, leverage: 500, isLong: true, bustBufferRaw: btc.bustBufferRaw });
console.log(priceFromRaw(bust, btc.priceScale)); // exact protocol bust price
```

## Deposits

```ts
import { PapertradeClient, buildHyperEvmDeposit } from 'papertrade-sdk';

// walletClient: a viem WalletClient for the same account on the `hyperEvm` chain exported by this SDK.
// 25 USDC from HyperEVM. Includes an approve call only if the allowance is short.
const { proxy, calls } = await buildHyperEvmDeposit({ user: wallet.address, amount: 25_000_000n });
for (const call of calls) {
  console.log(call.description);                 // show each call before the wallet signs it
  await walletClient.sendTransaction({ to: call.to, data: call.data, value: call.value });
}
await new PapertradeClient().checkDepositAddress(wallet.address); // ask the relayer to sweep `proxy` now
```

`buildHyperCoreDeposit()` builds the HyperCore `spotSend` route instead.

## Charts

`planPriceTiles`, `mergePriceTiles` and `toOhlc` turn Papertrade's tiled price history into candles. `fetchCandles` reads Hyperliquid's own candles for the same asset. Both feed straight into TradingView Lightweight Charts.

## Browser apps and CORS

`exchange.papertrade.xyz` sends no CORS headers. In a browser on your own origin, run a same-origin proxy and point the SDK at it:

```ts
new PapertradeClient({ baseUrl: '/api/papertrade' });
```

A complete Cloudflare Pages Function proxy is in [site/functions/api/papertrade/[[path]].ts](site/functions/api/papertrade/[[path]].ts).

## API surface

| Module | Exports |
|---|---|
| Client | `PapertradeClient`: every read endpoint, `submitIntent`, `cancelIntent`, `retryOnward`, `checkDepositAddress` |
| Trading | `PapertradeTrader`, `PreparedIntent`, `validateOpen`, `withdrawalActivationFee`, `MIN_WITHDRAWAL_USDC` |
| Signing | `signIntent`, `inspectSignedIntent`, `hashIntent`, `computeIntentId`, `exchangeDomain`, `paperStakingDomain`, `cancellationDomain`, `PAPERTRADE_TYPES` |
| Session | `createSessionKey`, `restoreSessionKey`, `isSessionKeyActive` |
| Live | `streamWallet`, `fetchWalletState`, `decodeWalletSnapshot`, `applyWalletPatch`, `SseParser` |
| Math | `estimateClose`, `liquidationPriceRaw`, `unrealizedPnlUsd`, `distanceToLiquidation`, `openInterestUsd`, `notionalToQuantityRaw`, `paperMintRate`, `estimatePaperMinted`, `pendingStakingRewardRaw` |
| Prices | `planPriceTiles`, `mergePriceTiles`, `toOhlc`, `fetchCandles`, `fetchDayContext` |
| Funding | `computeDepositAddress`, `buildHyperEvmDeposit`, `buildHyperCoreDeposit`, `usdcBalance`, HyperCore action builders |
| On chain | `paperBalance`, `paperTotalSupply`, `pendingReward`, `stakingState`, `hyperEvm` (viem chain) |
| Constants | `MAINNET`, `INTENT_TTL_SECONDS`, `SESSION_KEY_TTL_SECONDS`, `MAX_CLOSE_BATCH`, unit helpers |

## Examples

```bash
npx tsx examples/market.ts                          # live market overview
npx tsx examples/watch-wallet.ts 0xWALLET           # stream positions with bust distance
npx tsx examples/estimate.ts BTC long 100 500       # what a close would pay
PAPERTRADE_WALLET_KEY=0x... npx tsx examples/trade.ts BTC long 10 1000            # dry run
PAPERTRADE_WALLET_KEY=0x... npx tsx examples/trade.ts BTC long 10 1000 --submit   # asks "yes" first
```

## Development

```bash
npm install
npm test            # recorded mainnet fixtures
npm run test:live   # against production API and HyperEVM RPC
npm run build
npm run dev:site    # landing page and API proxy on http://localhost:8788
npm run deploy:site # publish site/ to Cloudflare Pages (project "papertrade-sdk")
```

The site in `site/` is a Cloudflare Pages project. It bundles `site/app.ts` (the SDK running in the browser) into `site/public/`, and `site/functions/api/papertrade/[[path]].ts` proxies the allowlisted Papertrade endpoints. Set `PAPERTRADE_API_URL` in `site/wrangler.toml` to point the proxy at a different upstream.

## The Papertrade toolkit

Docs: [official Papertrade docs](https://docs.papertrade.xyz), [protocol reference](docs/PROTOCOL.md), and for AI agents [AGENTS.md](AGENTS.md) and [llms.txt](llms.txt).

Nine open-source building blocks for [Papertrade](https://papertrade.xyz), the fully on-chain 1000x perps exchange on Hyperliquid HyperEVM. Use them together or on their own.

| Project | What it does |
|---|---|
| [papertrade-ai](https://github.com/nirholas/papertrade-ai) | MCP server and CLI: trade Papertrade from Claude, ChatGPT, Cursor and any MCP client |
| **papertrade-sdk** (this repo) | Typed API client, live account stream, EIP-712 signing and verified settlement math. |
| [papertrade-terminal](https://github.com/nirholas/papertrade-terminal) | Non-custodial web trading terminal with charts, order ticket, funding and swaps. |
| [papertrade-analytics](https://github.com/nirholas/papertrade-analytics) | DefiLlama-style dashboard and JSON API: TVL, volume, OI, PAPER economics. |
| [papertrade-explorer](https://github.com/nirholas/papertrade-explorer) | Linkable wallet pages, decoded transactions and a live leaderboard. |
| [papertrade-liquidations](https://github.com/nirholas/papertrade-liquidations) | Liquidation map and closest-to-bust feed, recomputed with the verified formula. |
| [papertrade-yield](https://github.com/nirholas/papertrade-yield) | PAPER staking dashboard with realized USDC yield and wallet-signed actions. |
| [papertrade-alerts](https://github.com/nirholas/papertrade-alerts) | Know before the liquidation: Telegram, Discord and webhook alerts. |
| [papertrade-copytrade](https://github.com/nirholas/papertrade-copytrade) | Guard-railed copy-trading CLI. Dry run by default. |
| [papertrade-x402](https://github.com/nirholas/papertrade-x402) | Pay-per-call intelligence API for AI agents, paid in USDC on Solana or Base. |

## Contributing and support

- Found a bug or want a feature? [Open an issue](https://github.com/nirholas/papertrade-sdk/issues/new/choose).
- Questions and show-and-tell: [Discussions](https://github.com/nirholas/papertrade-sdk/discussions).
- Pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](SECURITY.md).
- If this saved you time, a star helps other Papertrade traders and builders find it.

Built by [three.ws](https://three.ws).

## License

Apache-2.0
