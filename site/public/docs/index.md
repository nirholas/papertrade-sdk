# Overview

Source: https://papertrade-sdk.pages.dev/docs/

`papertrade-sdk` is an unofficial TypeScript SDK for [Papertrade](https://papertrade.xyz), the fully on-chain synthetic perpetuals exchange on Hyperliquid's HyperEVM (chain 999). BTC and ETH trade up to 1000x leverage, settled at the Hyperliquid mid price.

> **Unofficial.** An independent community project, not affiliated with or endorsed by Papertrade. 1000x leverage can lose your whole margin within seconds. Nothing here is financial advice.

## What you get

| Piece | What it does |
|---|---|
| **SDK** (`npm install papertrade-sdk viem`) | A typed client for every public read endpoint, the live wallet stream, EIP-712 signing for every intent, deposit builders and settlement math. Works in Node 20+, browsers, Bun, Deno and Cloudflare Workers. |
| **Settlement math** | Liquidation prices, winning and losing closes, liquidations, the PAPER mint curve and staking rewards. Checked against mainnet: 205 of 205 live bust prices, 15 of 15 leaderboard wins, and `PaperStaking.pendingReward` to the wei. |
| **MCP server** at `https://papertrade-sdk.pages.dev/mcp` | Seven read-only tools so any AI client can quote a position exactly, inspect a wallet, check protocol health and build unsigned EIP-712 payloads. See [MCP server](mcp). |
| **Playground** on the [home page](/) | Run the SDK math in your browser against live prices and call every MCP tool from a console. |
| **Docs and agent files** | This site, plus `llms.txt`, `llms-full.txt`, an OpenAPI spec, an MCP server card and an A2A agent card. See [Agent discovery](discovery). |

## Where to start

- Building an app: [Quickstart](quickstart), then the [SDK reference](reference).
- Using an AI assistant: [Connect your AI](connect).
- Understanding the numbers: [Concepts](concepts) and the full [Protocol reference](protocol).

## The Papertrade toolkit

This SDK is the base of a suite of independent tools. Each one runs on its own, and all of them can open inside [Papertrade OS](https://papertrade-os.pages.dev).

- [Terminal](https://papertrade-terminal.pages.dev): non-custodial trading terminal.
- [Analytics](https://papertrade-analytics.pages.dev): TVL, volume, open interest, PAPER economics.
- [Explorer](https://papertrade-explorer.pages.dev): wallets, positions, intents, leaderboard.
- [Liquidations](https://papertrade-liquidations.pages.dev): liquidation map and closest-to-bust feed.
- [Yield](https://papertrade-yield.pages.dev): PAPER staking.
- [Alerts](https://papertrade-alerts.ninabrekkerese.workers.dev): Telegram, Discord and webhook alerts.
- [Copytrade](https://papertrade-copytrade.pages.dev): copy-trading with guardrails.
- [x402](https://papertrade-x402.pages.dev): pay-per-call intelligence API.
