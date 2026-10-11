import { concat, hashTypedData, keccak256, recoverAddress, toBytes, type Address, type Hex } from 'viem';
import { MAINNET } from './deployment.js';

/**
 * EIP-712 schemas used by the Papertrade relayer.
 *
 * The exchange domain name really is the literal string "String". This is not a
 * typo in the SDK: a mainnet Close signature only recovers to the trader's
 * registered session key under that name (verified in test/typed-data.test.ts).
 */
export const PAPERTRADE_TYPES = {
  RegisterSessionKey: [
    { name: 'user', type: 'address' },
    { name: 'key', type: 'address' },
    { name: 'expiry', type: 'uint64' },
    { name: 'feeAddress', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  OpenPosition: [
    { name: 'user', type: 'address' },
    { name: 'instrumentId', type: 'uint32' },
    { name: 'isLong', type: 'bool' },
    { name: 'size', type: 'uint128' },
    { name: 'leverage', type: 'uint32' },
    { name: 'useDebt', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  Close: [
    { name: 'user', type: 'address' },
    { name: 'positionIds', type: 'uint256[]' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  WithdrawToCore: [
    { name: 'user', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  Stake: [
    { name: 'user', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  Unstake: [
    { name: 'user', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  Claim: [
    { name: 'user', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  Distribute: [
    { name: 'user', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  CancelIntent: [
    { name: 'user', type: 'address' },
    { name: 'intentId', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export type PapertradePrimaryType = keyof typeof PAPERTRADE_TYPES;

export interface TypedDataDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export const INTENT_ID_PREFIX = 'papertrade:intent-id:v2';
const INTENT_ID_PREFIX_HASH = keccak256(toBytes(INTENT_ID_PREFIX));

export function exchangeDomain(chainId: number = MAINNET.chainId, exchange: Address = MAINNET.contracts.exchange): TypedDataDomain {
  return { name: 'String', version: '1', chainId, verifyingContract: exchange };
}

export function paperStakingDomain(
  chainId: number = MAINNET.chainId,
  staking: Address = MAINNET.contracts.paperStaking,
): TypedDataDomain {
  return { name: 'PaperStaking', version: '1', chainId, verifyingContract: staking };
}

export function cancellationDomain(chainId: number = MAINNET.chainId, exchange: Address = MAINNET.contracts.exchange): TypedDataDomain {
  return { name: 'PaperTrade Intent Cancel', version: '2', chainId, verifyingContract: exchange };
}

/** Which domain each primary type is signed under. */
export function domainFor(type: PapertradePrimaryType, chainId?: number): TypedDataDomain {
  if (type === 'Stake' || type === 'Unstake' || type === 'Claim' || type === 'Distribute') return paperStakingDomain(chainId);
  if (type === 'CancelIntent') return cancellationDomain(chainId);
  return exchangeDomain(chainId);
}

/** A signed intent in the exact wire shape the relayer expects: every field stringified, plus v/r/s. */
export type SignedIntent = Record<string, string | boolean | string[]> & { v: string; r: Hex; s: Hex };

/**
 * Normalize a message field to its wire form: uints become decimal strings,
 * addresses and bytes lowercase hex, bools stay booleans, arrays map element-wise.
 */
export function toWireValue(type: string, value: unknown): string | boolean | string[] {
  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) throw new TypeError(`expected an array for ${type}`);
    return value.map((v) => toWireValue(type.slice(0, -2), v) as string);
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new TypeError('expected a boolean');
    return value;
  }
  if (type.startsWith('uint') || type.startsWith('int')) {
    const n = BigInt(value as bigint | number | string);
    if (type.startsWith('uint') && n < 0n) throw new RangeError(`${type} cannot be negative`);
    return n.toString();
  }
  if (type === 'address' || type.startsWith('bytes')) {
    const s = String(value);
    if (!/^0x[0-9a-fA-F]*$/.test(s)) throw new TypeError(`expected hex for ${type}`);
    return s.toLowerCase();
  }
  return String(value);
}

export function toWireMessage(type: PapertradePrimaryType, message: Record<string, unknown>) {
  const out: Record<string, string | boolean | string[]> = {};
  for (const field of PAPERTRADE_TYPES[type]) {
    if (!(field.name in message)) throw new TypeError(`${type}.${field.name} is required`);
    out[field.name] = toWireValue(field.type, message[field.name]);
  }
  return out;
}

/** Convert a wire message back into viem-typed values for hashing. */
function fromWire(type: PapertradePrimaryType, wire: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const field of PAPERTRADE_TYPES[type]) {
    const v = wire[field.name];
    if (field.type.endsWith('[]')) out[field.name] = (v as string[]).map((x) => BigInt(x));
    else if (field.type.startsWith('uint')) out[field.name] = BigInt(v as string);
    else out[field.name] = v;
  }
  return out;
}

export function hashIntent(domain: TypedDataDomain, type: PapertradePrimaryType, wire: Record<string, unknown>): Hex {
  return hashTypedData({
    domain,
    types: { [type]: PAPERTRADE_TYPES[type] } as Record<string, readonly { name: string; type: string }[]>,
    primaryType: type,
    message: fromWire(type, wire),
  } as Parameters<typeof hashTypedData>[0]);
}

/** intentId = keccak256(keccak256("papertrade:intent-id:v2") ++ digest ++ signer). */
export function computeIntentId(digest: Hex, signer: Address): Hex {
  return keccak256(concat([INTENT_ID_PREFIX_HASH, digest, signer.toLowerCase() as Hex]));
}

/** Recompute digest, signer and intentId from a signed wire intent, exactly as the relayer does. */
export async function inspectSignedIntent(domain: TypedDataDomain, type: PapertradePrimaryType, signed: SignedIntent) {
  const digest = hashIntent(domain, type, signed);
  const signer = (await recoverAddress({ hash: digest, signature: { r: signed.r, s: signed.s, v: BigInt(signed.v) } })).toLowerCase() as Address;
  return { digest, signer, intentId: computeIntentId(digest, signer) };
}

/** Anything that can sign EIP-712 typed data: a viem LocalAccount or a WalletClient bound to an account. */
export interface TypedDataSigner {
  address: Address;
  signTypedData(args: {
    domain: TypedDataDomain;
    types: Record<string, readonly { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

/** Sign a Papertrade intent and return it in wire form with v/r/s. */
export async function signIntent(
  signer: TypedDataSigner,
  domain: TypedDataDomain,
  type: PapertradePrimaryType,
  message: Record<string, unknown>,
): Promise<SignedIntent> {
  const wire = toWireMessage(type, message);
  const signature = await signer.signTypedData({
    domain,
    types: { [type]: PAPERTRADE_TYPES[type] },
    primaryType: type,
    message: fromWire(type, wire),
  });
  const { r, s, yParity } = splitSignature(signature);
  return { ...wire, v: String(27 + yParity), r, s };
}

function splitSignature(sig: Hex) {
  const hex = sig.slice(2);
  if (hex.length !== 130) throw new Error('The wallet returned a malformed signature.');
  const v = parseInt(hex.slice(128, 130), 16);
  const yParity = v >= 27 ? v - 27 : v;
  if (yParity !== 0 && yParity !== 1) throw new Error('The wallet returned a malformed signature.');
  return { r: `0x${hex.slice(0, 64).toLowerCase()}` as Hex, s: `0x${hex.slice(64, 128).toLowerCase()}` as Hex, yParity };
}
