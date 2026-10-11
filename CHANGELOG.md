# Changelog

## 0.2.0 (2026-10-11)

- Hosted read-only MCP server at `/mcp`: stateless Streamable HTTP with JSON-RPC batches, SSE single-message replies, CORS and rate limiting. Seven tools: `papertrade_markets`, `papertrade_estimate_position`, `papertrade_paper_mint`, `papertrade_wallet_positions`, `papertrade_protocol_health`, `papertrade_prepare_open` and `papertrade_build_typed_data` (unsigned payloads only).
- Docs site at `/docs/` with sidebar, search, per-page Markdown twins and a Connect your AI page for Claude, ChatGPT, Codex, Gemini, Cursor, VS Code, Windsurf, Zed, Cline, Goose and Continue.
- Agent discovery files: `llms.txt`, `llms-full.txt`, OpenAPI 3.1, MCP server card, A2A agent card, RFC 9727 API catalog, robots.txt with Content Signals, `server.json` for the MCP registry and `Link` headers on the home page.
- Playground with a live SDK estimator and an MCP console, light and dark themes, `?embed=1` mode and an Open in Papertrade OS link. The site can be framed by Papertrade OS.
- Fix: `src/live.ts` and `src/nonce.ts` now type-check under Workers types.

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
