# Concepts

Source: https://papertrade-sdk.pages.dev/docs/concepts

The complete, verified derivations are in the [Protocol reference](protocol). This page is the working summary.

## Units

- **USD values are 18-decimal integers ("wad").** Use `usdToWad`, `wadToNumber` and `formatUnits`. Never use floats for money you intend to sign.
- **HyperEVM USDC has 6 decimals, HyperCore USDC has 8.** `wadToUsdc` converts.
- **Prices are integers divided by a per-instrument `priceScale`** (BTC 10, ETH 100). `priceFromRaw` and `priceToRaw` convert.
- **Open interest and caps are base-asset quantities** (wad BTC or ETH), not dollars. Price them at the mark with `openInterestUsd`.

## Markets and limits

- Instruments: BTC (id 0) and ETH (id 1). Leverage is a whole number up to the market maximum (1000x at launch).
- Minimum margin is 10 USD and minimum notional (margin times leverage) is 10,000 USD. Maximum position is 10M USD notional.
- `OpenPosition.size` is the **margin**, not the notional.
- Prices settle on the Hyperliquid BBO mid, read through `priceHistory` at 125 ms, 1 s or 1 min resolution.

## Bust (liquidation) price

For a long, `bust = ceil(entry * (L - 1) / L) * (1 + buffer)`. For a short, `bust = ceil(entry * (L + 1) / L * (1 - buffer))`. The buffer is about 4.76 bps. At 500x a long is liquidated about 0.15% below entry. `liquidationPriceRaw` reproduces the protocol integer exactly.

## How a close settles

1. **Loss:** you lose the raw loss, with nothing on top. Crossing the bust price forfeits the full margin.
2. **Win:** the raw gain first loses an integer **deadband** (entry / 50,000), then an **asymmetric impact haircut** that grows with the size of the move and the position, then a **2% win fee**.
3. `estimateClose` returns each stage, plus `keptFraction`, the share of the raw gain you keep.

## PAPER

PAPER is minted on realized losses (the loss basis is 98% of the loss) at a rate that is flat at 100 per 1 USD while tracked LP is under 2M USD, then decays with the tail-progress high-water mark. `paperMintRate` and `estimatePaperMinted` implement the curve. Staked PAPER earns protocol fees; `pendingStakingRewardRaw` computes pending rewards with 1e27 precision.

## Intents, session keys and nonces

- Every action is an EIP-712 **intent** posted to the relayer. The exchange domain name is the literal string `String`, which is correct and verified against a mainnet signature.
- A **session key** is registered once by the wallet and can sign opens, closes and cancels. It cannot withdraw, stake, unstake or claim.
- Intent ids are `keccak256(keccak256("papertrade:intent-id:v2") ++ digest ++ signer)`.
- Nonces only need to be unique per (user, lane). PAPER actions use their own lane. Deadlines are at most one hour out.
- Intent POSTs are retried only on HTTP 429 or 503 and never after a network error, so a trade is never sent twice.
