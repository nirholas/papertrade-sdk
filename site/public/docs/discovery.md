# Agent discovery

Source: https://papertrade-sdk.pages.dev/docs/discovery

| Path | Content |
|---|---|
| [`/mcp`](/mcp) | The MCP endpoint (a plain `GET` describes it) |
| [`/.well-known/mcp/server-card.json`](/.well-known/mcp/server-card.json) | MCP server card: server info, streamable-http transport, capabilities and the tool list |
| [`/.well-known/mcp.json`](/.well-known/mcp.json) | Alias of the server card |
| [`/.well-known/agent-card.json`](/.well-known/agent-card.json) | A2A agent card with one skill per MCP tool |
| [`/.well-known/agent.json`](/.well-known/agent.json) | Alias of the agent card |
| [`/.well-known/api-catalog`](/.well-known/api-catalog) | RFC 9727 API catalog (`application/linkset+json`) |
| [`/openapi.json`](/openapi.json) | OpenAPI 3.1 for `POST /mcp` and the read-only API proxy |
| [`/llms.txt`](/llms.txt), [`/llms-full.txt`](/llms-full.txt) | Index and the full docs inlined for LLMs |
| `/docs/<page>.md` | Raw Markdown of every docs page |
| [`/robots.txt`](/robots.txt) | Content Signals and explicit allow rules for AI crawlers |
| [`/sitemap.xml`](/sitemap.xml) | All pages |

The home page also sends `Link` response headers with `rel="service-desc"`, `rel="api-catalog"` and `rel="mcp"`.

All of these are generated at build time from the same tool definitions the server runs, so they cannot drift from `/mcp`.

## MCP registry

`server.json` in the repository is prepared for the official MCP registry under the name `io.github.nirholas/papertrade-sdk`, pointing at the live endpoint. Publishing it is a deliberate manual step by the maintainer.
