import { describe, expect, it } from 'vitest';
import { MAINNET, PapertradeClient, pendingReward, pendingStakingRewardRaw, stakingState, fetchWalletState } from '../src/index.js';

// Hits the production API and HyperEVM RPC. Run with `npm run test:live`.
const live = process.env.PAPERTRADE_LIVE === '1';

describe.runIf(live)('live mainnet', () => {
  const client = new PapertradeClient();

  it('serves a decodable trading state for BTC and ETH', async () => {
    const state = await client.tradingState();
    expect(state.instruments.map((i) => i.symbol)).toEqual(expect.arrayContaining(['BTC', 'ETH']));
    expect(state.minimumOpenNotionalRaw).toBeGreaterThan(0n);
  });

  it('PaperStaking reports the domain separator the SDK signs under', async () => {
    const s = await stakingState();
    expect(s.domainSeparator).toBe('0x71706d56c8b436981e93987cd97df512528491b243c6d8d1614cad52659e7eb0');
  });

  it('pending staking reward from the live stream equals PaperStaking.pendingReward', async () => {
    const leader = (await client.leaderboard()).accounts[0];
    const [wallet, s] = await Promise.all([fetchWalletState(leader.address), stakingState()]);
    const onchain = await pendingReward(leader.address);
    const local = pendingStakingRewardRaw({
      stakedRaw: wallet.paper.staked,
      accRewardPerShareRaw: s.accRewardPerShareRaw,
      rewardDebtRaw: wallet.paper.rewardDebt,
      pendingBaseRaw: wallet.paper.pendingBase,
    });
    // The indexer can trail the chain by a block, so allow the accumulator to have moved slightly.
    const diff = onchain > local ? onchain - local : local - onchain;
    expect(diff * 1000n <= (onchain > 0n ? onchain : 1n)).toBe(true);
  }, 30_000);

  it('serves price history for BTC', async () => {
    const { points } = await client.priceHistory({ instrumentId: MAINNET.instruments[0].id, lookbackMs: 3_600_000 });
    expect(points.length).toBeGreaterThan(10);
  });
});
