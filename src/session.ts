import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { SESSION_KEY_TTL_SECONDS } from './deployment.js';

export interface SessionKey {
  privateKey: Hex;
  account: PrivateKeyAccount;
  /** Unix seconds when the relayer stops accepting this key. */
  expiry: bigint;
}

/**
 * Create a fresh local session key. The wallet signs RegisterSessionKey once to
 * authorize it; afterwards every trade is signed locally with no wallet prompt.
 * Store the private key like any hot-wallet secret: it can open and close
 * positions for the wallet until it expires, but cannot withdraw.
 */
export function createSessionKey(ttlSeconds: number = SESSION_KEY_TTL_SECONDS, nowMs = Date.now()): SessionKey {
  const privateKey = generatePrivateKey();
  return restoreSessionKey(privateKey, BigInt(Math.floor(nowMs / 1000) + ttlSeconds));
}

export function restoreSessionKey(privateKey: Hex, expiry: bigint): SessionKey {
  return { privateKey, account: privateKeyToAccount(privateKey), expiry };
}

/** True when the wallet state lists this key as registered and unexpired (with a safety margin). */
export function isSessionKeyActive(sessionKeys: Record<string, bigint>, key: string, nowMs = Date.now(), marginSeconds = 60): boolean {
  const expiry = sessionKeys[key.toLowerCase()];
  return expiry !== undefined && expiry > BigInt(Math.floor(nowMs / 1000) + marginSeconds);
}
