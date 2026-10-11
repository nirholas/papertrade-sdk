import type { Address, Hex } from 'viem';
import { MAINNET } from './deployment.js';
import type { TypedDataDomain, TypedDataSigner } from './typed-data.js';

/**
 * HyperCore user-signed actions used to move USDC into and out of Papertrade.
 * Signed with the wallet under Hyperliquid's `HyperliquidSignTransaction` domain
 * and submitted to the Hyperliquid exchange API.
 */
export const HYPERCORE_TYPES = {
  'HyperliquidTransaction:SendAsset': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'sourceDex', type: 'string' },
    { name: 'destinationDex', type: 'string' },
    { name: 'token', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'fromSubAccount', type: 'string' },
    { name: 'nonce', type: 'uint64' },
  ],
  'HyperliquidTransaction:SendToEvmWithData': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'token', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'sourceDex', type: 'string' },
    { name: 'destinationRecipient', type: 'string' },
    { name: 'addressEncoding', type: 'string' },
    { name: 'destinationChainId', type: 'uint32' },
    { name: 'gasLimit', type: 'uint64' },
    { name: 'data', type: 'bytes' },
    { name: 'nonce', type: 'uint64' },
  ],
  'HyperliquidTransaction:SpotSend': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'token', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
  'HyperliquidTransaction:UsdClassTransfer': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'toPerp', type: 'bool' },
    { name: 'nonce', type: 'uint64' },
  ],
} as const;

export type HyperCorePrimaryType = keyof typeof HYPERCORE_TYPES;

/** HyperCore system address that bridges spot USDC to HyperEVM. */
export const HYPEREVM_USDC_SYSTEM_ADDRESS = '0x2000000000000000000000000000000000000000';
/** HyperEVM gas the relayer reserves on onward withdrawals to HyperEVM (0.1 USDC, 6 decimals). */
export const HYPEREVM_GAS_ALLOWANCE_USDC = 100_000n;

export function hyperCoreDomain(signatureChainId: number = MAINNET.chainId): TypedDataDomain {
  return { name: 'HyperliquidSignTransaction', version: '1', chainId: signatureChainId, verifyingContract: '0x0000000000000000000000000000000000000000' };
}

/** USDC (6 decimals) to the decimal string HyperCore actions carry, trailing zeros trimmed. */
export function formatCoreUsdc(amount: bigint): string {
  const frac = String(amount % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  return `${amount / 1_000_000n}${frac ? `.${frac}` : ''}`;
}

export interface HyperCoreAction {
  primaryType: HyperCorePrimaryType;
  /** Message fields exactly as signed (bigints for uint64). */
  message: Record<string, string | boolean | bigint | number>;
  /** The JSON action body the Hyperliquid exchange API expects. */
  action: Record<string, unknown>;
  /** Nonce (ms timestamp) the request is submitted with. */
  nonce: bigint;
}

function build(type: string, primaryType: HyperCorePrimaryType, message: Record<string, string | boolean | bigint | number>, signatureChainId: number, nonce: bigint): HyperCoreAction {
  return {
    primaryType,
    message,
    nonce,
    action: {
      type,
      signatureChainId: `0x${signatureChainId.toString(16)}`,
      ...Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])),
    },
  };
}

interface Common {
  /** Unique ms timestamp. Default Date.now(). */
  nonce?: bigint;
  signatureChainId?: number;
  hyperliquidChain?: 'Mainnet' | 'Testnet';
}

export function spotSendUsdc(p: Common & { destination: Address; amount: bigint }): HyperCoreAction {
  const nonce = p.nonce ?? BigInt(Date.now());
  const chainId = p.signatureChainId ?? MAINNET.chainId;
  return build(
    'spotSend',
    'HyperliquidTransaction:SpotSend',
    { hyperliquidChain: p.hyperliquidChain ?? 'Mainnet', destination: p.destination.toLowerCase(), token: 'USDC', amount: formatCoreUsdc(p.amount), time: nonce },
    chainId,
    nonce,
  );
}

export function sendAssetUsdc(p: Common & { destination: Address; amount: bigint }): HyperCoreAction {
  const nonce = p.nonce ?? BigInt(Date.now());
  const chainId = p.signatureChainId ?? MAINNET.chainId;
  return build(
    'sendAsset',
    'HyperliquidTransaction:SendAsset',
    {
      hyperliquidChain: p.hyperliquidChain ?? 'Mainnet',
      destination: p.destination.toLowerCase(),
      sourceDex: 'spot',
      destinationDex: 'spot',
      token: 'USDC',
      amount: formatCoreUsdc(p.amount),
      fromSubAccount: '',
      nonce,
    },
    chainId,
    nonce,
  );
}

/** Move USDC between the HyperCore perp and spot balances (toPerp=false moves perp to spot). */
export function usdClassTransfer(p: Common & { amount: bigint; toPerp: boolean }): HyperCoreAction {
  const nonce = p.nonce ?? BigInt(Date.now());
  const chainId = p.signatureChainId ?? MAINNET.chainId;
  return build(
    'usdClassTransfer',
    'HyperliquidTransaction:UsdClassTransfer',
    { hyperliquidChain: p.hyperliquidChain ?? 'Mainnet', amount: formatCoreUsdc(p.amount), toPerp: p.toPerp, nonce },
    chainId,
    nonce,
  );
}

/** Sign a HyperCore action with the wallet. Returns the signature in Hyperliquid's {r, s, v} form. */
export async function signHyperCoreAction(signer: TypedDataSigner, built: HyperCoreAction, signatureChainId: number = MAINNET.chainId) {
  const sig = await signer.signTypedData({
    domain: hyperCoreDomain(signatureChainId),
    types: { [built.primaryType]: HYPERCORE_TYPES[built.primaryType] },
    primaryType: built.primaryType,
    message: built.message,
  });
  const hex = sig.slice(2);
  const vByte = parseInt(hex.slice(128, 130), 16);
  return { r: `0x${hex.slice(0, 64)}` as Hex, s: `0x${hex.slice(64, 128)}` as Hex, v: vByte < 27 ? vByte + 27 : vByte };
}

/** Submit a signed HyperCore action to the Hyperliquid exchange API. */
export async function submitHyperCoreAction(
  built: HyperCoreAction,
  signature: { r: Hex; s: Hex; v: number },
  options: { exchangeApiUrl?: string; fetch?: typeof fetch } = {},
): Promise<{ status: 'ok'; response: unknown }> {
  const res = await (options.fetch ?? fetch)(options.exchangeApiUrl ?? MAINNET.network.exchangeApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: built.action, nonce: Number(built.nonce), signature }),
  });
  const body = (await res.json().catch(() => null)) as { status?: string; response?: unknown } | null;
  if (!res.ok || body?.status !== 'ok') {
    throw new Error(`Hyperliquid rejected ${String(built.action.type)}: ${typeof body?.response === 'string' ? body.response : `HTTP ${res.status}`}`);
  }
  return { status: 'ok', response: body.response };
}

/** Hyperliquid info API helper (spot balances, candles, asset contexts). */
export async function hyperliquidInfo<T>(body: Record<string, unknown>, options: { infoApiUrl?: string; fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<T> {
  const res = await (options.fetch ?? fetch)(options.infoApiUrl ?? MAINNET.network.infoApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`Hyperliquid info ${String(body.type)} failed with HTTP ${res.status}`);
  return (await res.json()) as T;
}

export type CandleInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * OHLCV candles for the Hyperliquid perp that a Papertrade market tracks. The
 * official exchange UI charts these; Papertrade's own mark (the BBO mid) is in
 * PapertradeClient.priceHistory. At most 5000 candles per request.
 */
export async function fetchCandles(
  coin: string,
  interval: CandleInterval,
  startTime: number,
  endTime: number = Date.now(),
  options: { infoApiUrl?: string; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Candle[]> {
  const raw = await hyperliquidInfo<Array<{ t: number; o: string; h: string; l: string; c: string; v: string; s: string; i: string }>>(
    { type: 'candleSnapshot', req: { coin, interval, startTime, endTime: endTime - 1 } },
    options,
  );
  return raw
    .filter((c) => c.s === coin && c.i === interval)
    .map((c) => ({ time: c.t, open: Number(c.o), high: Number(c.h), low: Number(c.l), close: Number(c.c), volume: Number(c.v) }))
    .sort((a, b) => a.time - b.time);
}

/** Previous-day price and current mid for each Hyperliquid perp (for 24h change). */
export async function fetchDayContext(options: { infoApiUrl?: string; fetch?: typeof fetch; signal?: AbortSignal } = {}) {
  const [meta, ctxs] = await hyperliquidInfo<[{ universe: { name: string }[] }, { prevDayPx: string; midPx?: string | null; markPx?: string; dayNtlVlm?: string; openInterest?: string; funding?: string }[]]>(
    { type: 'metaAndAssetCtxs' },
    options,
  );
  return Object.fromEntries(meta.universe.map((u, i) => [u.name, ctxs[i]]));
}

/** USDC balance in the wallet's HyperCore spot account (decimal string). */
export async function fetchCoreSpotUsdc(user: Address, options: { infoApiUrl?: string; fetch?: typeof fetch; signal?: AbortSignal } = {}) {
  const state = await hyperliquidInfo<{ balances: { coin: string; total: string; hold: string }[] }>({ type: 'spotClearinghouseState', user }, options);
  const usdc = state.balances.find((b) => b.coin === 'USDC');
  return { total: usdc?.total ?? '0', hold: usdc?.hold ?? '0' };
}

/** Withdrawable USDC in the wallet's HyperCore perp account (decimal string). */
export async function fetchCorePerpWithdrawable(user: Address, options: { infoApiUrl?: string; fetch?: typeof fetch; signal?: AbortSignal } = {}) {
  const state = await hyperliquidInfo<{ withdrawable: string }>({ type: 'clearinghouseState', user }, options);
  return state.withdrawable;
}

/** Which HyperCore account abstraction the user is on (affects which send action a deposit uses). */
export async function fetchAccountMode(user: Address, options: { infoApiUrl?: string; fetch?: typeof fetch; signal?: AbortSignal } = {}) {
  const mode = await hyperliquidInfo<string | null>({ type: 'userAbstraction', user }, options).catch(() => null);
  return mode === 'unifiedAccount' || mode === 'portfolioMargin' ? mode : 'default';
}
