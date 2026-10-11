import type { Address, Hex } from 'viem';
import { MAINNET } from './deployment.js';
import { COLLATERAL_SCALE } from './units.js';
import type { ClosedPosition, IntentOutcome, OpenPosition, PendingOperation, WalletState } from './types.js';

type RawPosition = [string, number, boolean, boolean, string, string, number, string, number, Hex | null];
type RawOperation = [Hex, PendingOperation['action'], number | null, boolean | null, boolean | null, string | null, number | null, number, string, string[] | null];
type RawClosed = [string, number, boolean, string, number, boolean, string, string];

interface RawWalletState {
  indexedThroughBlock: number;
  walletRevision: number;
  indexedThroughTimestamp: number;
  sessionKeys: [Address, string][];
  queueRevision: string;
  balance: string;
  queued: string;
  locked: string;
  funds: Record<'reservedBalance' | 'reservedQueued' | 'availableBalance' | 'availableQueued', string>;
  queueNodeCount: number;
  consumableDebt: string;
  paper: Record<'balance' | 'staked' | 'pendingBase' | 'rewardDebt', string>;
}

type RawLifetime = Record<keyof WalletState['lifetime'], string>;

export interface RawWalletSnapshot extends RawWalletState {
  address: Address;
  accountRevision: number;
  lifetime: RawLifetime;
  operations: RawOperation[];
  openPositions: RawPosition[];
}

export interface RawWalletPatch {
  address: Address;
  accountRevision: number;
  baseAccountRevision: number;
  state: Partial<RawWalletState>;
  lifetime?: RawLifetime;
  closedPositions?: RawClosed[];
  intentOutcomes?: [Hex, IntentOutcome][];
  addedPositions: RawPosition[];
  removedPositionIds: string[];
  addedOperations: RawOperation[];
  removedOperationIds: Hex[];
}

export class WalletStreamOutOfSync extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletStreamOutOfSync';
  }
}

export function decodePosition(t: RawPosition): OpenPosition {
  const [positionId, instrumentId, isLong, useDebt, entry, margin, leverage, bust, openedAtMs, intentId] = t;
  return {
    positionId: BigInt(positionId),
    instrumentId,
    isLong,
    useDebt,
    entryPriceRaw: BigInt(entry),
    marginRaw: BigInt(margin),
    leverage,
    bustPriceRaw: BigInt(bust),
    openedAtMs,
    intentId,
  };
}

export function decodeOperation(t: RawOperation): PendingOperation {
  const [intentId, action, instrumentId, isLong, useDebt, amount, leverage, acceptedAtMs, deadline, closeIds] = t;
  const base = { intentId, state: 'queued' as const, acceptedAtMs, deadline: String(deadline) };
  switch (action) {
    case 'openPosition': {
      const margin = BigInt(amount ?? '0');
      return {
        ...base,
        action,
        instrumentId: instrumentId ?? 0,
        isLong: Boolean(isLong),
        useDebt: Boolean(useDebt),
        marginRaw: margin.toString(),
        leverage: leverage ?? 0,
        notionalRaw: (margin * BigInt(leverage ?? 0)).toString(),
      };
    }
    case 'closePositions':
      return { ...base, action, positionIds: closeIds ?? [] };
    case 'withdrawToCore':
    case 'paperStake':
    case 'paperUnstake': {
      // Withdrawal amounts travel in USDC units; everything else is already 18-decimal.
      const raw = BigInt(amount ?? '0');
      return { ...base, action, marginRaw: (action === 'withdrawToCore' ? raw * COLLATERAL_SCALE : raw).toString() };
    }
    default:
      return { ...base, action };
  }
}

function decodeClosed(t: RawClosed): ClosedPosition {
  const [positionId, instrumentId, isLong, margin, leverage, liquidated, pnl, paper] = t;
  return {
    positionId: BigInt(positionId),
    instrumentId,
    isLong,
    marginRaw: BigInt(margin),
    leverage,
    liquidated,
    netPnlRaw: BigInt(pnl),
    paperMintedRaw: BigInt(paper),
  };
}

const bigRecord = <K extends string>(r: Record<K, string>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, BigInt(v as string)])) as Record<K, bigint>;

function decodeState(raw: RawWalletState) {
  return {
    indexedThroughBlock: raw.indexedThroughBlock,
    walletRevision: raw.walletRevision,
    indexedThroughTimestamp: raw.indexedThroughTimestamp,
    sessionKeys: Object.fromEntries(raw.sessionKeys.map(([key, expiry]) => [key.toLowerCase(), BigInt(expiry)])),
    queueRevision: BigInt(raw.queueRevision),
    balance: BigInt(raw.balance),
    queued: BigInt(raw.queued),
    locked: BigInt(raw.locked),
    funds: bigRecord(raw.funds),
    queueNodeCount: raw.queueNodeCount,
    consumableDebt: BigInt(raw.consumableDebt),
    paper: bigRecord(raw.paper),
  };
}

const newestFirst = (a: OpenPosition, b: OpenPosition) => (a.positionId > b.positionId ? -1 : a.positionId < b.positionId ? 1 : 0);

export function decodeWalletSnapshot(raw: RawWalletSnapshot): WalletState {
  return {
    address: raw.address.toLowerCase() as Address,
    accountRevision: raw.accountRevision,
    ...decodeState(raw),
    lifetime: bigRecord(raw.lifetime),
    positions: raw.openPositions.map(decodePosition).sort(newestFirst),
    operations: raw.operations.map(decodeOperation),
    closedPositions: [],
    intentOutcomes: [],
  };
}

/** Apply an incremental `wallet` patch to the previous state, exactly as the official client does. */
export function applyWalletPatch(prev: WalletState, patch: RawWalletPatch): WalletState {
  if (patch.baseAccountRevision !== prev.accountRevision) {
    throw new WalletStreamOutOfSync(`patch base ${patch.baseAccountRevision} does not match revision ${prev.accountRevision}`);
  }
  if (patch.accountRevision <= prev.accountRevision) throw new WalletStreamOutOfSync('patch does not advance the account revision');

  const removedPositions = new Set(patch.removedPositionIds);
  const positions = prev.positions
    .filter((p) => !removedPositions.has(p.positionId.toString()))
    .concat(patch.addedPositions.map(decodePosition))
    .sort(newestFirst);

  const removedOps = new Set(patch.removedOperationIds);
  const operations = prev.operations.filter((o) => !removedOps.has(o.intentId)).concat(patch.addedOperations.map(decodeOperation));

  const state = patch.state;
  const merged: WalletState = {
    ...prev,
    accountRevision: patch.accountRevision,
    ...(state.indexedThroughBlock !== undefined && { indexedThroughBlock: state.indexedThroughBlock }),
    ...(state.walletRevision !== undefined && { walletRevision: state.walletRevision }),
    ...(state.indexedThroughTimestamp !== undefined && { indexedThroughTimestamp: state.indexedThroughTimestamp }),
    ...(state.sessionKeys !== undefined && {
      sessionKeys: Object.fromEntries(state.sessionKeys.map(([k, e]) => [k.toLowerCase(), BigInt(e)])),
    }),
    ...(state.queueRevision !== undefined && { queueRevision: BigInt(state.queueRevision) }),
    ...(state.balance !== undefined && { balance: BigInt(state.balance) }),
    ...(state.queued !== undefined && { queued: BigInt(state.queued) }),
    ...(state.locked !== undefined && { locked: BigInt(state.locked) }),
    ...(state.funds !== undefined && { funds: bigRecord(state.funds) }),
    ...(state.queueNodeCount !== undefined && { queueNodeCount: state.queueNodeCount }),
    ...(state.consumableDebt !== undefined && { consumableDebt: BigInt(state.consumableDebt) }),
    ...(state.paper !== undefined && { paper: bigRecord(state.paper) }),
    ...(patch.lifetime && { lifetime: bigRecord(patch.lifetime) }),
    positions,
    operations,
    closedPositions: (patch.closedPositions ?? []).map(decodeClosed),
    intentOutcomes: (patch.intentOutcomes ?? []).map(([intentId, outcome]) => ({ intentId, outcome })),
  };
  return merged;
}

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/** Incremental text/event-stream parser (WHATWG rules: multi-line data, comments, CRLF). */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private id: string | undefined;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    let idx: number;
    while ((idx = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, idx);
      const sepLen = this.buffer.startsWith('\r\n', idx) ? 2 : 1;
      this.buffer = this.buffer.slice(idx + sepLen);
      if (line === '') {
        if (this.data.length) out.push({ event: this.event || 'message', data: this.data.join('\n'), id: this.id });
        this.event = '';
        this.data = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') this.event = value;
      else if (field === 'data') this.data.push(value);
      else if (field === 'id') this.id = value;
    }
    return out;
  }
}

export type WalletStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped';

export interface WalletStreamOptions {
  wallet: Address;
  /** API origin or same-origin proxy. Default https://exchange.papertrade.xyz. */
  baseUrl?: string;
  fetch?: typeof fetch;
  onState: (state: WalletState, kind: 'snapshot' | 'update') => void;
  onStatus?: (status: WalletStreamStatus, detail?: string) => void;
  /** Close the stream when this signal aborts. */
  signal?: AbortSignal;
}

/**
 * Subscribe to a wallet's live account state (balances, positions, pending
 * intents, PAPER) over the /state/user/live server-sent event stream. Handles
 * heartbeats, silence detection, patch application and reconnects.
 * Returns a function that closes the stream.
 */
export function streamWallet(options: WalletStreamOptions): () => void {
  const baseUrl = (options.baseUrl ?? MAINNET.apiUrl).replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const wallet = options.wallet.toLowerCase();
  const stop = new AbortController();
  options.signal?.addEventListener('abort', () => stop.abort(), { once: true });
  let state: WalletState | null = null;
  let attempt = 0;

  const status = (s: WalletStreamStatus, detail?: string) => options.onStatus?.(s, detail);

  async function connectOnce() {
    const conn = new AbortController();
    const onStop = () => conn.abort();
    stop.signal.addEventListener('abort', onStop, { once: true });
    let silenceMs = 45_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => conn.abort(new Error('silence')), silenceMs);
    };
    try {
      const res = await fetchImpl(`${baseUrl}/state/user/live?wallet=${encodeURIComponent(wallet)}`, {
        headers: { Accept: 'text/event-stream' },
        signal: conn.signal,
        cache: 'no-store',
      });
      if (!res.ok || !res.body) throw new StreamHttpError(res.status, retryAfterMs(res.headers.get('retry-after')));
      arm();
      const parser = new SseParser();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const msg of parser.push(value)) {
          arm();
          if (msg.event === 'liveness') {
            const { heartbeatIntervalMs } = JSON.parse(msg.data) as { heartbeatIntervalMs: number };
            if (Number.isSafeInteger(heartbeatIntervalMs) && heartbeatIntervalMs > 0) silenceMs = Math.min(45_000, 3 * heartbeatIntervalMs);
            arm();
          } else if (msg.event === 'wallet') {
            const payload = JSON.parse(msg.data) as RawWalletSnapshot | RawWalletPatch;
            if ('baseAccountRevision' in payload) {
              if (!state) throw new WalletStreamOutOfSync('patch arrived before a snapshot');
              state = applyWalletPatch(state, payload);
              options.onState(state, 'update');
            } else {
              const next = decodeWalletSnapshot(payload);
              if (state && next.accountRevision < state.accountRevision) continue;
              state = next;
              attempt = 0;
              status('live');
              options.onState(state, 'snapshot');
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      stop.signal.removeEventListener('abort', onStop);
    }
  }

  (async () => {
    status('connecting');
    while (!stop.signal.aborted) {
      let minDelay = 0;
      try {
        await connectOnce();
      } catch (err) {
        if (stop.signal.aborted) break;
        if (err instanceof WalletStreamOutOfSync) state = null;
        // Rate limited (429) or unavailable: wait as long as the server asks, so retries don't extend the ban.
        if (err instanceof StreamHttpError) minDelay = err.retryAfterMs;
        status('reconnecting', err instanceof Error ? err.message : String(err));
      }
      if (stop.signal.aborted) break;
      const delay = Math.max(minDelay, Math.min(30_000, 500 * 2 ** attempt++)) + Math.random() * 500;
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, delay);
        function done() {
          clearTimeout(t);
          stop.signal.removeEventListener('abort', done);
          resolve();
        }
        stop.signal.addEventListener('abort', done, { once: true });
      });
    }
    status('stopped');
  })();

  return () => stop.abort();
}

/** Resolve with the first full snapshot of a wallet, then close the stream. */
export function fetchWalletState(wallet: Address, options: Omit<WalletStreamOptions, 'wallet' | 'onState'> & { timeoutMs?: number } = {}): Promise<WalletState> {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error('Timed out waiting for the wallet snapshot'));
    }, options.timeoutMs ?? 20_000);
    streamWallet({
      ...options,
      wallet,
      signal: options.signal ? AbortSignal.any([options.signal, ctrl.signal]) : ctrl.signal,
      onState(state) {
        clearTimeout(timer);
        ctrl.abort();
        resolve(state);
      },
    });
  });
}

class StreamHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number,
  ) {
    super(`live stream HTTP ${status}${retryAfterMs ? `, retry after ${Math.ceil(retryAfterMs / 1000)}s` : ''}`);
    this.name = 'StreamHttpError';
  }
}

/** Parse a Retry-After header (delta seconds or an HTTP date) into milliseconds, capped at 5 minutes. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return 0;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 300_000) : 0;
}
