# Self-hosting

Source: https://papertrade-sdk.pages.dev/docs/self-hosting

The whole site is a Cloudflare Pages project: static files in `site/public/` and Pages Functions in `site/functions/`.

```bash
git clone https://github.com/nirholas/papertrade-sdk && cd papertrade-sdk
npm install
npm run build:site
cd site
npx wrangler pages deploy --project-name <your-project> --branch main
```

`npm run build:site` bundles the playground, renders the docs, and regenerates every discovery file. Run it before each deploy.

## Local development

```bash
npm run dev:site   # builds, then wrangler pages dev on http://localhost:8788
```

## Functions

| File | Route |
|---|---|
| `site/functions/mcp.ts` | `/mcp`: the MCP server |
| `site/functions/api/papertrade/[[path]].ts` | `/api/papertrade/*`: same-origin proxy of the public API (GET reads, the live SSE stream and already-signed intent POSTs; it never signs) |
| `site/functions/_lib/mcp.ts` | Transport, JSON-RPC, validation and rate limiting |
| `site/functions/_lib/tools.ts` | The tool catalog |

## Configuration

One variable, `PAPERTRADE_API_URL` (default `https://exchange.papertrade.xyz`), in `site/wrangler.toml`. No secrets are needed. Change the canonical host in `site/functions/_lib/server-info.ts` and `scripts/lib/site.mjs` so the generated cards and sitemap point at your domain.

## Embedding

`_headers` allows framing by `https://papertrade-os.pages.dev` and other `*.pages.dev` hosts, and `/?embed=1` hides the marketing chrome for use inside Papertrade OS windows.

## Tests

```bash
npm run typecheck && npm test && npm run build:site
```
