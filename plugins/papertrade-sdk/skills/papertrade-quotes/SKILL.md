---
name: papertrade-quotes
description: Quote Papertrade perpetual positions, read live markets and wallet positions, check protocol health and build unsigned EIP-712 intents using the hosted read-only Papertrade MCP server or the papertrade-sdk TypeScript package. Use when the user asks about Papertrade (HyperEVM perps) trading math.
---

# Papertrade SDK and MCP

Papertrade (papertrade.xyz) is a 1000x synthetic perps exchange on HyperEVM. This is an unofficial community SDK. The plugin's `.mcp.json` connects to the hosted, stateless, read-only MCP server at `https://papertrade-sdk.pages.dev/mcp` (Streamable HTTP, no login). No tool signs, sends, deposits, withdraws or opens a position.

## MCP tools

| Tool | Use |
|---|---|
| `papertrade_markets` | Live mark price, max leverage, open interest and caps (optional `market`, BTC or ETH). |
| `papertrade_estimate_position` | Quote before opening: bust price, open validation, and scenarios with deadband, impact haircut and fee. Required: `market`, `side`, `marginUsd`, `leverage`. Optional: `entryPrice`, `exitPrice`, `priceMovePct`. |
| `papertrade_paper_mint` | PAPER minted for a realized loss (`lossBasisUsd`) on the current mint curve. |
| `papertrade_wallet_positions` | Open positions and balances for any `address` (public on-chain data). |
| `papertrade_protocol_health` | Relayer readiness and whether trading is paused. |
| `papertrade_prepare_open` | Validate an open against live limits and return unsigned typed data. Required: `user`, `market`, `side`, `marginUsd`, `leverage`. |
| `papertrade_build_typed_data` | Build an unsigned EIP-712 payload for an intent (`type`, `message`). |

Limits: 60 tool calls per minute per IP, 64 KB requests. Upstream outages return `isError: true` with an actionable message.

## Example

Call `papertrade_estimate_position` with `{"market":"BTC","side":"long","marginUsd":100,"leverage":500,"priceMovePct":0.1}`. Report `bustPrice`, `distanceToBustPct` and each scenario's `netPnlUsd`. The net is usually well below the raw gain because of the deadband, impact haircut and 2% fee, so always show both.

## Building and signing safely

`papertrade_prepare_open` and `papertrade_build_typed_data` return a `typedData` object and an `eth_signTypedData_v4` request plus a `summary`. Show the user the summary and bust price, get an explicit yes for that specific action, and let their own wallet or session key sign. Never submit an open, close, withdrawal, stake or deposit without that confirmation.

## SDK

The package is not on npm. Clone https://github.com/nirholas/papertrade-sdk, then `npm install` and `npm run build` (tsup). `viem` is a peer dependency, Node 20+.

```ts
import { PapertradeClient, estimateClose, liquidationPriceRaw, priceToRaw, usdToWad } from 'papertrade-sdk';

const btc = (await new PapertradeClient().tradingState()).instruments[0];
const entry = priceToRaw(83000, btc.priceScale);
const est = estimateClose({ instrument: btc, isLong: true, entryPriceRaw: entry,
  exitPriceRaw: priceToRaw(83083, btc.priceScale), marginRaw: usdToWad(100), leverage: 500 });
```

Other entry points: `streamWallet({ wallet, onState })`, `fetchWalletState(address)`, `PapertradeTrader` (session-key trading, `prepareOpen`, `submit`). `exchange.papertrade.xyz` sends no CORS headers, so browsers need a same-origin proxy via `new PapertradeClient({ baseUrl })`. More: `docs/quickstart.md`, `docs/mcp.md`, `docs/security.md`.
