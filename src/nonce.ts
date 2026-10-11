import type { Address } from 'viem';
import type { IntentAction } from './types.js';

/** Minimal key-value store for nonce state. `localStorage` satisfies it in browsers. */
export interface NonceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** In-process storage for servers and scripts. */
export class MemoryNonceStorage implements NonceStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

/** PAPER actions consume nonces from their own lane, separate from trading actions. */
export function nonceLane(action: IntentAction): 'paper' | 'session' {
  return action.startsWith('paper') ? 'paper' : 'session';
}

function randomSeed(): bigint {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const r = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  // Never 0: the relayer treats nonce 0 as unset.
  return BigInt(r === 0 ? 1 : r) * 256n;
}

/**
 * Client-side nonce allocator matching the official exchange client: each lane
 * starts at a random 24-bit seed times 256 and increments per intent. The
 * relayer only requires uniqueness per (user, lane), so a fresh random seed is
 * safe when state is lost, and persisting state avoids reuse across restarts.
 */
export class NonceAllocator {
  private readonly storage: NonceStorage;
  private readonly chainId: number;
  private readonly verifyingContract: Address;

  constructor(options: { chainId: number; verifyingContract: Address; storage?: NonceStorage }) {
    this.chainId = options.chainId;
    this.verifyingContract = options.verifyingContract.toLowerCase() as Address;
    this.storage = options.storage ?? new MemoryNonceStorage();
  }

  key(user: Address, lane: 'paper' | 'session') {
    return `papertrade.clientNonce.v1:${this.chainId}:${this.verifyingContract}:${lane}:${user.toLowerCase()}`;
  }

  take(user: Address, action: IntentAction): bigint {
    const key = this.key(user, nonceLane(action));
    const stored = this.storage.getItem(key);
    const next = stored && /^\d+$/.test(stored) ? BigInt(stored) + 1n : randomSeed();
    this.storage.setItem(key, next.toString());
    return next;
  }
}
