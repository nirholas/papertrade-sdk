/**
 * Unit conversion. Papertrade's API and contracts carry USD values as 18-decimal
 * integers ("wad"), HyperEVM USDC uses 6 decimals, HyperCore USDC uses 8, and
 * prices are integers divided by a per-instrument `priceScale` (BTC 10, ETH 100).
 */
export const WAD = 10n ** 18n;
export const USDC_DECIMALS = 6;
export const COLLATERAL_SCALE = 10n ** 12n;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Parse a decimal string or number into an integer with `decimals` places, without float rounding. */
export function parseUnits(value: string | number, decimals: number): bigint {
  const text = typeof value === 'number' ? numberToPlain(value) : value.trim();
  if (!DECIMAL_RE.test(text)) throw new TypeError(`"${value}" is not a decimal number`);
  const negative = text.startsWith('-');
  const [whole, frac = ''] = text.replace('-', '').split('.');
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) {
    throw new RangeError(`"${value}" has more than ${decimals} decimal places`);
  }
  const raw = BigInt(whole + frac.slice(0, decimals).padEnd(decimals, '0'));
  return negative ? -raw : raw;
}

/** Format an integer with `decimals` places as a plain decimal string (no exponent, trailing zeros trimmed). */
export function formatUnits(raw: bigint | string, decimals: number): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`${n} is not finite`);
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

/** USD number to 18-decimal raw. */
export const usdToWad = (usd: string | number) => parseUnits(usd, 18);
/** 18-decimal raw to a JS number (display only; use formatUnits for exact output). */
export const wadToNumber = (raw: bigint | string) => Number(formatUnits(raw, 18));
/** 18-decimal raw to a decimal string. */
export const wadToString = (raw: bigint | string) => formatUnits(raw, 18);

/** HyperEVM USDC (6 decimals) to the API's 18-decimal representation. */
export const usdcToWad = (usdc: bigint) => usdc * COLLATERAL_SCALE;
/** API 18-decimal value to HyperEVM USDC units (6 decimals), truncating dust. */
export const wadToUsdc = (wad: bigint) => wad / COLLATERAL_SCALE;

/** Raw price integer to a number, given the instrument price scale. */
export function priceFromRaw(raw: bigint | string | number, priceScale: number | string | bigint): number {
  return Number(raw) / Number(priceScale);
}

/** Price number to the raw integer the protocol stores (rounded to the instrument tick). */
export function priceToRaw(price: number, priceScale: number | string | bigint): bigint {
  return BigInt(Math.round(price * Number(priceScale)));
}

/** Compact USD formatting for dashboards: $1.23M, $456.7K, $12.34. */
export function formatUsdCompact(usd: number): string {
  const abs = Math.abs(usd);
  const sign = usd < 0 ? '-' : '';
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${sign}$${(abs / size).toFixed(abs / size >= 100 ? 1 : 2)}${suffix}`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}
