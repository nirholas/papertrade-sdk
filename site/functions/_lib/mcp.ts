/**
 * Minimal, dependency-free MCP server core (Streamable HTTP transport, stateless).
 *
 * One POST per JSON-RPC message (or batch). No sessions, no cookies, no auth: the Origin header is
 * never used to make a trust decision. Every tool must be read-only, a quote or a simulation.
 */

export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];

export const JSONRPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  rateLimited: -32029,
} as const;

type SchemaType = 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';

export interface JsonSchema {
  type?: SchemaType | SchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: readonly (string | number | boolean)[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  minItems?: number;
  pattern?: string;
  default?: unknown;
  examples?: readonly unknown[];
  [extra: string]: unknown;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolResult {
  /** Short human readable summary; the structured payload is appended as JSON. */
  summary: string;
  data: Record<string, unknown>;
}

export interface ToolDefinition<Ctx = unknown> {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>, ctx: Ctx) => Promise<ToolResult>;
}

/** An error the model can act on (bad input, upstream down). Becomes `isError: true`, not a protocol error. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
  instructions: string;
  docsUrl: string;
}

export interface RateLimiter {
  /** Returns 0 when allowed, else the seconds the caller should wait. */
  check(key: string, cost: number): number;
}

/** Fixed-window limiter held in isolate memory: a cheap guard, not a hard global quota. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key, cost) {
      const t = now();
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: cost, resetAt: t + windowMs });
        return 0;
      }
      if (entry.count + cost > limit) return Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      entry.count += cost;
      return 0;
    },
  };
}

export interface McpOptions<Ctx> {
  info: ServerInfo;
  tools: ToolDefinition<Ctx>[];
  context: (request: Request) => Ctx;
  limiter?: RateLimiter;
  /** Max request body in bytes. */
  maxBodyBytes?: number;
  /** Max messages in one batch. */
  maxBatch?: number;
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'access-control-expose-headers': 'Mcp-Session-Id, Mcp-Protocol-Version, Retry-After',
  'access-control-max-age': '86400',
};

type Id = string | number | null;
interface RpcRequest {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: unknown;
}

function rpcError(id: Id, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0' as const, id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate a value against the JSON Schema subset the tools use. Returns a list of problems. */
export function validateAgainst(schema: JsonSchema, value: unknown, path = 'arguments'): string[] {
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value as string | number | boolean)) {
    errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
    return errors;
  }
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return [`${path} must be a string`];
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long (max ${schema.maxLength})`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match the expected format (${schema.pattern})`);
      break;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} must be a number`];
      if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path} must be an integer`);
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') return [`${path} must be a boolean`];
      break;
    case 'array': {
      if (!Array.isArray(value)) return [`${path} must be an array`];
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has too many items (max ${schema.maxItems})`);
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} items`);
      if (schema.items) value.forEach((v, i) => errors.push(...validateAgainst(schema.items!, v, `${path}[${i}]`)));
      break;
    }
    case 'object': {
      if (!isPlainObject(value)) return [`${path} must be an object`];
      for (const key of schema.required ?? []) if (!(key in value) || value[key] === undefined) errors.push(`${path}.${key} is required`);
      for (const [key, v] of Object.entries(value)) {
        const sub = schema.properties?.[key];
        if (sub) errors.push(...validateAgainst(sub, v, `${path}.${key}`));
        else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not a known field`);
        else if (isPlainObject(schema.additionalProperties)) errors.push(...validateAgainst(schema.additionalProperties, v, `${path}.${key}`));
      }
      break;
    }
    default:
      break;
  }
  return errors;
}

export function publicToolList<Ctx>(tools: ToolDefinition<Ctx>[]) {
  return tools.map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    outputSchema,
    annotations: { title, ...annotations },
  }));
}

function jsonText(data: unknown) {
  return JSON.stringify(data, null, 2);
}

async function callTool<Ctx>(tool: ToolDefinition<Ctx>, rawArgs: unknown, ctx: Ctx) {
  const args = rawArgs === undefined ? {} : rawArgs;
  const problems = validateAgainst(tool.inputSchema, args);
  if (problems.length) {
    return { isError: true, content: [{ type: 'text', text: `Invalid arguments for ${tool.name}: ${problems.join('; ')}` }] };
  }
  try {
    const { summary, data } = await tool.handler(args as Record<string, unknown>, ctx);
    return { content: [{ type: 'text', text: `${summary}\n\n${jsonText(data)}` }], structuredContent: data };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : `${tool.name} failed: ${err instanceof Error ? err.message : String(err)}`;
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

async function dispatch<Ctx>(msg: RpcRequest, options: McpOptions<Ctx>, request: Request): Promise<unknown | null> {
  const isNotification = msg.id === undefined;
  const id: Id = msg.id ?? null;
  const params = isPlainObject(msg.params) ? msg.params : {};

  if (isNotification) return null;

  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = (SUPPORTED_PROTOCOLS as readonly string[]).includes(asked) ? asked : DEFAULT_PROTOCOL;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.info.name, title: options.info.title, version: options.info.version },
          instructions: options.info.instructions,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: publicToolList(options.tools) } };
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } };
    case 'resources/templates/list':
      return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: [] } };
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string') return rpcError(id, JSONRPC.invalidParams, 'tools/call requires a string `name`.');
      const tool = options.tools.find((t) => t.name === name);
      if (!tool) return rpcError(id, JSONRPC.invalidParams, `Unknown tool: ${name}`);
      if (params.arguments !== undefined && !isPlainObject(params.arguments)) {
        return rpcError(id, JSONRPC.invalidParams, '`arguments` must be an object.');
      }
      return { jsonrpc: '2.0', id, result: await callTool(tool, params.arguments, options.context(request)) };
    }
    default:
      return rpcError(id, JSONRPC.methodNotFound, `Method not found: ${msg.method}`);
  }
}

function validRequest(m: unknown): m is RpcRequest {
  return isPlainObject(m) && m.jsonrpc === '2.0' && typeof m.method === 'string' && (m.id === undefined || m.id === null || typeof m.id === 'string' || typeof m.id === 'number');
}

function wantsOnlySse(accept: string | null) {
  if (!accept) return false;
  const a = accept.toLowerCase();
  return a.includes('text/event-stream') && !a.includes('application/json') && !a.includes('*/*');
}

function respond(body: unknown, status: number, request: Request, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...CORS, 'cache-control': 'no-store', ...extra };
  if (wantsOnlySse(request.headers.get('accept'))) {
    headers['content-type'] = 'text/event-stream; charset=utf-8';
    return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { status, headers });
  }
  headers['content-type'] = 'application/json; charset=utf-8';
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleMcp<Ctx>(request: Request, options: McpOptions<Ctx>): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (method === 'GET') {
    if ((request.headers.get('accept') ?? '').toLowerCase().includes('text/event-stream')) {
      return new Response(JSON.stringify({ error: 'This server does not open SSE streams. POST JSON-RPC messages to this URL.' }), {
        status: 405,
        headers: { ...CORS, allow: 'POST, OPTIONS', 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return new Response(
      JSON.stringify(
        {
          name: options.info.name,
          title: options.info.title,
          version: options.info.version,
          transport: 'streamable-http',
          endpoint: new URL(request.url).origin + new URL(request.url).pathname,
          protocolVersions: SUPPORTED_PROTOCOLS,
          readOnly: true,
          tools: options.tools.map((t) => ({ name: t.name, title: t.title, description: t.description })),
          docs: options.info.docsUrl,
          serverCard: `${new URL(request.url).origin}/.well-known/mcp/server-card.json`,
          usage: 'POST JSON-RPC 2.0 messages with Content-Type: application/json. Stateless: no session header is needed.',
        },
        null,
        2,
      ),
      { headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } },
    );
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: `${method} is not supported. POST JSON-RPC messages to this URL.` }), {
      status: 405,
      headers: { ...CORS, allow: 'GET, POST, OPTIONS', 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const maxBytes = options.maxBodyBytes ?? 64 * 1024;
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return respond(rpcError(null, JSONRPC.invalidRequest, `Request body exceeds ${maxBytes} bytes.`), 413, request);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return respond(rpcError(null, JSONRPC.invalidRequest, `Request body exceeds ${maxBytes} bytes.`), 413, request);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return respond(rpcError(null, JSONRPC.parseError, 'Parse error: the body is not valid JSON.'), 400, request);
  }

  const batch = Array.isArray(payload);
  const messages: unknown[] = Array.isArray(payload) ? payload : [payload];
  if (batch && messages.length === 0) return respond(rpcError(null, JSONRPC.invalidRequest, 'An empty batch is not a valid request.'), 400, request);
  if (messages.length > (options.maxBatch ?? 20)) {
    return respond(rpcError(null, JSONRPC.invalidRequest, `Batch too large (max ${options.maxBatch ?? 20}).`), 400, request);
  }

  const calls = messages.filter((m) => isPlainObject(m) && m.method === 'tools/call').length;
  if (options.limiter && calls > 0) {
    const key = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'anonymous';
    const wait = options.limiter.check(key, calls);
    if (wait > 0) {
      return respond(rpcError(null, JSONRPC.rateLimited, `Rate limit reached. Retry in ${wait}s.`, { retryAfterSeconds: wait }), 429, request, {
        'retry-after': String(wait),
      });
    }
  }

  const out: unknown[] = [];
  for (const m of messages) {
    if (!validRequest(m)) {
      // A response object or garbage sent by a client: only answer garbage that carries an id.
      const id = isPlainObject(m) && (typeof m.id === 'string' || typeof m.id === 'number') && 'method' in m ? (m.id as Id) : null;
      if (isPlainObject(m) && 'result' in m && !('method' in m)) continue;
      out.push(rpcError(id, JSONRPC.invalidRequest, 'Invalid Request: expected a JSON-RPC 2.0 request object.'));
      continue;
    }
    try {
      const res = await dispatch(m, options, request);
      if (res !== null) out.push(res);
    } catch (err) {
      out.push(rpcError(m.id ?? null, JSONRPC.internalError, `Internal error: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  if (out.length === 0) return new Response(null, { status: 202, headers: CORS });
  const first = out[0] as { result?: { protocolVersion?: string } };
  const extra: Record<string, string> = first?.result?.protocolVersion ? { 'mcp-protocol-version': first.result.protocolVersion } : {};
  return respond(batch ? out : out[0], 200, request, extra);
}
