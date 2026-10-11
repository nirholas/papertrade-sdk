---
title: SDK reference
description: The public surface of papertrade-sdk grouped by module, with the read client methods and the REST paths they call.
order: 4
---
# SDK reference

Everything is exported from the package root: `import { ... } from 'papertrade-sdk'`.

## Modules

| Module | Exports |
|---|---|
| Client | `PapertradeClient` (every read endpoint, `submitIntent`, `cancelIntent`, `retryOnward`, `checkDepositAddress`), `HttpTransport`, `PapertradeApiError` |
| Trading | `PapertradeTrader`, `PreparedIntent`, `validateOpen`, `withdrawalActivationFee`, `MIN_WITHDRAWAL_USDC` |
| Signing | `signIntent`, `inspectSignedIntent`, `hashIntent`, `computeIntentId`, `exchangeDomain`, `paperStakingDomain`, `cancellationDomain`, `domainFor`, `toWireMessage`, `PAPERTRADE_TYPES` |
| Session | `createSessionKey`, `restoreSessionKey`, `isSessionKeyActive` |
| Live | `streamWallet`, `fetchWalletState`, `decodeWalletSnapshot`, `applyWalletPatch`, `SseParser` |
| Math | `estimateClose`, `liquidationPriceRaw`, `unrealizedPnlUsd`, `distanceToLiquidation`, `openInterestUsd`, `notionalToQuantityRaw`, `paperMintRate`, `estimatePaperMinted`, `pendingStakingRewardRaw` |
| Prices | `planPriceTiles`, `mergePriceTiles`, `toOhlc`, `fetchCandles`, `fetchDayContext` |
| Units | `usdToWad`, `wadToNumber`, `wadToString`, `parseUnits`, `formatUnits`, `priceFromRaw`, `priceToRaw`, `formatUsdCompact` |
| Deposits | `buildHyperEvmDeposit`, `buildHyperCoreDeposit` |
| Constants | `MAINNET`, `INTENT_TTL_SECONDS`, `MAX_CLOSE_BATCH`, `MIN_DEPOSIT_USDC` |

## Client options

```ts
new PapertradeClient({
  baseUrl: 'https://exchange.papertrade.xyz', // or a same-origin proxy such as /api/papertrade
  fetch,            // custom fetch (tests, Workers, instrumentation)
  retries: 3,       // 429 / 5xx / network errors, honoring Retry-After
  timeoutMs: 20000,
  clientBuild: 'my-app',
  headers: {},
});
```

Query strings are canonical (sorted, unique, no unknown keys) because the API rejects anything else. Always go through the client. Errors are `PapertradeApiError` with `status`, `code`, `reason` and a plain-language message.

## Read methods

| Method | Endpoint |
|---|---|
| `protocolSummary()` | `GET /query/protocol/summary` |
| `protocolHistory(interval)` | `GET /query/protocol/history` |
| `marketStats()`, `queueSummary()` | `GET /query/protocol/market-stats`, `/query/protocol/queue-summary` |
| `recentTrades()`, `paperActivity()` | `GET /query/protocol/trades/recent`, `/query/protocol/paper/activity` |
| `notices()`, `ready()`, `relayerHealth()` | `GET /query/notices`, `/query/ready`, `/relayer/health` |
| `tradingState()` | `GET /state/trading` (decoded to bigint fields) |
| `priceHistory(request)` | `GET /query/markets/{id}/price-history`, planned into the required tile grid and merged |
| `liquidationMap(id, range)` | `GET /query/markets/{id}/liquidation-map` |
| `positionTopology()`, `houseDelta(coin)`, `houseCurrent()` | `GET /state/protocol/position-topology`, `/state/house/delta`, `/state/house/current` |
| `leaderboard(options)`, `leaderboardPlacement()`, `leaderboardPositions()` | `GET /state/leaderboard/...` |
| `accountTrades/Cashflows/Staking/Queue(address)` | `GET /query/accounts/{address}/...` (cursor pages; use `paginate`) |
| `portfolioHistory()`, `accountFunding()`, `queueRank()` | per-account reads |
| `submitIntent()`, `cancelIntent()`, `retryOnward()`, `checkDepositAddress()` | the only writes: already-signed intents and the deposit registration |

## Live stream

`streamWallet({ wallet, baseUrl?, fetch?, onState, onStatus?, signal? })` subscribes to `/state/user/live` (server-sent events), applies revision-checked patches, reconnects with backoff, honors `Retry-After`, and re-snapshots when it falls out of sync. It returns a stop function. `fetchWalletState(address)` resolves with the first full snapshot and closes the stream.

## Trader

`PapertradeTrader` has a `prepare*` method (signs, does not send, returns a `summary`) and a submitting counterpart for each action: `registerSession`, `openPosition`, `closePositions`, `cancel`, `withdraw`, `stake`, `unstake`, `claim`. `validateOpen(params, tradingState)` throws a plain-language error when the relayer would reject an open.

## Typed data without a key

`toWireMessage`, `domainFor` and `hashIntent` build and hash any intent without a signer. The MCP tool `papertrade_build_typed_data` is a wrapper around exactly these.
