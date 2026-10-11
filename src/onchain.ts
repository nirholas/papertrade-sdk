import { parseAbi, type Address, type Hex, type PublicClient } from 'viem';
import { MAINNET } from './deployment.js';
import { publicClient } from './deposit.js';

export const PAPER_TOKEN_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

export const PAPER_STAKING_ABI = parseAbi([
  'function pendingReward(address user) view returns (uint256)',
  'function accRewardPerShare() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
]);

/** PAPER held (unstaked) by a wallet on HyperEVM, 18 decimals. */
export async function paperBalance(user: Address, client: PublicClient = publicClient()): Promise<bigint> {
  return (await client.readContract({ address: MAINNET.contracts.paper, abi: PAPER_TOKEN_ABI, functionName: 'balanceOf', args: [user] })) as bigint;
}

/** Total PAPER supply (every token was minted to a losing trader). */
export async function paperTotalSupply(client: PublicClient = publicClient()): Promise<bigint> {
  return (await client.readContract({ address: MAINNET.contracts.paper, abi: PAPER_TOKEN_ABI, functionName: 'totalSupply' })) as bigint;
}

/** USDC rewards (wad) already distributed to a staker and claimable now. */
export async function pendingReward(user: Address, client: PublicClient = publicClient()): Promise<bigint> {
  return (await client.readContract({ address: MAINNET.contracts.paperStaking, abi: PAPER_STAKING_ABI, functionName: 'pendingReward', args: [user] })) as bigint;
}

/** Global staking state straight from PaperStaking, read in one multicall. */
export async function stakingState(client: PublicClient = publicClient()): Promise<{ accRewardPerShareRaw: bigint; totalStakedRaw: bigint; domainSeparator: Hex }> {
  const address = MAINNET.contracts.paperStaking;
  const [acc, total, domain] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address, abi: PAPER_STAKING_ABI, functionName: 'accRewardPerShare' },
      { address, abi: PAPER_STAKING_ABI, functionName: 'totalStaked' },
      { address, abi: PAPER_STAKING_ABI, functionName: 'DOMAIN_SEPARATOR' },
    ],
  });
  return { accRewardPerShareRaw: acc as bigint, totalStakedRaw: total as bigint, domainSeparator: domain as Hex };
}
