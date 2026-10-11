import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyWalletPatch,
  decodeWalletSnapshot,
  isSessionKeyActive,
  MemoryNonceStorage,
  nonceLane,
  NonceAllocator,
  pendingStakingRewardRaw,
  SseParser,
  WalletStreamOutOfSync,
  withdrawalActivationFee,
  type RawWalletSnapshot,
} from '../src/index.js';

const sse = readFileSync(new URL('./fixtures/live_wallet.sse', import.meta.url), 'utf8');

function snapshot() {
  const msgs = new SseParser().push(sse);
  const wallet = msgs.find((m) => m.event === 'wallet')!;
  return { msgs, raw: JSON.parse(wallet.data) as RawWalletSnapshot };
}

describe('SseParser', () => {
  it('parses the recorded live stream, skipping comments', () => {
    const { msgs } = snapshot();
    expect(msgs.map((m) => m.event)).toEqual(['liveness', 'wallet']);
    expect(JSON.parse(msgs[0].data)).toEqual({ heartbeatIntervalMs: 10000 });
  });

  it('handles chunks split mid-line, CRLF and multi-line data', () => {
    const p = new SseParser();
    expect(p.push('event: a\r\nda')).toEqual([]);
    expect(p.push('ta: one\r\ndata: two\r\n\r\n')).toEqual([{ event: 'a', data: 'one\ntwo', id: undefined }]);
  });
});

describe('wallet snapshot and patches', () => {
  const { raw } = snapshot();
  const state = decodeWalletSnapshot(raw);

  it('decodes balances, positions and session keys', () => {
    expect(state.balance).toBe(46921585599286051076220n);
    expect(state.positions.map((p) => p.positionId)).toEqual([760n, 578n]);
    expect(state.positions[0].bustPriceRaw).toBe(826931n);
    expect(isSessionKeyActive(state.sessionKeys, '0xEC32445D300AA48C45FBE0356205F6BB09012B13', 1_790_000_000_000)).toBe(true);
    expect(isSessionKeyActive(state.sessionKeys, '0xec32445d300aa48c45fbe0356205f6bb09012b13', 1_794_184_554_000)).toBe(false);
  });

  it('computes pending staking rewards from the snapshot', () => {
    const pending = pendingStakingRewardRaw({
      stakedRaw: state.paper.staked,
      accRewardPerShareRaw: 8709904278374229395401056n,
      rewardDebtRaw: state.paper.rewardDebt,
      pendingBaseRaw: state.paper.pendingBase,
    });
    expect(pending).toBe(4058501411630604788773n);
  });

  it('applies a patch that closes one position and opens another', () => {
    const next = applyWalletPatch(state, {
      address: raw.address,
      accountRevision: 4,
      baseAccountRevision: 3,
      state: { balance: '1000000000000000000000' },
      closedPositions: [['760', 0, true, '10000000000000000000000', 1000, false, '-5000000000000000000', '0']],
      addedPositions: [['801', 1, false, false, '250000', '20000000000000000000', 25, '259000', 1791660000000, null]],
      removedPositionIds: ['760'],
      addedOperations: [],
      removedOperationIds: [],
    });
    expect(next.accountRevision).toBe(4);
    expect(next.balance).toBe(10n ** 21n);
    expect(next.positions.map((p) => p.positionId)).toEqual([801n, 578n]);
    expect(next.closedPositions[0].netPnlRaw).toBe(-5n * 10n ** 18n);
    expect(next.locked).toBe(state.locked);
  });

  it('refuses a patch built on a different revision', () => {
    expect(() =>
      applyWalletPatch(state, {
        address: raw.address, accountRevision: 9, baseAccountRevision: 8, state: {},
        addedPositions: [], removedPositionIds: [], addedOperations: [], removedOperationIds: [],
      }),
    ).toThrow(WalletStreamOutOfSync);
  });
});

describe('nonces', () => {
  const user = '0x0871deb34bfd2052b1c10dc4f6c0912a2a47e927';
  const exchange = '0x0000000000000000000000000000000000000abc';

  it('PAPER actions use their own lane', () => {
    expect(nonceLane('paperStake')).toBe('paper');
    expect(nonceLane('openPosition')).toBe('session');
    expect(nonceLane('withdrawToCore')).toBe('session');
  });

  it('seeds at a nonzero multiple of 256, then increments and persists', () => {
    const storage = new MemoryNonceStorage();
    const a = new NonceAllocator({ chainId: 999, verifyingContract: exchange, storage });
    const first = a.take(user, 'openPosition');
    expect(first > 0n && first % 256n === 0n).toBe(true);
    expect(a.take(user, 'closePositions')).toBe(first + 1n);
    const b = new NonceAllocator({ chainId: 999, verifyingContract: exchange, storage });
    expect(b.take(user, 'openPosition')).toBe(first + 2n);
    expect(b.take(user, 'paperClaim') % 256n).toBe(0n);
  });
});

describe('withdrawal activation fee', () => {
  it('charges 1 USDC only for a first withdrawal to a HyperCore account that does not exist', () => {
    expect(withdrawalActivationFee(0n, false)).toBe(1_000_000n);
    expect(withdrawalActivationFee(0n, true)).toBe(0n);
    expect(withdrawalActivationFee(1n, false)).toBe(0n);
  });
});
