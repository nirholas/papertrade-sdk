# Changelog

## 0.1.0 (2026-10-10)

First release.

- `PapertradeClient` for every public read endpoint, with canonical query strings, retries and plain-language errors.
- `streamWallet` / `fetchWalletState`: the live SSE account stream with revision-checked patches and reconnects that honor `Retry-After` on rate limits.
- EIP-712 signing for every intent, with `PapertradeTrader` prepare and submit flows for session keys, opens, closes, cancels, withdrawals and PAPER staking (stake, unstake, claim; distribution is relayer-only).
- Deposit builders for the HyperEVM and HyperCore routes.
- Settlement math verified against mainnet: liquidation prices, winning and losing closes, liquidations, the PAPER mint curve and staking rewards.
- Price tile planning and OHLC conversion for charts.
- `openInterestUsd` and `notionalToQuantityRaw`: instrument OI and caps are base-asset quantities, priced at the mark for dollars. `validateOpen` checks the OI cap in those units when given `markPriceRaw`.
- Typed `houseCurrent()` (`HouseCurrent`, the columnar LP and open-notional series).
