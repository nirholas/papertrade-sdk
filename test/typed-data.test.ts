import { describe, expect, it } from 'vitest';
import { hashDomain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import closes from './fixtures/mainnet-close-intents.json';
import {
  computeIntentId,
  domainFor,
  exchangeDomain,
  inspectSignedIntent,
  paperStakingDomain,
  PAPERTRADE_TYPES,
  signIntent,
  toWireMessage,
  type SignedIntent,
} from '../src/index.js';

// Two Close intents batched into HyperEVM tx 0xde30ba04...f1d9 (block 48187943),
// decoded from closePositionsBySig calldata. The relayer recorded these intentIds.
const SESSION_KEY = '0x267187775a7d539f23a0fdeb673cc61163fbe111';
const ONCHAIN_INTENT_IDS = [
  '0x02a1a5609273b3567d6028c4d8c906de22b2bfbee0a59971c9b4660b94df950c',
  '0x98d18aa5597ee213a0942dde0c29aa2fc0008c3e1f3b3e09984684458fec80e7',
];

describe('EIP-712 against mainnet', () => {
  it.each(closes.map((c, i) => [i, c] as const))('Close intent %i recovers the registered session key and its on-chain intentId', async (i, close) => {
    const { signer, intentId } = await inspectSignedIntent(exchangeDomain(), 'Close', close as unknown as SignedIntent);
    expect(signer).toBe(SESSION_KEY);
    expect(intentId).toBe(ONCHAIN_INTENT_IDS[i]);
  });

  it('a different exchange domain name does not recover the session key', async () => {
    const { signer } = await inspectSignedIntent({ ...exchangeDomain(), name: 'PaperTrade' }, 'Close', closes[0] as unknown as SignedIntent);
    expect(signer).not.toBe(SESSION_KEY);
  });

  it('PaperStaking domain hashes to the separator the contract reports on chain', () => {
    const d = paperStakingDomain();
    expect(hashDomain({ domain: { ...d, chainId: BigInt(d.chainId) }, types: { EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ] } })).toBe('0x71706d56c8b436981e93987cd97df512528491b243c6d8d1614cad52659e7eb0');
  });
});

describe('signing round trip', () => {
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

  it.each(Object.keys(PAPERTRADE_TYPES) as (keyof typeof PAPERTRADE_TYPES)[])('%s signs in wire form and recovers the signer', async (type) => {
    const sample: Record<string, unknown> = {};
    for (const f of PAPERTRADE_TYPES[type]) {
      sample[f.name] =
        f.type === 'address' ? account.address :
        f.type === 'bool' ? true :
        f.type === 'bytes32' ? `0x${'ab'.repeat(32)}` :
        f.type.endsWith('[]') ? [1n, 2n] : 7n;
    }
    const domain = domainFor(type);
    const signed = await signIntent(account, domain, type, sample);
    for (const [k, v] of Object.entries(signed)) {
      if (k === 'v' || k === 'r' || k === 's') continue;
      expect(['string', 'boolean'].includes(typeof v) || Array.isArray(v)).toBe(true);
    }
    const inspected = await inspectSignedIntent(domain, type, signed);
    expect(inspected.signer).toBe(account.address.toLowerCase());
    expect(inspected.intentId).toBe(computeIntentId(inspected.digest, account.address));
  });

  it('wire form stringifies uints and lowercases hex', () => {
    const wire = toWireMessage('OpenPosition', {
      user: '0xABCDEF0000000000000000000000000000000001',
      instrumentId: 1,
      isLong: false,
      size: 10n ** 21n,
      leverage: 50,
      useDebt: false,
      nonce: 256n,
      deadline: 1_800_000_000,
    });
    expect(wire).toEqual({
      user: '0xabcdef0000000000000000000000000000000001',
      instrumentId: '1',
      isLong: false,
      size: '1000000000000000000000',
      leverage: '50',
      useDebt: false,
      nonce: '256',
      deadline: '1800000000',
    });
  });

  it('rejects missing fields and negative uints', () => {
    expect(() => toWireMessage('Claim', { user: account.address, nonce: 1n })).toThrow(/deadline/);
    expect(() => toWireMessage('Claim', { user: account.address, nonce: -1n, deadline: 1n })).toThrow(RangeError);
  });
});
