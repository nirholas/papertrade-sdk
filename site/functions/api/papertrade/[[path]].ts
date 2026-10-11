/**
 * Same-origin proxy for the Papertrade API (exchange.papertrade.xyz sends no CORS headers).
 * Mounted at /api/papertrade/*. Point the SDK at it with `new PapertradeClient({ baseUrl: '/api/papertrade' })`.
 *
 * Only the public API surface is forwarded: GET reads, the live SSE stream, and the POST routes that
 * carry already-signed intents. Nothing here holds keys or signs anything.
 */
interface Env {
  PAPERTRADE_API_URL?: string;
}

const UPSTREAM = 'https://exchange.papertrade.xyz';
const GET_PREFIXES = ['/state/', '/query/', '/queue-rank/', '/relayer/health'];
const POST_ROUTES = [/^\/intents$/, /^\/intents\/0x[0-9a-fA-F]{64}\/(cancel|onward)$/, /^\/funding\/deposits\/check$/];
const MAX_BODY_BYTES = 64 * 1024;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const path = `/${segments.map(encodeURIComponent).join('/')}`;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, POST, OPTIONS' } });
  const allowed =
    method === 'GET' ? GET_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p)) :
    method === 'POST' ? POST_ROUTES.some((r) => r.test(path)) : false;
  if (!allowed) return json(404, { code: 'not_proxied', message: `${method} ${path} is not part of the public Papertrade API.` });

  const headers = new Headers({ accept: request.headers.get('accept') ?? 'application/json' });
  const build = request.headers.get('x-papertrade-build');
  if (build) headers.set('x-papertrade-build', build.slice(0, 80));

  let body: string | undefined;
  if (method === 'POST') {
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json(413, { code: 'body_too_large', message: 'Intent bodies are small; this one is not.' });
    headers.set('content-type', 'application/json');
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${(env.PAPERTRADE_API_URL ?? UPSTREAM).replace(/\/+$/, '')}${path}${url.search}`, {
      method,
      headers,
      body,
      signal: request.signal,
    });
  } catch (err) {
    return json(502, { code: 'upstream_unreachable', message: `Papertrade API did not respond: ${err instanceof Error ? err.message : String(err)}` });
  }

  const out = new Headers();
  for (const h of ['content-type', 'retry-after', 'cache-control', 'etag']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (path === '/state/user/live') {
    out.set('cache-control', 'no-store');
    out.set('x-accel-buffering', 'no');
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
};
