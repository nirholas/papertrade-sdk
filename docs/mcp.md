---
title: MCP server
description: The read-only Papertrade MCP server at /mcp: endpoint, transport, the seven tools with schemas and examples.
order: 5
---
# MCP server

Endpoint: `https://papertrade-sdk.pages.dev/mcp`

It speaks MCP over Streamable HTTP, stateless: one `POST` per JSON-RPC 2.0 message (batches are accepted), no session header, no login. Protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05` are supported; an unknown client version gets `2025-06-18`.

**Everything is read-only.** The tools read the public Papertrade API, run the SDK's verified math, or build **unsigned** EIP-712 payloads. No tool signs, sends, deposits, withdraws or places an order. Wallet signing stays in the user's own wallet. Every tool carries `readOnlyHint: true` and `destructiveHint: false`.

## Transport details

| Request | Response |
|---|---|
| `POST /mcp` with JSON-RPC | `200 application/json`, or a single SSE `message` event when the client accepts only `text/event-stream` |
| `POST` of a notification (for example `notifications/initialized`) | `202`, no body |
| `GET /mcp` with `Accept: text/event-stream` | `405` with `Allow: POST` (no server-initiated stream) |
| `GET /mcp` otherwise | A JSON description of the server and its tools |
| `DELETE /mcp` | `405` (there are no sessions to end) |
| `OPTIONS /mcp` | `204` CORS preflight; `*` origin, headers include `Mcp-Session-Id`, `Mcp-Protocol-Version`, `Authorization` |

Methods: `initialize`, `ping`, `tools/list`, `tools/call`, plus empty `resources/list` and `prompts/list`. Protocol errors use the standard codes (`-32700` parse, `-32600` invalid request, `-32601` unknown method, `-32602` unknown tool or bad params). Bad tool arguments and upstream outages come back as a normal result with `isError: true` and a message the model can act on. Results include `content` text and `structuredContent` matching each tool's `outputSchema`.

## Try it

```bash
curl -s https://papertrade-sdk.pages.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"papertrade_estimate_position","arguments":{"market":"BTC","side":"long","marginUsd":100,"leverage":500,"priceMovePct":0.1}}}'
```

A real result (BTC at 82,800.3 when this was written):

```json
{
  "market": "BTC", "side": "long", "marginUsd": 100, "leverage": 500, "notionalUsd": 50000,
  "entryPrice": 82800.3, "entrySource": "live mark",
  "bustPrice": 82674, "distanceToBustPct": 0.1525,
  "openValidation": { "accepted": true, "problem": null },
  "scenarios": [{
    "exitPrice": 82883.1, "priceMovePct": 0.1,
    "rawPnlUsd": 50, "adjustedPnlUsd": 36.99, "winFeeUsd": 0.74, "netPnlUsd": 36.25,
    "netReturnOnMarginPct": 36.2, "keptFractionOfRawGain": 0.7249, "liquidated": false
  }]
}
```

The raw $50 gain keeps about 72% after the deadband, impact haircut and 2% fee. That gap is why quoting before trading matters.

## Tools

{{tools}}

## Limits

Each client IP may make 60 tool calls per minute (best effort, per edge isolate). Requests are capped at 64 KB and batches at 20 messages. Wallet snapshots time out after 9 seconds. Upstream calls retry once.

## Building typed data safely

`papertrade_prepare_open` and `papertrade_build_typed_data` return a `typedData` object and an `eth_signTypedData_v4` request. The flow for an agent is: call the tool, show the user the `summary` and bust price, get an explicit yes, then let the user's own wallet or session key sign, and submit with `PapertradeClient.submitIntent`. The server never holds keys and cannot submit for you.
