import type { Address, Hex } from 'viem';

/** Decimal string of an 18-decimal integer (USD wad, PAPER wad). */
export type Raw = string;

export interface SourceStamp {
  block: string;
  at: number;
}

export interface ProtocolSummary {
  ok: true;
  source: SourceStamp & { genesis: number };
  balances: { tvl: Raw; margin: Raw; lp: Raw; reserve: Raw; queue: Raw };
  activity: { volume: Raw; open: number };
  fees: { pending: Raw; lifetime: Raw };
  paper: {
    supply: Raw;
    staked: Raw;
    trackedLp: Raw;
    accumulator: Raw;
    tailProgress: Raw;
    reserve: Raw;
    unallocated: Raw;
    pendingRewards: Raw;
    cliff: Raw;
    cap: Raw;
    excess: Raw;
    rate: Raw;
    decay: Raw;
  };
}

export type HistoryInterval = '1h' | '1d';

export interface ProtocolHistory {
  startMs: number;
  intervalMs: number;
  columns: {
    tvl: number[];
    stakingRewards: number[];
    volume: number[];
    volumeBtc: number[];
    volumeEth: number[];
    traderPnl: number[];
    users: number[];
    liquidation: number[];
    trades: number[];
    paperSupply: number[];
    paperStaked: number[];
    paperRevenue: number[];
  };
  source: { asOfMs: number; revision: string; generation: string };
  totals: {
    tvlRaw: Raw;
    rewardsRaw: Raw;
    volumeRaw: Raw;
    liquidationRaw: Raw;
    tradesRaw: string;
    usersRaw: string;
    stakerFees24hRaw: Raw;
  };
}

export interface MarketStats {
  ok: true;
  markets: Record<string, { volume_24h: Raw }>;
}

export interface QueueSummary {
  ok: true;
  source: SourceStamp;
  total: Raw;
  count: number;
  largest: Raw | null;
  front: Raw | null;
}

export interface RecentTradeEvent {
  seq: string;
  ts: number;
  wallet: Address;
  instrument: string;
  instrumentId: number;
  instrumentTerminal: boolean;
  side: 'long' | 'short';
  leverage: number;
  notionalUsd: number;
  intentId: Hex | null;
  positionId: string;
  kind: 'open' | 'close' | 'liquidation' | string;
  entry: number | null;
  exit: number | null;
  pnlUsd: number | null;
}

export interface RecentTrades {
  ok: true;
  count: number;
  events: RecentTradeEvent[];
}

export interface PaperActivityItem {
  blockNumber: string;
  logIndex: number;
  timestampMs: number;
  txHash: Hex;
  amountRaw: Raw;
  kind: 'minted' | 'staked' | 'unstaked' | 'claimed' | string;
  userAddress: Address;
}

export interface PaperActivity {
  items: PaperActivityItem[];
}

export interface Instrument {
  id: number;
  symbol: string;
  assetIndex: number;
  priceScale: bigint;
  active: boolean;
  paused: boolean;
  terminal: boolean;
  retired: boolean;
  closeOnly: boolean;
  openable: boolean;
  frozenBidRaw: bigint | null;
  frozenAskRaw: bigint | null;
  pausedAtMs: number | null;
  /** Asymmetric-impact rate multiplier (wad). */
  rateMultiplierRaw: bigint;
  /** Asymmetric-impact position multiplier (wad). */
  positionMultiplierRaw: bigint;
  maxLeverage: number;
  maxPositionNotionalRaw: bigint;
  /** Liquidation buffer as a fraction of price (wad). About 4.76 bps at launch. */
  bustBufferRaw: bigint;
  /** Base rate of the impact haircut (wad). 10% at launch. */
  baseRateRaw: bigint;
  referenceNotionalRaw: bigint;
  /** Open long interest as a base-asset quantity (wad BTC or ETH), not USD. Use `openInterestUsd` for dollars. */
  longOiRaw: bigint;
  /** Open short interest as a base-asset quantity (wad). */
  shortOiRaw: bigint;
  /** Long open-interest cap as a base-asset quantity (wad). */
  longCapRaw: bigint;
  /** Short open-interest cap as a base-asset quantity (wad). */
  shortCapRaw: bigint;
}

export type IntentAction =
  | 'registerSessionKey'
  | 'openPosition'
  | 'closePositions'
  | 'paperStake'
  | 'paperUnstake'
  | 'paperClaim'
  | 'paperDistribute'
  | 'registerDeposit'
  | 'withdrawToCore';

export interface TradingState {
  schemaVersion: 1;
  indexedThroughBlock: number;
  tradingPaused: boolean;
  minimumTradeSizeRaw: bigint;
  minimumOpenNotionalRaw: bigint;
  accRewardPerShareRaw: bigint;
  instruments: Instrument[];
  intake: {
    revision: number;
    minimumPaperStakeRaw: bigint;
    maximumNetOpenInterestRaw: bigint;
    /** Actions the relayer is currently accepting. */
    actions: Record<IntentAction, boolean>;
  };
}

export type LeaderboardWindow = '24h' | '7d' | '30d' | 'all';
export type LeaderboardSortKey =
  | 'totalWindowedPnl'
  | 'realizedPnl'
  | 'currentUnrealizedPnl'
  | 'currentBalance'
  | 'currentQueued'
  | 'currentOpenNotional'
  | 'totalVolume'
  | 'paperTotal'
  | 'currentOpenPositionCount';

export interface LeaderboardAccount {
  address: Address;
  leaderboardName: string | null;
  realizedPnl: Raw;
  totalWindowedPnl: Raw;
  totalVolume: Raw;
  lastActiveTs: number;
  currentBalance: Raw;
  currentQueued: Raw;
  currentOpenPositionCount: number;
  currentOpenNotional: Raw;
  currentUnrealizedPnl: Raw;
  paperTotal: Raw;
  _leaderboardRank?: number;
}

export interface LeaderboardAccounts {
  ok: true;
  count: number;
  summary: {
    uniqueAccounts: number;
    trackedBalance: Raw;
    trackedQueued: Raw;
    trackedOpenNotional: Raw;
    trackedPaper: Raw;
  };
  accounts: LeaderboardAccount[];
}

export interface LeaderboardPlacement {
  ok: true;
  selfIndex: number | null;
  selfRow: LeaderboardAccount | null;
}

export interface LeaderboardPositionRow {
  rank: number;
  address: Address;
  instrument: string;
  instrumentId: number;
  instrumentPriceScale: string;
  instrumentTerminal: boolean;
  side: 'long' | 'short';
  leverage: number;
  margin: Raw;
  entryPrice: string;
  exitPrice: string | null;
  pnl: Raw;
  openedAt: number;
  closedAt: number | null;
  leaderboardName: string | null;
}

export interface LeaderboardPositions {
  ok: true;
  rows: LeaderboardPositionRow[];
}

/** Columnar time series used by price history and portfolio history. */
export interface ColumnarSeries<C extends string> {
  fromMs: number;
  toMs: number;
  intervalMs: number;
  baseTimeMs: number;
  timeOffsetsMs: number[];
  columns: Record<C, number[]>;
  gapIndices: number[];
  series: string;
  aggregation: string;
  coverage: { availableFromMs: number; availableToMs: number; complete: boolean };
  source: { asOfMs: number; revision: string; generation: string };
}

export type PriceHistory = ColumnarSeries<'price'>;
export type PortfolioHistory = ColumnarSeries<'equity' | 'pnl'>;
export type PortfolioRange = '1h' | '1d' | '1w' | 'all';

export type LiquidationMapRange = '0.1' | '0.25' | '0.5' | '1' | '2' | '5' | '10' | '25';
/** [longNotionalRaw, shortNotionalRaw, longCount, shortCount] */
export type LiquidationBucket = [Raw, Raw, number, number];

export interface LiquidationMap {
  ok: true;
  instrumentId: number;
  range: LiquidationMapRange;
  fromRaw: string;
  toRaw: string;
  priceScale: string;
  source: SourceStamp & { priceAt: number };
  /** 150 equal-width price buckets from fromRaw to toRaw. */
  buckets: LiquidationBucket[];
  /** Everything liquidating below fromRaw. */
  below: LiquidationBucket;
  /** Everything liquidating above toRaw. */
  above: LiquidationBucket;
}

export interface PositionTopology {
  ok: true;
  count: number;
  /** Notional extent of the grid's x axis (USD). */
  nExt: number;
  /** Price-distance extent of the grid's y axis. */
  pExt: number;
  computedAtMs: number;
  grid: { w: number; h: number; data: number[] };
}

export interface HouseDelta {
  ok: true;
  revision: string;
  sourceAsOfMs: number;
  delta: {
    ok: boolean;
    t: number;
    markTs: number;
    positionVersion: number;
    computedMs: number;
    coin: string;
    mark: number;
    /** Fractional price range the curve spans either side of mark (0.01 = plus or minus 1%). */
    range: number;
    samples: number;
    positionCount: number;
    /** House PnL in USD at each sampled price, from mark*(1-range) to mark*(1+range). */
    values: number[];
    min: number;
    max: number;
  };
}

export interface AccountTrade {
  timestampMs: number;
  txHash: Hex;
  positionId: string;
  instrumentId: number;
  symbol: string;
  assetIndex: number;
  priceScaleRaw: string;
  terminal: boolean;
  retired: boolean;
  isLong: boolean;
  entryPriceRaw: string;
  marginRaw: Raw;
  leverage: number;
  kind: 'PositionClosed' | 'Liquidated';
  openedAtMs: number;
  exitPriceRaw: string;
  adjustedPnlRaw: Raw;
  userPaidFeeRaw: Raw;
  paperMintedRaw: Raw;
  paperMintBasisRaw: Raw;
  paperMintBatchTotalRaw: Raw | null;
}

export interface AccountCashflow {
  timestampMs: number;
  txHash: Hex;
  amountRaw: Raw;
  kind: 'Deposit' | 'Withdrawal';
  recipientAmountRaw: Raw | null;
  route: string | null;
  withdrawalStatus: 'signed' | 'submitted' | 'in_transit' | 'settled' | 'needs_signature' | 'failed' | null;
}

export interface AccountStakingEvent {
  timestampMs: number;
  txHash: Hex;
  amountRaw: Raw;
  kind: 'staked' | 'unstaked' | 'claimed';
}

export interface AccountQueueEvent {
  timestampMs: number;
  txHash: Hex;
  amountRaw: Raw;
  kind: 'enqueued' | 'harvested' | 'debt_consumed';
  eventCount: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface LeaderboardBadges {
  ok: true;
  badges: Record<'daily' | 'weekly' | 'monthly' | 'allTime', { first: number; top3: number; top15: number }>;
  total: number;
}

export interface QueueRing {
  ok: true;
  source: SourceStamp;
  total: Raw;
  count: number;
  account: { total: Raw; count: number };
  truncated: boolean;
  entries: unknown[];
}

export interface QueueBalances {
  ok: true;
  source: SourceStamp;
  total: Raw;
  count: number;
  account: { total: Raw; count: number };
  items: unknown[];
  nextCursor: string | null;
}

export interface QueueRank {
  ok: true;
  queueRevision: string;
  entries: unknown[];
}

export interface RelayerHealth {
  service: 'relayer-intake';
  ok: boolean;
  ready: boolean;
  databaseReady: boolean;
  pricesReady: boolean;
}

export interface OpenPosition {
  positionId: bigint;
  instrumentId: number;
  isLong: boolean;
  useDebt: boolean;
  entryPriceRaw: bigint;
  /** Margin in 18-decimal USD. */
  marginRaw: bigint;
  leverage: number;
  /** Price at which the position is liquidated (bust), in price-scale units. */
  bustPriceRaw: bigint;
  openedAtMs: number;
  intentId: Hex | null;
}

export interface ClosedPosition {
  positionId: bigint;
  instrumentId: number;
  isLong: boolean;
  marginRaw: bigint;
  leverage: number;
  liquidated: boolean;
  netPnlRaw: bigint;
  paperMintedRaw: bigint;
}

interface OperationBase {
  intentId: Hex;
  state: 'queued';
  acceptedAtMs: number;
  /** Unix seconds after which the relayer drops the intent. */
  deadline: string;
}

export type PendingOperation =
  | (OperationBase & { action: 'openPosition'; instrumentId: number; isLong: boolean; useDebt: boolean; marginRaw: string; leverage: number; notionalRaw: string })
  | (OperationBase & { action: 'closePositions'; positionIds: string[] })
  | (OperationBase & { action: 'withdrawToCore' | 'paperStake' | 'paperUnstake'; marginRaw: string })
  | (OperationBase & { action: 'registerSessionKey' | 'paperClaim' | 'paperDistribute' });

export type IntentOutcome = 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'unknown';

/** Decoded account state from the /state/user/live stream, with patches applied. */
export interface WalletState {
  address: Address;
  accountRevision: number;
  indexedThroughBlock: number;
  indexedThroughTimestamp: number;
  walletRevision: number;
  /** Registered session keys (lowercase) mapped to expiry in unix seconds. */
  sessionKeys: Record<string, bigint>;
  queueRevision: bigint;
  balance: bigint;
  queued: bigint;
  locked: bigint;
  funds: { reservedBalance: bigint; reservedQueued: bigint; availableBalance: bigint; availableQueued: bigint };
  queueNodeCount: number;
  consumableDebt: bigint;
  paper: { balance: bigint; staked: bigint; pendingBase: bigint; rewardDebt: bigint };
  lifetime: {
    depositedRaw: bigint;
    withdrawnRaw: bigint;
    realizedPnlRaw: bigint;
    feesPaidRaw: bigint;
    tradedNotionalRaw: bigint;
    paperRewardsClaimedRaw: bigint;
  };
  /** Open positions, newest first. */
  positions: OpenPosition[];
  operations: PendingOperation[];
  /** Positions closed by the most recent patch (empty on a full snapshot). */
  closedPositions: ClosedPosition[];
  /** Intent outcomes reported by the most recent patch. */
  intentOutcomes: { intentId: Hex; outcome: IntentOutcome }[];
}

export type IntentState = 'queued' | 'prepared' | 'confirmed' | 'failed' | 'reverted' | 'expired' | 'cancelled';

export interface IntentReceipt {
  intentId: Hex;
  action: IntentAction;
  state: IntentState | string;
  queueRevision?: string;
}

/** Column keys of a house series: LP equity, trader PnL, queue, then long/short open notional for BTC (bl, bs) and ETH (el, es), all in USD. */
export type HouseColumn = 'lp' | 'pnl' | 'q' | 'bl' | 'bs' | 'el' | 'es';

/** One columnar house series: sample i is at `baseTimeMs + timeOffsetsMs[i]`. */
export interface HouseSeries {
  baseTimeMs: number;
  timeOffsetsMs: number[];
  columns: Record<HouseColumn, number[]>;
}

/** `/state/house/current`. `head` is the latest sample `[timeMs, lp, pnl, q, bl, bs, el, es]`; `heads` is keyed by interval in ms ("1000", "60000", "3600000", "86400000"). */
export interface HouseCurrent {
  ok: true;
  revision: string;
  historyRevision?: string;
  historyGeneration?: number;
  sourceAsOfMs: number;
  head: [number, number, number, number, number, number, number, number];
  heads: Record<string, HouseSeries>;
}
