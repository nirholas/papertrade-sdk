import { MAINNET } from './deployment.js';

export interface HttpOptions {
  /**
   * API origin. Defaults to https://exchange.papertrade.xyz. The API sends no CORS
   * headers, so browser apps on another origin must point this at a same-origin
   * proxy (every papertrade-* site ships one as a Cloudflare Pages Function).
   */
  baseUrl?: string;
  /** Custom fetch (tests, Cloudflare service bindings, instrumentation). */
  fetch?: typeof fetch;
  /** Retries on 429 / 5xx / network errors. Default 3. */
  retries?: number;
  /** Per-request timeout in ms. Default 20000 for reads, 35000 for intents. */
  timeoutMs?: number;
  /** Sent as X-Papertrade-Build on every request, identifying the client. */
  clientBuild?: string;
  /** Extra headers on every request (for example a proxy auth header). */
  headers?: Record<string, string>;
}

export class PapertradeApiError extends Error {
  readonly status: number;
  /** Machine code from the relayer, e.g. `admission_rejected`, `invalid_intent`, `rate_limited`. */
  readonly code: string;
  /** Sub-reason for `admission_rejected` and `invalid_onward`, e.g. `belowMinimumNotional`. */
  readonly reason: string | null;
  readonly payload: unknown;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, code: string, payload: unknown, retryAfterMs: number | null = null, reason: string | null = null) {
    super(message);
    this.name = 'PapertradeApiError';
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.payload = payload;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Plain-language explanations for relayer admission rejections, keyed by `reason`. */
export const ADMISSION_REASONS: Record<string, string> = {
  tradingPaused: 'Trading is paused protocol-wide.',
  marketPaused: 'This market is paused.',
  inactiveInstrument: 'This market is no longer open for trading.',
  belowMinimum: 'Margin is below the minimum trade size (10 USD).',
  belowMinimumNotional: 'Margin times leverage is below the minimum position size (10,000 USD).',
  leverageTooHigh: 'Leverage is above the market maximum.',
  positionTooLarge: 'The position is above the market size limit (10M USD notional).',
  openInterest: 'The market has hit its open interest cap on this side.',
  funding: 'Available collateral changed; reduce the trade size.',
  noOpenPositions: 'Those positions are already closed or already have a close pending.',
  paperBalance: 'Not enough unstaked PAPER for this stake.',
  stakedBalance: 'Not enough staked PAPER for this unstake.',
  sessionKeyLimit: 'This wallet has too many active session keys; reuse one or wait for one to expire.',
  noDeposit: 'No deposit has arrived for this account yet.',
  noRewards: 'There are no staking rewards to claim.',
  alreadyQueued: 'An identical request is already queued.',
};

/** Plain-language explanations for relayer error codes. */
export const ERROR_CODES: Record<string, string> = {
  invalid_intent: 'The relayer could not validate this intent (bad signature, field or domain).',
  deadline_expired: 'The intent deadline passed before the relayer accepted it.',
  unauthorized_intent: 'The signer is not an authorized session key for this wallet. Register a session key first.',
  intent_not_found: 'No intent with that id.',
  intent_conflict: 'The intent conflicts with one already being processed.',
  below_minimum_withdrawal: 'Withdrawals must be at least 10 USDC.',
  below_minimum_paper_stake: 'The stake is below the minimum PAPER stake.',
  intake_action_paused: 'The relayer is not accepting this action right now.',
  invalid_onward: 'The onward transfer signature does not match the withdrawal.',
  rate_limited: 'Too many requests. Slow down and retry.',
};

function describeError(p: { error?: unknown; code?: unknown; reason?: unknown; message?: unknown; canonical?: unknown }, status: number, fallback: string) {
  const code = typeof p.code === 'string' ? p.code : typeof p.error === 'string' && /^[a-z_]+$/.test(p.error) ? p.error : status === 429 ? 'rate_limited' : 'http_error';
  const reason = typeof p.reason === 'string' ? p.reason : null;
  let message: string;
  if (typeof p.canonical === 'string') message = `${String(p.error)} (expected ${p.canonical})`;
  else if (reason && code === 'admission_rejected') message = ADMISSION_REASONS[reason] ?? `Rejected: ${reason}`;
  else if (ERROR_CODES[code]) message = ERROR_CODES[code];
  else if (typeof p.message === 'string') message = p.message;
  else if (typeof p.error === 'string') message = p.error;
  else message = fallback;
  return { code, reason, message };
}

/**
 * The API rejects any query string that is not canonical: each parameter once,
 * sorted by name, URLSearchParams-encoded, with no unknown keys. This builds it.
 */
export function canonicalQuery(params: Record<string, string | number | boolean | null | undefined> = {}): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!entries.length) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpTransport {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly clientBuild: string;
  private readonly headers: Record<string, string>;

  constructor(options: HttpOptions = {}) {
    this.baseUrl = (options.baseUrl ?? MAINNET.apiUrl).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.retries = options.retries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.clientBuild = options.clientBuild ?? 'papertrade-sdk';
    this.headers = options.headers ?? {};
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>, signal?: AbortSignal): Promise<T> {
    return this.request<T>('GET', `${path}${canonicalQuery(params)}`, undefined, signal);
  }

  async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>('POST', path, body, signal, 35_000);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown, signal?: AbortSignal, timeoutMs = this.timeoutMs): Promise<T> {
    // Intent POSTs are retried only on 429/503, where the relayer guarantees it did not accept the intent.
    const idempotent = method === 'GET';
    let attempt = 0;
    for (;;) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          signal: combined,
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'X-Papertrade-Build': this.clientBuild,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...this.headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (signal?.aborted || !idempotent || attempt >= this.retries) throw err;
        await sleep(backoff(attempt++));
        continue;
      }

      if (res.ok) {
        if (res.status === 204) return {} as T;
        const data = (await res.json()) as T & { ok?: boolean; error?: unknown };
        // The relayer can answer 200 with { ok: false } or { error }; that is still a rejection.
        if (data && typeof data === 'object' && (data.ok === false || (data.error !== undefined && data.error !== null))) {
          const { code, reason, message } = describeError(data as Record<string, unknown>, res.status, `Papertrade API ${method} ${path} was rejected`);
          throw new PapertradeApiError(message, res.status, code, data, null, reason);
        }
        return data;
      }

      const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
      const retryable = res.status === 429 || res.status === 503 || (idempotent && res.status >= 500);
      if (retryable && attempt < this.retries) {
        await sleep(retryAfterMs ?? backoff(attempt));
        attempt++;
        continue;
      }
      const text = await res.text();
      let payload: unknown = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { error: text.includes('<html') ? `HTTP ${res.status}` : text };
      }
      const { code, reason, message } = describeError(
        (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>,
        res.status,
        `Papertrade API ${method} ${path} failed with HTTP ${res.status}`,
      );
      throw new PapertradeApiError(message, res.status, code, payload, retryAfterMs, reason);
    }
  }
}

function backoff(attempt: number) {
  return Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
