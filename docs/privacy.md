---
title: Privacy
description: What data the hosted Papertrade MCP server and proxy receive, what they keep, and who else sees it.
order: 11
---
# Privacy

This page covers the hosted MCP server at `https://papertrade-sdk.pages.dev/mcp` and the same-origin proxy under `/api/papertrade`. The SDK itself runs in your process and sends nothing to this project.

## What the server receives

- The JSON-RPC request you send: the tool name and its arguments (for example a market symbol, a margin amount, or a public wallet address for `papertrade_wallet_positions`).
- Your client IP address, which Cloudflare supplies in the `cf-connecting-ip` header.

## What it does with it

- The IP address is used only as the key of an in-memory rate limiter (60 tool calls per minute). It is not written to a database, file or log by this project's code and is lost when the isolate restarts.
- Tool arguments are used to call the public Papertrade API (`exchange.papertrade.xyz`) or to run local math, and the result is returned to you. Responses are sent with `cache-control: no-store`.
- There are no accounts, no cookies and no analytics, and the server never holds or receives private keys. Tools that touch intents return unsigned typed data only.

## Who else sees it

- Cloudflare hosts the site and processes requests under its own terms and logging.
- Wallet addresses and market queries are forwarded to Papertrade's public API, which applies its own policies.

Wallet positions are public on-chain data. Do not put secrets in tool arguments.

Questions or removal requests: open an issue at https://github.com/nirholas/papertrade-sdk/issues.
