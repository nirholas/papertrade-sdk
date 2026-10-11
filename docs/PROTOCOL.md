---
title: Protocol reference
description: Endpoints, SSE stream, EIP-712 schemas, intent ids, settlement math, staking and withdrawals, verified against mainnet.
order: 12
---
# Papertrade protocol reference (unofficial)

This is an independent, community-written reference for building on [Papertrade](https://papertrade.xyz). It is not affiliated with or endorsed by the Papertrade team. The official docs live at [docs.papertrade.xyz](https://docs.papertrade.xyz).

Every number and formula on this page was checked against live mainnet data. The checks run in this repository's test suite (`npm test` for recorded fixtures, `npm run test:live` against production). Where something has not been verified, the page says so.

- [What Papertrade is](#what-papertrade-is)
- [Deployment](#deployment)
- [Units](#units)
- [Read API](#read-api)
- [Live wallet stream](#live-wallet-stream)
- [Writing: signed intents](#writing-signed-intents)
- [EIP-712 schemas](#eip-712-schemas)
- [Intent ids and nonces](#intent-ids-and-nonces)
- [Settlement math](#settlement-math)
- [PAPER and staking](#paper-and-staking)
- [Deposits](#deposits)
- [Withdrawals](#withdrawals)
- [Errors](#errors)

## What Papertrade is

Papertrade is a fully on-chain synthetic perpetuals exchange on Hyperliquid's HyperEVM (chain 999). It offers BTC and ETH, up to 1000x leverage, and one-click market opens and closes. There is no order book.

- **Pricing.** Every trade is a synthetic swap against the protocol LP at Hyperliquid's BBO mid, read through a HyperCore precompile. There is no spread, slippage or funding.
- **Fees.** There is no fee on notional. Winning closes pay an asymmetric impact haircut on the gain, then a 2% win fee. Losing closes pay exactly the loss.
- **The LP.** The LP starts at $0 and grows from trader losses (the Martingaler design). When the LP cannot cover a win, the payout joins a FIFO queue, and later losses pay it.
- **PAPER.** Losses mint PAPER, the LP fee-claim token. Staked PAPER earns USDC.
- **Balances.** USDC lives on HyperCore. Trading state lives in the Exchange contract on HyperEVM.
- **Relayer.** Traders sign EIP-712 intents. A relayer batches them on chain through a BatchExecutor contract.

## Deployment

| Item | Value |
|---|---|
| Chain | HyperEVM mainnet, chain id `999` |
| RPC | `https://rpc.hyperliquid.xyz/evm` (fallback `https://rpc.hypurrscan.io`) |
| Explorer | `https://hyperevmscan.io` |
| Papertrade API | `https://exchange.papertrade.xyz` |
| Exchange | `0x6cd5661646289fb6e65ea5c032310fded797d0a2` |
| BatchExecutor | `0x233ff29b239abc1d7748605da9b205c3e008626e` |
| PAPER token | `0xe40f17915daa230324030003a197cdaef2261c0e` |
| PaperStaking | `0xaad6c7b0cc3014fc80ffedae0ed7ce5967b0f016` |
| DepositProxyFactory | `0x1629b7d46bef6e13ff754174fc9f32dea309b38f` |
| CoreDepositWallet | `0x6b9e773128f453f5c2c60935ee2de2cbc5390a24` |
| USDC (HyperEVM, 6 dp) | `0xb88339cb7199b77e23db6e890353e22632ba630f` |
| Governance multisig | `0x696292762fd5ac3677a45edbe54eaece4194d1f6` |
| Timelock | `0xb915fa41e824d6aa31bb833ee81220c0f2c8ea0f` |

Instruments:

| id | Symbol | Hyperliquid asset index | Price scale |
|---|---|---|---|
| 0 | BTC | 0 | 10 (raw `829915` = $82,991.5) |
| 1 | ETH | 1 | 100 (raw `249565` = $2,495.65) |

Limits come from `/state/trading` at runtime: minimum margin $10, minimum notional $10,000, maximum notional per position $10M, and maximum leverage 1000x.

## Units

- **USD amounts** (balances, margin, PnL) are 18-decimal integers serialized as decimal strings ("wad").
- **USDC on chain** has 6 decimals. Convert with `wad = usdc * 10^12`.
- **Prices** are integers in raw units: `price = raw / priceScale`.
- **PAPER** has 18 decimals.

## Read API

Base URL `https://exchange.papertrade.xyz`. Every response is JSON.

- **Canonical query strings.** The API rejects a query string that is not canonical. Each parameter may appear once, sorted by name, URLSearchParams-encoded, with no unknown keys. `canonicalQuery()` builds one.
- **No CORS headers.** Browser apps on another origin need a same-origin proxy. Every papertrade-* site ships one as a Cloudflare Pages Function.

| Path | What it returns |
|---|---|
| `GET /state/trading` | Trading state: pause flag, minimums, `accRewardPerShareRaw`, the instrument tuples and intake. Decode with `decodeTradingState`. |
| `GET /query/protocol/summary` | TVL, LP, reserve, queue, volume, open count, fees, and the PAPER supply, staked amount, tracked LP and tail progress. |
| `GET /query/protocol/history?interval=1d\|1h` | Columnar TVL, volume, PnL, users, liquidations, trades and PAPER series. |
| `GET /query/protocol/market-stats` | 24h volume per market. |
| `GET /query/protocol/queue-summary` | Payout queue total, count, largest and front. |
| `GET /query/protocol/trades/recent` | The latest opens and closes across the protocol. |
| `GET /query/protocol/paper/activity` | Recent PAPER mints, stakes and claims. |
| `GET /query/markets/{id}/price-history?fromMs&intervalMs&toMs` | Exactly one price tile (see below). |
| `GET /query/markets/{id}/liquidation-map?range=5` | Long and short notional by bust-price bucket. |
| `GET /state/protocol/position-topology` | Aggregate open-position topology. |
| `GET /state/house/current`, `GET /state/house/delta?coin=BTC` | House (LP) exposure. `current` is columnar: `head` is the latest `[timeMs, lp, pnl, q, bl, bs, el, es]` (USD: LP equity, trader PnL, queue, then BTC long, BTC short, ETH long and ETH short open notional), and `heads` maps an interval in ms (`1000`, `60000`, `3600000`, `86400000`) to `{baseTimeMs, timeOffsetsMs[], columns}`. |
| `GET /state/leaderboard/accounts?page&pageSize&sortDir&sortKey&window` | Leaderboard. The response key is `accounts`. |
| `GET /state/leaderboard/accounts/{wallet}?window=24h` | One wallet's placement. |
| `GET /state/leaderboard/positions?window=24h\|all` | Top settled positions (`rows`). |
| `GET /query/accounts/{wallet}/trades?cursor&filter=all\|losses` | Closed trades, 75 per page, with `adjustedPnlRaw`, `userPaidFeeRaw`, `paperMintedRaw` and `paperMintBasisRaw`. `kind` is `PositionClosed` or `Liquidated`. |
| `GET /query/accounts/{wallet}/cashflows`, `/staking`, `/queue` | Paged account histories. |
| `GET /query/accounts/{wallet}/portfolio-history?range=1h\|1d\|1w\|all` | Equity and PnL series. |
| `GET /query/accounts/{wallet}/funding` | Funding items plus `coreAccount` (whether a HyperCore account exists). |
| `GET /queue-rank/accounts/{wallet}` | Queue position. |
| `GET /relayer/health`, `GET /query/ready` | Health. |
| `POST /intents` | Submit a signed intent (see below). |
| `POST /intents/{intentId}/cancel` | Cancel a queued intent. |
| `POST /funding/deposits/check` | Ask the relayer to sweep a deposit address. |

### Price tiles

Price history is served as fixed tiles at three resolutions, and a request must cover exactly one tile:

| Interval | Tile length | Retained for |
|---|---|---|
| 125 ms | 1 minute | 5 minutes |
| 1 s | 15 minutes | 3 hours |
| 1 min | 6 hours | forever |

`planPriceTiles()` picks the finest tier whose retention still covers the window and keeps it under 5000 points. It returns the aligned tile requests. `mergePriceTiles()` joins the responses, and `toOhlc()` buckets them into candles.

## Live wallet stream

`GET /state/user/live?wallet=0x...` with `Accept: text/event-stream` streams a wallet's state.

- **`liveness`** events carry `{heartbeatIntervalMs}`. Treat 3x that interval (capped at 45 s) of silence as a dead connection.
- **The first `wallet` event is a full snapshot.** It carries balances, `funds`, `paper` {balance, staked, pendingBase, rewardDebt}, `lifetime` totals, `sessionKeys` [[key, expiry]], `openPositions` and `operations`.
- **Later `wallet` events are patches** carrying `baseAccountRevision`. A patch applies only when `baseAccountRevision` equals the current `accountRevision`. Anything else means you are out of sync: reconnect and take a fresh snapshot.

Position tuple: `[positionId, instrumentId, isLong, useDebt, entryPriceRaw, marginRaw, leverage, bustPriceRaw, openedAtMs, intentId]`.

`streamWallet()` implements all of this, including reconnect with backoff. `fetchWalletState()` resolves the first snapshot.

## Writing: signed intents

Every write is an EIP-712 message signed off-chain and posted to `POST /intents` as `{ action, signed, ...extra }`.

- **`signed`** is the message in wire form: uints become decimal strings, addresses and bytes become lowercase hex, bools stay bools. `v`, `r` and `s` are added alongside.
- **The relayer** recomputes the intent id, admits or rejects the intent, and batches it on chain.
- **The receipt** echoes `action` and `intentId`. A client should check both match.

| action | Primary type | Domain | Signed by |
|---|---|---|---|
| `registerSessionKey` | RegisterSessionKey | exchange | wallet |
| `openPosition` | OpenPosition | exchange | session key |
| `closePositions` | Close | exchange | session key |
| `withdrawToCore` | WithdrawToCore | exchange | wallet |
| `paperStake` / `paperUnstake` / `paperClaim` | Stake / Unstake / Claim | PaperStaking | wallet |
| `paperDistribute` | Distribute | PaperStaking | relayer keeper only: the official client never submits it, and the relayer rejects user-signed Distribute intents with HTTP 400 |
| cancel (`POST /intents/{id}/cancel`) | CancelIntent | cancellation | the intent's signer |

### Session keys

- **Registering.** The wallet signs `RegisterSessionKey` once for a locally generated key, with `feeAddress = 0x0` and an expiry up to 30 days out.
- **What a key can do.** It signs opens and closes with no wallet prompt.
- **What it cannot do.** It cannot withdraw, stake, unstake or claim.
- **Revoking.** Revoke a key on chain with `revokeSessionKey` from the wallet.
- **Intent lifetime.** Every intent's `deadline` is at most one hour out.

Verified on mainnet:

- A Close intent signed by a key the wallet never registered is rejected with `403 unauthorized_intent`. The relayer accepts the wire format and checks authorization.
- A real batched Close from tx `0xde30ba04...f1d9` recovers the trader's registered session key under the exchange domain below.

### Opening

`OpenPosition.size` is the **margin** in wad (not notional). `leverage` is an integer.

`PapertradeTrader.validateOpen()` checks the same limits the relayer enforces, so the user gets a plain-language error before signing. It checks:

- whether trading or the market is paused,
- whether the intake action is enabled,
- maximum leverage,
- minimum margin and minimum notional,
- maximum position size,
- the side's OI cap, when you pass `markPriceRaw` (OI and caps are base-asset quantities, so the check needs a price).

### Closing

`Close.positionIds` takes up to 12 ids per intent. The SDK dedupes ids and splits larger closes into batches.

## EIP-712 schemas

Domains (all `version` fields are strings):

| Domain | name | version | verifyingContract |
|---|---|---|---|
| exchange | `String` | `1` | Exchange |
| PaperStaking | `PaperStaking` | `1` | PaperStaking |
| cancellation | `PaperTrade Intent Cancel` | `2` | Exchange |

The exchange domain name is literally `String`. A mainnet Close signature recovers to the trader's session key only under that name, and the test suite asserts that other names fail. The PaperStaking domain hashes to `0x71706d56c8b436981e93987cd97df512528491b243c6d8d1614cad52659e7eb0`, the value `PaperStaking.DOMAIN_SEPARATOR()` returns on chain.

```
RegisterSessionKey(address user,address key,uint64 expiry,address feeAddress,uint256 nonce,uint64 deadline)
OpenPosition(address user,uint32 instrumentId,bool isLong,uint128 size,uint32 leverage,bool useDebt,uint256 nonce,uint64 deadline)
Close(address user,uint256[] positionIds,uint256 nonce,uint64 deadline)
WithdrawToCore(address user,uint256 amount,uint256 nonce,uint64 deadline)
Stake(address user,uint256 amount,uint256 nonce,uint64 deadline)
Unstake(address user,uint256 amount,uint256 nonce,uint64 deadline)
Claim(address user,uint256 nonce,uint64 deadline)
Distribute(address user,uint256 nonce,uint64 deadline)
CancelIntent(address user,bytes32 intentId,uint256 deadline)
```

## Intent ids and nonces

```
digest   = EIP-712 hash of the message under its domain
intentId = keccak256( keccak256("papertrade:intent-id:v2") ++ digest ++ signerAddress )
```

This reproduces the intent ids the relayer records for mainnet intents.

Nonces only need to be unique per (user, lane):

- **Lanes.** PAPER actions use the `paper` lane. Everything else uses the `session` lane.
- **Seeding.** The official client starts each lane at a random 24-bit value times 256 and increments it by one per intent.
- **Persistence.** `NonceAllocator` does the same and persists through any `localStorage`-shaped store.

## Settlement math

Here `e` is the entry price (raw), `x` the exit price (raw), `L` the leverage, and `notional = margin * L`. Instrument parameters come from `/state/trading`:

| Tuple index | Field |
|---|---|
| 12 | `rateMultiplier` |
| 13 | `positionMultiplier` |
| 14 | `maxLeverage` |
| 15 | `maxPosition` |
| 16 | `bustBuffer` |
| 17 | `baseRate` |
| 18 | `referenceNotional` |
| 19-22 | long/short OI and caps, as base-asset quantities (wad BTC or ETH, not USD). OI times the mark equals the house `bl`/`bs`/`el`/`es` notional; `openInterestUsd()` converts. |

All are wad except `maxLeverage`.

### Bust (liquidation) price

The bust price is exact in integer math and matches all 205 sampled live positions to the raw unit.

```
long:  p0 = ceil(e * (L - 1) / L);   bust = floor(p0 * (1e18 + bustBuffer) / 1e18)
short: p0 = floor(e * (L + 1) / L);  bust = ceil(p0 * (1e18 - bustBuffer) / 1e18)
```

`bustBuffer` is about 0.048%, so liquidation fires slightly before the zero-equity price. Crossing the bust price is a hard bust: the full margin is forfeited.

### Winning close

This matches 15 of 15 leaderboard settlements to float precision.

```
deadband = floor(e / 50000)                        (integer raw units)
gainRaw  = (isLong ? x - e : e - x) - deadband
move     = gainRaw / e
scale    = (1 - baseRate) / (1 + 1/(move * rateMultiplier) + referenceNotional/(1e6 * move * positionMultiplier))
adjusted = notional * move * scale                 (= adjustedPnlRaw)
winFee   = adjusted * 0.02                         (= userPaidFeeRaw)
net      = adjusted * 0.98
```

Small moves keep a small fraction of the raw gain, and large moves keep most of it. If `gainRaw <= 0`, the close pays nothing.

### Losing close

```
loss = notional * |x - e| / e        (no deadband, no haircut, no fee on the trader)
paperMintBasis = loss * 0.98         (queue empty: the 2% LP-side fee is carved from the LP's gain)
```

### Liquidation

```
loss = margin
paperMintBasis = margin              (verified on mainnet Liquidated rows)
```

### PAPER minted

`paperMinted = paperMintBasis * rate`, where:

```
rate = 100                                     while trackedLp < $2,000,000 (including underwater)
rate = 100 * (S / (S + H))^2                   otherwise, S = $120,000,000, H = tailProgress
```

`trackedLp` and `tailProgress` come from `/query/protocol/summary` (`paper.trackedLp`, `paper.tailProgress`).

## PAPER and staking

- **Transfers.** PAPER cannot be transferred at launch. It can only be staked and unstaked through intents.
- **What stakers earn.** Staked PAPER earns USDC: 1% of the realised PnL of settled trades while no payouts are queued, plus the LP overflow above the $5M staker reward cap.

Pending reward, exact against `PaperStaking.pendingReward(user)`:

```
pending = pendingBase + staked * accRewardPerShare / 1e27 - rewardDebt
```

- `staked`, `pendingBase` and `rewardDebt` come from the live wallet stream's `paper` object.
- `accRewardPerShare` comes from `/state/trading` (or on chain).
- The precision is 1e27, not 1e18.

PaperStaking exposes `pendingReward(address)`, `accRewardPerShare()`, `totalStaked()` and `DOMAIN_SEPARATOR()`.

## Deposits

Each wallet has a personal CREATE2 deposit address:

```
DepositProxyFactory.computeProxyAddress(user)
```

USDC that reaches that address on HyperCore is swept into the trader's balance. `POST /funding/deposits/check` asks the relayer to sweep now.

- **Minimum.** At least 10 USDC must arrive after fees.
- **Activation fee.** The first deposit pays a one-time 1 USDC activation fee.

Routes:

- **From HyperCore.** Send spot USDC to the deposit address with a HyperCore `spotSend`, signed by the wallet. `buildHyperCoreDeposit()` builds it.
- **From HyperEVM.** Approve `CoreDepositWallet` for USDC, then call `depositFor(depositAddress, amount, 4294967295)`. That moves USDC from HyperEVM onto HyperCore for the deposit address. `buildHyperEvmDeposit()` returns the exact calls.
- **From other chains.** Ethereum, Arbitrum and Solana bridge through Circle CCTP. Robinhood Chain USDG bridges through Across. Both land on HyperEVM or HyperCore first.

## Withdrawals

`WithdrawToCore` is signed by the wallet. `amount` is in USDC units (6 dp) and must not exceed `funds.availableBalance` from the live stream (converted to 6 dp).

- **Activation fee.** If the wallet has never withdrawn (`lifetime.withdrawnRaw == 0`) and `/query/accounts/{w}/funding` reports `coreAccount: false`, 1 USDC is deducted for HyperCore account activation.
- **Minimum.** After that fee, at least 10 USDC must be sent.
- **Route `hypercore`.** Funds land in the wallet's HyperCore spot balance.
- **Route `hyperevm`.** The request also carries an onward `sendAsset` HyperCore action to the USDC system address `0x2000000000000000000000000000000000000000`, signed by the wallet, for `sent - 0.1 USDC` (gas allowance). The relayer submits it after the withdrawal lands, and `POST /intents/{id}/onward` retries it.

## Errors

Errors come back as `{ code, reason?, message? }`. `admission_rejected` carries a `reason`:

| reason | Meaning |
|---|---|
| `tradingPaused` | Trading is paused protocol-wide. |
| `marketPaused` | This market is paused. |
| `inactiveInstrument` | This market is no longer open for trading. |
| `belowMinimum` | Margin is below the minimum trade size. |
| `belowMinimumNotional` | Margin times leverage is below the minimum notional. |
| `leverageTooHigh` | Leverage is above the market maximum. |
| `positionTooLarge` | The position is above the per-position notional limit. |
| `openInterest` | The market has hit its OI cap on that side. |
| `funding` | Available collateral changed. |
| `noOpenPositions` | Those positions are closed or already closing. |
| `paperBalance` | Not enough unstaked PAPER. |
| `stakedBalance` | Not enough staked PAPER. |
| `sessionKeyLimit` | The wallet has too many active session keys. |
| `noDeposit` | No deposit has arrived yet. |
| `noRewards` | There are no staking rewards to claim. |
| `alreadyQueued` | An identical request is already queued. |

Other codes:

- `invalid_intent`
- `deadline_expired`
- `unauthorized_intent`
- `intent_not_found`
- `intent_conflict`
- `below_minimum_withdrawal`
- `below_minimum_paper_stake`
- `intake_action_paused`
- `invalid_onward`
- `rate_limited` (HTTP 429, honor `Retry-After`)

`PapertradeApiError` maps all of them to plain-language messages.
