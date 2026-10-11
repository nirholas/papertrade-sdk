import type { Address } from 'viem';
import { HttpTransport, type HttpOptions } from './http.js';
import { mergePriceTiles, planPriceTiles, type PricePoint, type PriceTile, type PriceWindowRequest } from './price-history.js';
import type {
  HouseCurrent,
  AccountCashflow,
  AccountQueueEvent,
  AccountStakingEvent,
  AccountTrade,
  HistoryInterval,
  HouseDelta,
  Instrument,
  IntentAction,
  IntentReceipt,
  LeaderboardAccounts,
  LeaderboardBadges,
  LeaderboardPlacement,
  LeaderboardPositions,
  LeaderboardSortKey,
  LeaderboardWindow,
  LiquidationMap,
  LiquidationMapRange,
  MarketStats,
  Page,
  PaperActivity,
  PortfolioHistory,
  PortfolioRange,
  PositionTopology,
  PriceHistory,
  ProtocolHistory,
  ProtocolSummary,
  QueueBalances,
  QueueRank,
  QueueRing,
  QueueSummary,
  RecentTrades,
  RelayerHealth,
  TradingState,
} from './types.js';
import type { SignedIntent } from './typed-data.js';

/** The API pages account history in fixed pages of exactly 75 rows. */
export const ACCOUNT_PAGE_SIZE = 75;

const INTAKE_ACTIONS: IntentAction[] = [
  'registerSessionKey',
  'openPosition',
  'closePositions',
  'paperStake',
  'paperUnstake',
  'paperClaim',
  'paperDistribute',
  'registerDeposit',
  'withdrawToCore',
];

type RawInstrument = [
  number, string, number, string,
  boolean, boolean, boolean, boolean, boolean,
  string | null, string | null, number | null,
  string, string, number, string, string, string, string,
  string, string, string, string,
];

interface RawTradingState {
  schemaVersion: 1;
  indexedThroughBlock: number;
  tradingPaused: boolean;
  minimumTradeSizeRaw: string;
  minimumOpenNotionalRaw: string;
  accRewardPerShareRaw: string;
  instruments: RawInstrument[];
  intake?: [number, string, string, string[]];
}

const big = (v: string | null) => (v === null ? null : BigInt(v));

/** Decode the positional instrument tuple of /state/trading into named fields. */
export function decodeInstrument(t: RawInstrument): Instrument {
  const [
    id, symbol, assetIndex, priceScale,
    active, paused, terminal, retired, closeOnly,
    frozenBid, frozenAsk, pausedAt,
    rateMultiplier, positionMultiplier, maxLeverage, maxPosition, bustBuffer, baseRate, referenceNotional,
    longOi, shortOi, longCap, shortCap,
  ] = t;
  return {
    id,
    symbol,
    assetIndex,
    priceScale: BigInt(priceScale),
    active,
    paused,
    terminal,
    retired,
    closeOnly,
    openable: active && !paused,
    frozenBidRaw: big(frozenBid),
    frozenAskRaw: big(frozenAsk),
    pausedAtMs: pausedAt,
    rateMultiplierRaw: BigInt(rateMultiplier),
    positionMultiplierRaw: BigInt(positionMultiplier),
    maxLeverage,
    maxPositionNotionalRaw: BigInt(maxPosition),
    bustBufferRaw: BigInt(bustBuffer),
    baseRateRaw: BigInt(baseRate),
    referenceNotionalRaw: BigInt(referenceNotional),
    longOiRaw: BigInt(longOi),
    shortOiRaw: BigInt(shortOi),
    longCapRaw: BigInt(longCap),
    shortCapRaw: BigInt(shortCap),
  };
}

export function decodeTradingState(raw: RawTradingState): TradingState {
  const [revision, minStake, maxNetOi, disabled] = raw.intake ?? [0, '0', '0', []];
  return {
    schemaVersion: raw.schemaVersion,
    indexedThroughBlock: raw.indexedThroughBlock,
    tradingPaused: raw.tradingPaused,
    minimumTradeSizeRaw: BigInt(raw.minimumTradeSizeRaw),
    minimumOpenNotionalRaw: BigInt(raw.minimumOpenNotionalRaw),
    accRewardPerShareRaw: BigInt(raw.accRewardPerShareRaw),
    instruments: raw.instruments.map(decodeInstrument),
    intake: {
      revision,
      minimumPaperStakeRaw: BigInt(minStake),
      maximumNetOpenInterestRaw: BigInt(maxNetOi),
      actions: Object.fromEntries(INTAKE_ACTIONS.map((a) => [a, !disabled.includes(a)])) as Record<IntentAction, boolean>,
    },
  };
}

/** Expand a columnar series into `[{ t, ...columns }]` rows, skipping gap markers. */
export function seriesRows<C extends string>(series: {
  baseTimeMs: number;
  timeOffsetsMs: number[];
  columns: Record<C, number[]>;
}): Array<{ t: number } & Record<C, number>> {
  const keys = Object.keys(series.columns) as C[];
  return series.timeOffsetsMs.map((offset, i) => {
    const row = { t: series.baseTimeMs + offset } as { t: number } & Record<C, number>;
    for (const k of keys) (row as Record<string, number>)[k] = series.columns[k][i];
    return row;
  });
}

export interface HouseHead {
  t: number;
  values: number[];
}

/**
 * Read-only client for the public Papertrade API. Every method maps to one endpoint
 * and sends the exact canonical query string the API requires.
 */
export class PapertradeClient {
  readonly http: HttpTransport;

  constructor(options: HttpOptions | HttpTransport = {}) {
    this.http = options instanceof HttpTransport ? options : new HttpTransport(options);
  }

  // Protocol

  protocolSummary(signal?: AbortSignal) {
    return this.http.get<ProtocolSummary>('/query/protocol/summary', undefined, signal);
  }

  protocolHistory(interval: HistoryInterval = '1d', signal?: AbortSignal) {
    return this.http.get<ProtocolHistory>('/query/protocol/history', { interval }, signal);
  }

  marketStats(signal?: AbortSignal) {
    return this.http.get<MarketStats>('/query/protocol/market-stats', undefined, signal);
  }

  queueSummary(signal?: AbortSignal) {
    return this.http.get<QueueSummary>('/query/protocol/queue-summary', undefined, signal);
  }

  /** The 50 most recent opens, closes and liquidations across all traders. */
  recentTrades(signal?: AbortSignal) {
    return this.http.get<RecentTrades>('/query/protocol/trades/recent', undefined, signal);
  }

  /** Recent PAPER mint and stake events. */
  paperActivity(signal?: AbortSignal) {
    return this.http.get<PaperActivity>('/query/protocol/paper/activity', undefined, signal);
  }

  notices(signal?: AbortSignal) {
    return this.http.get<{ notices: Array<{ id?: string; title?: string; body?: string; level?: string }> }>('/query/notices', undefined, signal);
  }

  ready(signal?: AbortSignal) {
    return this.http.get<{ status: string }>('/query/ready', undefined, signal);
  }

  relayerHealth(signal?: AbortSignal) {
    return this.http.get<RelayerHealth>('/relayer/health', undefined, signal);
  }

  // Markets and live state

  /** Live instruments, open interest, caps, impact parameters and which intent actions are accepted. */
  async tradingState(signal?: AbortSignal): Promise<TradingState> {
    return decodeTradingState(await this.http.get<RawTradingState>('/state/trading', undefined, signal));
  }

  /** One raw price-history tile. Tiles must come from planPriceTiles; anything else is rejected. */
  priceTile(instrumentId: number, tile: PriceTile, signal?: AbortSignal) {
    return this.http.get<PriceHistory>(`/query/markets/${instrumentId}/price-history`, tile as unknown as Record<string, number>, signal);
  }

  /**
   * Papertrade mark price history (the Hyperliquid BBO mid the protocol settles on)
   * at 125 ms, 1 s or 1 min resolution. The window is planned into the tile grid
   * the API requires, fetched in parallel and merged.
   *
   *   await client.priceHistory({ instrumentId: 0, lookbackMs: 6 * 3600_000 })
   */
  async priceHistory(request: PriceWindowRequest, signal?: AbortSignal): Promise<{ intervalMs: number; points: PricePoint[] }> {
    const nowMs = request.nowMs ?? Date.now();
    const toMs = request.toMs ?? nowMs;
    const fromMs = request.fromMs ?? toMs - (request.lookbackMs ?? 6 * 3_600_000);
    const { tier, tiles } = planPriceTiles({ ...request, fromMs, toMs, nowMs });
    const results: PriceHistory[] = [];
    // Bounded parallelism keeps long windows (for example 30 days at 1 min = 120 tiles) polite.
    for (let i = 0; i < tiles.length; i += 6) {
      results.push(...(await Promise.all(tiles.slice(i, i + 6).map((tile) => this.priceTile(request.instrumentId, tile, signal)))));
    }
    return { intervalMs: tier.intervalMs, points: mergePriceTiles(results, fromMs, toMs) };
  }

  /** Liquidation prices of every open position bucketed into 150 bins around mark. */
  liquidationMap(instrumentId: number, range: LiquidationMapRange = '5', signal?: AbortSignal) {
    return this.http.get<LiquidationMap>(`/query/markets/${instrumentId}/liquidation-map`, { range }, signal);
  }

  /** 96x64 density grid of open positions by notional and distance to liquidation. */
  positionTopology(signal?: AbortSignal) {
    return this.http.get<PositionTopology>('/state/protocol/position-topology', undefined, signal);
  }

  /** House (LP) PnL curve across a plus or minus 1% price move for one coin. */
  houseDelta(coin: 'BTC' | 'ETH', signal?: AbortSignal) {
    return this.http.get<HouseDelta>('/state/house/delta', { coin }, signal);
  }

  /** Latest house (LP) equity heads per interval. */
  houseCurrent(signal?: AbortSignal) {
    return this.http.get<HouseCurrent>(
      '/state/house/current',
      undefined,
      signal,
    );
  }

  // Leaderboard

  /** Ranked accounts. `page` is 0-based (page 0 is the top 25); `pageSize` must be 25. */
  leaderboard(
    options: { window?: LeaderboardWindow; sortKey?: LeaderboardSortKey; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number; q?: string } = {},
    signal?: AbortSignal,
  ) {
    const { window = '24h', sortKey = 'totalWindowedPnl', sortDir = 'desc', page = 0, pageSize = 25, q } = options;
    return this.http.get<LeaderboardAccounts>('/state/leaderboard/accounts', { page, pageSize, q, sortDir, sortKey, window }, signal);
  }

  leaderboardPlacement(address: Address, window: LeaderboardWindow = '24h', signal?: AbortSignal) {
    return this.http.get<LeaderboardPlacement>(`/state/leaderboard/accounts/${address.toLowerCase()}`, { window }, signal);
  }

  /** Biggest single-position PnL rows. Only `24h` and `all` windows exist. */
  leaderboardPositions(window: '24h' | 'all' = '24h', signal?: AbortSignal) {
    return this.http.get<LeaderboardPositions>('/state/leaderboard/positions', { window }, signal);
  }

  // Accounts

  accountTrades(address: Address, options: { cursor?: string; filter?: 'all' | 'losses' } = {}, signal?: AbortSignal) {
    return this.http.get<Page<AccountTrade>>(
      `/query/accounts/${address.toLowerCase()}/trades`,
      { cursor: options.cursor, filter: options.filter ?? 'all', limit: ACCOUNT_PAGE_SIZE },
      signal,
    );
  }

  accountCashflows(address: Address, options: { cursor?: string } = {}, signal?: AbortSignal) {
    return this.http.get<Page<AccountCashflow>>(
      `/query/accounts/${address.toLowerCase()}/cashflows`,
      { cursor: options.cursor, limit: ACCOUNT_PAGE_SIZE },
      signal,
    );
  }

  accountStaking(address: Address, options: { cursor?: string } = {}, signal?: AbortSignal) {
    return this.http.get<Page<AccountStakingEvent>>(
      `/query/accounts/${address.toLowerCase()}/staking`,
      { cursor: options.cursor, limit: ACCOUNT_PAGE_SIZE },
      signal,
    );
  }

  accountQueue(address: Address, options: { cursor?: string } = {}, signal?: AbortSignal) {
    return this.http.get<Page<AccountQueueEvent>>(
      `/query/accounts/${address.toLowerCase()}/queue`,
      { cursor: options.cursor, limit: ACCOUNT_PAGE_SIZE },
      signal,
    );
  }

  /** Walk every page of an account history endpoint. */
  async *paginate<T>(fetchPage: (cursor?: string) => Promise<Page<T>>, maxPages = Infinity): AsyncGenerator<T> {
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await fetchPage(cursor);
      yield* res.items;
      if (!res.nextCursor) return;
      cursor = res.nextCursor;
    }
  }

  portfolioHistory(address: Address, range: PortfolioRange = '1d', signal?: AbortSignal) {
    return this.http.get<PortfolioHistory>(`/query/accounts/${address.toLowerCase()}/portfolio-history`, { range }, signal);
  }

  accountFunding(address: Address, signal?: AbortSignal) {
    return this.http.get<{ items: unknown[]; coreAccount: boolean }>(`/query/accounts/${address.toLowerCase()}/funding`, undefined, signal);
  }

  leaderboardBadges(address: Address, signal?: AbortSignal) {
    return this.http.get<LeaderboardBadges>(`/query/accounts/${address.toLowerCase()}/leaderboard-badges`, undefined, signal);
  }

  queueRing(address: Address, signal?: AbortSignal) {
    return this.http.get<QueueRing>(`/query/accounts/${address.toLowerCase()}/queue-ring`, undefined, signal);
  }

  queueBalances(address: Address, options: { cursor?: string } = {}, signal?: AbortSignal) {
    return this.http.get<QueueBalances>(
      `/query/accounts/${address.toLowerCase()}/queue-balances`,
      { cursor: options.cursor, limit: ACCOUNT_PAGE_SIZE },
      signal,
    );
  }

  /** Queue positions of the account's in-flight intents. */
  queueRank(address: Address, signal?: AbortSignal) {
    return this.http.get<QueueRank>(`/queue-rank/accounts/${address.toLowerCase()}`, undefined, signal);
  }

  // Intent submission (writes)

  /** Submit a signed intent. Use PapertradeTrader instead unless you sign intents yourself. */
  submitIntent(action: IntentAction, signed: SignedIntent, extra: Record<string, unknown> = {}, signal?: AbortSignal) {
    return this.http.post<IntentReceipt>('/intents', { action, signed, ...extra }, signal);
  }

  /** Cancel a queued intent with a CancelIntent signature (the body omits intentId, which is in the path). */
  cancelIntent(intentId: string, signedCancel: Omit<SignedIntent, 'intentId'>, signal?: AbortSignal) {
    return this.http.post<IntentReceipt>(`/intents/${intentId}/cancel`, signedCancel, signal);
  }

  /** Ask the relayer to retry the onward leg of a withdrawal that stalled. */
  retryOnward(intentId: string, signal?: AbortSignal) {
    return this.http.post<IntentReceipt>(`/intents/${intentId}/onward`, {}, signal);
  }

  /**
   * Register a wallet's deposit proxy with the relayer so it watches it for
   * incoming USDC. Returns the proxy (deposit) address. Safe to call repeatedly.
   */
  checkDepositAddress(user: Address, signal?: AbortSignal) {
    return this.http.post<{ proxy: Address }>('/funding/deposits/check', { user: user.toLowerCase() }, signal);
  }
}
