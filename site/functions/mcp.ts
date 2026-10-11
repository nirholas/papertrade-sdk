import { PapertradeClient } from '../../src/index.js';
import { createRateLimiter, handleMcp } from './_lib/mcp.js';
import { TOOLS, type ToolContext } from './_lib/tools.js';
import { SERVER_INFO } from './_lib/server-info.js';

interface Env {
  PAPERTRADE_API_URL?: string;
}

const UPSTREAM = 'https://exchange.papertrade.xyz';
const limiter = createRateLimiter(60, 60_000);

export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  handleMcp<ToolContext>(request, {
    info: SERVER_INFO,
    tools: TOOLS,
    limiter,
    context: () => {
      const baseUrl = (env.PAPERTRADE_API_URL ?? UPSTREAM).replace(/\/+$/, '');
      const fetchImpl: typeof fetch = (input, init) => fetch(input, init);
      return {
        client: new PapertradeClient({ baseUrl, fetch: fetchImpl, retries: 1, timeoutMs: 8000, clientBuild: 'papertrade-sdk-mcp' }),
        baseUrl,
        fetch: fetchImpl,
        now: Date.now,
      };
    },
  });
