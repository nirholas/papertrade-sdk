---
title: Connect your AI
description: Copy-paste setup for Claude, ChatGPT, Codex, Gemini, Cursor, VS Code, Windsurf, Zed, Cline, Goose, Continue and the Claude and OpenAI APIs.
order: 6
---
# Connect your AI

The server URL is the same everywhere:

```text
https://papertrade-sdk.pages.dev/mcp
```

It needs no login or API key. Pick your client below. Config formats change; each snippet was checked against the client's current documentation when this page was written.

## Claude Code

```bash
claude mcp add --transport http papertrade-sdk https://papertrade-sdk.pages.dev/mcp
```

Add `--scope user` to enable it in every project. Run `/mcp` inside Claude Code to see the tools.

## Claude Desktop and claude.ai

Open Settings, then Connectors, then Add custom connector, and paste the URL above. Custom connectors are available on paid plans; on Team and Enterprise an owner adds them for the organization first.

For a Claude Desktop config file instead, bridge the remote server with `mcp-remote` (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "papertrade-sdk": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://papertrade-sdk.pages.dev/mcp"]
    }
  }
}
```

## Claude API (MCP connector)

```bash
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20" \
  -d '{
    "model": "claude-opus-5-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Quote a 500x BTC long with $100 margin and a +0.1% move."}],
    "mcp_servers": [{"type": "url", "url": "https://papertrade-sdk.pages.dev/mcp", "name": "papertrade-sdk"}],
    "tools": [{"type": "mcp_toolset", "mcp_server_name": "papertrade-sdk"}]
  }'
```

## OpenAI Codex CLI

```bash
codex mcp add papertrade-sdk --url https://papertrade-sdk.pages.dev/mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.papertrade-sdk]
url = "https://papertrade-sdk.pages.dev/mcp"
```

## OpenAI Responses API

```json
{
  "model": "gpt-5",
  "input": "What is the bust price of a 500x BTC long right now?",
  "tools": [{
    "type": "mcp",
    "server_label": "papertrade_sdk",
    "server_description": "Read-only Papertrade market data, settlement math and unsigned EIP-712 builders.",
    "server_url": "https://papertrade-sdk.pages.dev/mcp",
    "require_approval": "never"
  }]
}
```

All tools are read-only, so `never` is safe here. Keep `always` if you prefer to review every call.

## ChatGPT

Enable developer mode in Settings, then Connectors, then Advanced. Create a connector, choose MCP, paste the URL above and set authentication to none. ChatGPT requires a publicly reachable HTTPS endpoint, which this is. Menu names change; follow OpenAI's current "Developer mode" guide if they differ.

## Gemini CLI

```bash
gemini mcp add --transport http papertrade-sdk https://papertrade-sdk.pages.dev/mcp
```

Or in `~/.gemini/settings.json` (note `httpUrl`, not `url`, which is for SSE):

```json
{
  "mcpServers": {
    "papertrade-sdk": { "httpUrl": "https://papertrade-sdk.pages.dev/mcp" }
  }
}
```

## Cursor

`.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "papertrade-sdk": { "url": "https://papertrade-sdk.pages.dev/mcp" }
  }
}
```

## VS Code (GitHub Copilot)

`.vscode/mcp.json` (the top-level key is `servers`):

```json
{
  "servers": {
    "papertrade-sdk": { "type": "http", "url": "https://papertrade-sdk.pages.dev/mcp" }
  }
}
```

## Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "papertrade-sdk": { "serverUrl": "https://papertrade-sdk.pages.dev/mcp" }
  }
}
```

## Zed

`settings.json`:

```json
{
  "context_servers": {
    "papertrade-sdk": { "url": "https://papertrade-sdk.pages.dev/mcp" }
  }
}
```

## Cline

`cline_mcp_settings.json`. Set `type` explicitly, otherwise Cline assumes the legacy SSE transport:

```json
{
  "mcpServers": {
    "papertrade-sdk": { "type": "streamableHttp", "url": "https://papertrade-sdk.pages.dev/mcp" }
  }
}
```

## Goose

```bash
goose session --with-streamable-http-extension "https://papertrade-sdk.pages.dev/mcp"
```

In the desktop app, use Extensions, Add custom extension, type Streamable HTTP, and paste the URL.

## Continue

`.continue/mcpServers/papertrade-sdk.yaml`:

```yaml
name: Papertrade SDK
version: 0.0.1
schema: v1
mcpServers:
  - name: papertrade-sdk
    type: streamable-http
    url: https://papertrade-sdk.pages.dev/mcp
```

## Any other agent framework

If your framework speaks OpenAPI or plain HTTP rather than MCP, use [`/openapi.json`](/openapi.json), which documents `POST /mcp` and the read proxy. Frameworks that take an MCP URL (LangChain MCP adapters, the OpenAI Agents SDK, Vercel AI SDK, Mastra) accept the same Streamable HTTP endpoint.

## Check it works

```bash
npx @modelcontextprotocol/inspector --cli https://papertrade-sdk.pages.dev/mcp --transport http --method tools/list
```

Then ask your assistant: "Use papertrade-sdk to quote a 500x BTC long with 100 dollars of margin."
