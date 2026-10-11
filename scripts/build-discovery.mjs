#!/usr/bin/env node
/** Generates the agent-discovery files from the live tool catalog. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GITHUB, OS_URL, PUBLIC, SITE_URL, loadCatalog, pkg } from './lib/site.mjs';

const write = (rel, data) => {
  const p = resolve(PUBLIC, rel);
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
};

export function buildCards({ tools, serverInfo }) {
  const description =
    'Read-only Papertrade tools: live markets, exact position quotes (bust price, net PnL after impact and fees), wallet positions, protocol health, PAPER economics and UNSIGNED EIP-712 payload builders. Unofficial, not affiliated with Papertrade.';

  const serverCard = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: '2025-06-18',
    serverInfo: { name: serverInfo.name, title: serverInfo.title, version: serverInfo.version },
    description,
    iconUrl: `${SITE_URL}/favicon.svg`,
    documentationUrl: `${SITE_URL}/docs/mcp`,
    repository: { url: GITHUB, source: 'github' },
    license: 'Apache-2.0',
    transport: { type: 'streamable-http', endpoint: `${SITE_URL}/mcp` },
    authentication: { required: false, schemes: [] },
    capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
    instructions: serverInfo.instructions,
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      annotations: t.annotations,
    })),
  };

  const agentCard = {
    protocolVersion: '0.3.0',
    name: serverInfo.title,
    description,
    url: `${SITE_URL}/mcp`,
    preferredTransport: 'JSONRPC',
    version: serverInfo.version,
    documentationUrl: `${SITE_URL}/docs/`,
    iconUrl: `${SITE_URL}/favicon.svg`,
    provider: { organization: 'nirholas (community, unofficial)', url: GITHUB },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    securitySchemes: {},
    skills: tools.map((t) => ({
      id: t.name,
      name: t.title,
      description: t.description,
      tags: ['papertrade', 'hyperliquid', 'perps', 'read-only', t.name.includes('typed_data') || t.name.includes('prepare') ? 'unsigned-eip712' : 'market-data'],
      examples: [],
      inputModes: ['application/json'],
      outputModes: ['application/json', 'text/plain'],
    })),
    additionalInterfaces: [{ url: `${SITE_URL}/mcp`, transport: 'MCP-STREAMABLE-HTTP' }],
  };

  const catalog = {
    linkset: [
      {
        anchor: `${SITE_URL}/mcp`,
        'service-desc': [{ href: `${SITE_URL}/openapi.json`, type: 'application/json' }],
        'service-doc': [{ href: `${SITE_URL}/docs/mcp`, type: 'text/html' }],
        describedby: [
          { href: `${SITE_URL}/.well-known/mcp/server-card.json`, type: 'application/json' },
          { href: `${SITE_URL}/.well-known/agent-card.json`, type: 'application/json' },
          { href: `${SITE_URL}/llms.txt`, type: 'text/plain' },
        ],
      },
      {
        anchor: `${SITE_URL}/api/papertrade/`,
        'service-desc': [{ href: `${SITE_URL}/openapi.json`, type: 'application/json' }],
        'service-doc': [{ href: `${SITE_URL}/docs/reference`, type: 'text/html' }],
      },
    ],
  };
  return { serverCard, agentCard, catalog };
}

export function buildOpenApi({ tools, serverInfo }) {
  const rpc = (id, method) => ({ jsonrpc: { const: '2.0' }, id: { type: ['string', 'integer'], example: id }, method: { const: method } });
  return {
    openapi: '3.1.0',
    info: {
      title: 'papertrade-sdk site API',
      version: serverInfo.version,
      summary: 'Read-only MCP server and API proxy for Papertrade. Unofficial.',
      description:
        'The MCP endpoint speaks JSON-RPC 2.0 over Streamable HTTP (stateless, batches accepted). Tools are strictly read-only and build only unsigned EIP-712 payloads. Unofficial community project, not affiliated with Papertrade. 1000x leverage can lose all margin quickly.',
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
      contact: { name: 'papertrade-sdk', url: GITHUB },
    },
    servers: [{ url: SITE_URL }],
    externalDocs: { description: 'Documentation', url: `${SITE_URL}/docs/` },
    tags: [{ name: 'mcp' }, { name: 'proxy' }, { name: 'discovery' }],
    paths: {
      '/mcp': {
        post: {
          operationId: 'mcpRpc',
          tags: ['mcp'],
          summary: 'MCP JSON-RPC 2.0 (initialize, ping, tools/list, tools/call)',
          description: `Tools: ${tools.map((t) => t.name).join(', ')}. Send Accept: application/json, text/event-stream. A notification-only body returns 202.`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/JsonRpcRequest' },
                    { type: 'array', maxItems: 20, items: { $ref: '#/components/schemas/JsonRpcRequest' } },
                  ],
                },
                examples: {
                  toolsList: { value: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
                  estimate: {
                    value: {
                      jsonrpc: '2.0',
                      id: 2,
                      method: 'tools/call',
                      params: { name: 'papertrade_estimate_position', arguments: { market: 'BTC', side: 'long', marginUsd: 100, leverage: 500, priceMovePct: 0.1 } },
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'JSON-RPC response (single or batch), or one SSE message event', content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonRpcResponse' } }, 'text/event-stream': { schema: { type: 'string' } } } },
            202: { description: 'Notification accepted, no body' },
            400: { description: 'Parse error or invalid request' },
            413: { description: 'Body larger than 64 KB' },
            429: { description: 'Rate limit exceeded (60 tool calls per minute per IP); see Retry-After' },
          },
        },
        get: { operationId: 'mcpInfo', tags: ['mcp'], summary: 'Describe the server (JSON). With Accept: text/event-stream returns 405.', responses: { 200: { description: 'Server description', content: { 'application/json': { schema: { type: 'object' } } } }, 405: { description: 'SSE stream not offered' } } },
        delete: { operationId: 'mcpDelete', tags: ['mcp'], summary: 'Not supported (stateless)', responses: { 405: { description: 'Method not allowed' } } },
        options: { operationId: 'mcpPreflight', tags: ['mcp'], summary: 'CORS preflight', responses: { 204: { description: 'CORS headers' } } },
      },
      '/api/papertrade/{path}': {
        get: {
          operationId: 'papertradeRead',
          tags: ['proxy'],
          summary: 'Same-origin read proxy of https://exchange.papertrade.xyz',
          description: 'Forwards GET reads and the live wallet SSE stream (`state/user/live?user=0x...`). Query strings must be canonical; use the SDK client.',
          parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' }, example: 'state/trading', allowReserved: true }],
          responses: { 200: { description: 'Upstream response' }, 429: { description: 'Upstream rate limit' } },
        },
      },
      '/llms.txt': { get: { operationId: 'llmsTxt', tags: ['discovery'], summary: 'LLM-oriented index', responses: { 200: { description: 'text/plain', content: { 'text/plain': { schema: { type: 'string' } } } } } } },
      '/llms-full.txt': { get: { operationId: 'llmsFull', tags: ['discovery'], summary: 'All docs inlined', responses: { 200: { description: 'text/plain', content: { 'text/plain': { schema: { type: 'string' } } } } } } },
      '/.well-known/mcp/server-card.json': { get: { operationId: 'serverCard', tags: ['discovery'], summary: 'MCP server card', responses: { 200: { description: 'Server card', content: { 'application/json': { schema: { type: 'object' } } } } } } },
      '/.well-known/agent-card.json': { get: { operationId: 'agentCard', tags: ['discovery'], summary: 'A2A agent card', responses: { 200: { description: 'Agent card', content: { 'application/json': { schema: { type: 'object' } } } } } } },
    },
    components: {
      schemas: {
        JsonRpcRequest: {
          type: 'object',
          required: ['jsonrpc', 'method'],
          properties: { jsonrpc: { const: '2.0' }, id: { type: ['string', 'integer'] }, method: { type: 'string', enum: ['initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call', 'resources/list', 'prompts/list'] }, params: { type: 'object' } },
        },
        JsonRpcResponse: {
          type: 'object',
          properties: { jsonrpc: { const: '2.0' }, id: { type: ['string', 'integer', 'null'] }, result: {}, error: { type: 'object', properties: { code: { type: 'integer' }, message: { type: 'string' } } } },
        },
        ...Object.fromEntries(tools.map((t) => [`${t.name}_input`, t.inputSchema])),
      },
    },
  };
}

export const ROBOTS = `# papertrade-sdk. Unofficial community project.
# Content Signals (https://contentsignals.org): searching and AI input are welcome, model training is not.
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /
Disallow: /api/

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

export async function buildDiscovery() {
  const catalog = await loadCatalog();
  const { serverCard, agentCard, catalog: api } = buildCards(catalog);
  write('.well-known/mcp/server-card.json', serverCard);
  write('.well-known/mcp.json', serverCard);
  write('.well-known/agent-card.json', agentCard);
  write('.well-known/agent.json', agentCard);
  write('.well-known/api-catalog', api);
  write('openapi.json', buildOpenApi(catalog));
  write('robots.txt', ROBOTS);

  const registry = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: pkg.mcpName,
    title: catalog.serverInfo.title,
    description: 'Read-only Papertrade (1000x synthetic perps) tools: live markets, exact position quotes, wallet positions, protocol health and unsigned EIP-712 builders.',
    repository: { url: GITHUB, source: 'github' },
    version: pkg.version,
    websiteUrl: SITE_URL,
    remotes: [{ type: 'streamable-http', url: `${SITE_URL}/mcp` }],
  };
  writeFileSync(resolve(PUBLIC, '..', '..', 'server.json'), `${JSON.stringify(registry, null, 2)}\n`);
  return { tools: catalog.tools.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await buildDiscovery();
  console.log(`discovery: ${r.tools} tools`);
}
