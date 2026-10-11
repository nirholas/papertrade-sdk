# FAQ

Source: https://papertrade-sdk.pages.dev/docs/faq

**Is this official?** No. It is an independent community project, not affiliated with Papertrade.

**Can the MCP server trade for me?** No. It can quote, read and build unsigned payloads. You sign in your own wallet.

**How accurate is the settlement math?** `liquidationPriceRaw` matched 205 of 205 live bust prices, `estimateClose` reproduced 15 of 15 leaderboard wins plus a loss and a liquidation, and staking rewards match the contract to the wei. `npm run test:live` re-checks production.

**Why is the EIP-712 domain name `String`?** Because that is what the deployed exchange uses. A mainnet signature only verifies under that name. Do not change it.

**Why do I get CORS errors in the browser?** `exchange.papertrade.xyz` sends no CORS headers. Use a same-origin proxy and set `baseUrl`. This site ships one.

**Why is my quoted profit lower than price move times notional?** Wins lose a deadband, an impact haircut and a 2% fee. Use `estimateClose` or `papertrade_estimate_position`.

**Why is `longOiRaw` not a dollar amount?** OI is stored as base-asset quantity. Multiply by the mark with `openInterestUsd`.

**Can a session key withdraw?** No. Only the wallet can withdraw, stake, unstake or claim.

**My client says the server does not support SSE.** It does not open server-initiated streams; every call is a plain POST. Clients that require a GET stream still work because they fall back after the `405`.

**Where are the other tools?** See the toolkit list on the [Overview](index).
