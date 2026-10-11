import { createPublicClient, encodeFunctionData, http, parseAbi, type Address, type Hex, type PublicClient } from 'viem';
import { ACTIVATION_FEE_USDC, CORE_SPOT_DEX, MAINNET, MIN_DEPOSIT_USDC } from './deployment.js';
import { hyperEvm } from './chain.js';
import { sendAssetUsdc, spotSendUsdc, usdClassTransfer, type HyperCoreAction } from './hypercore.js';

export const DEPOSIT_PROXY_FACTORY_ABI = parseAbi(['function computeProxyAddress(address user) view returns (address)']);
export const CORE_DEPOSIT_WALLET_ABI = parseAbi([
  'function depositFor(address recipient, uint256 amount, uint32 destinationDex)',
  'function calculateCrossChainWithdrawalFee(bool shouldForward, uint32 destinationDomain) view returns (uint256)',
]);
export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export function publicClient(rpcUrl: string = MAINNET.network.rpcUrl): PublicClient {
  return createPublicClient({ chain: hyperEvm, transport: http(rpcUrl) }) as PublicClient;
}

/**
 * Every Papertrade account has a deterministic deposit proxy on HyperCore. USDC
 * that lands on it (minimum 10 USDC) is swept into the trader's exchange balance.
 */
export async function computeDepositAddress(user: Address, client: PublicClient = publicClient()): Promise<Address> {
  return (await client.readContract({
    address: MAINNET.contracts.depositProxyFactory,
    abi: DEPOSIT_PROXY_FACTORY_ABI,
    functionName: 'computeProxyAddress',
    args: [user],
  })) as Address;
}

export interface EvmCall {
  to: Address;
  data: Hex;
  value: bigint;
  description: string;
}

/**
 * HyperEVM deposit route: approve native USDC to the CoreDepositWallet bridge and
 * call depositFor(proxy, amount, spot). The bridge credits the proxy on HyperCore
 * spot, and the relayer sweeps it into Papertrade. Returns the calls to send;
 * nothing is broadcast here.
 */
export async function buildHyperEvmDeposit(params: {
  user: Address;
  /** USDC amount in 6 decimals. Must be at least 10 USDC plus the 1 USDC activation fee on first deposit. */
  amount: bigint;
  /** Skip the approve call when allowance already covers the amount. */
  client?: PublicClient;
  /** Deposit address from computeDepositAddress or checkDepositAddress. */
  proxy?: Address;
  firstDeposit?: boolean;
}): Promise<{ proxy: Address; calls: EvmCall[]; minimum: bigint }> {
  const client = params.client ?? publicClient();
  const proxy = params.proxy ?? (await computeDepositAddress(params.user, client));
  const minimum = MIN_DEPOSIT_USDC + (params.firstDeposit === false ? 0n : ACTIVATION_FEE_USDC);
  if (params.amount < minimum) {
    throw new RangeError(`Deposit at least ${Number(minimum) / 1e6} USDC (10 USDC minimum${params.firstDeposit === false ? '' : ' plus the 1 USDC first-deposit activation fee'}).`);
  }
  const bridge = MAINNET.contracts.coreDepositWallet;
  const allowance = (await client.readContract({
    address: MAINNET.contracts.usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [params.user, bridge],
  })) as bigint;
  const calls: EvmCall[] = [];
  if (allowance < params.amount) {
    calls.push({
      to: MAINNET.contracts.usdc,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [bridge, params.amount] }),
      value: 0n,
      description: `Approve ${Number(params.amount) / 1e6} USDC to the HyperCore deposit bridge`,
    });
  }
  calls.push({
    to: bridge,
    data: encodeFunctionData({ abi: CORE_DEPOSIT_WALLET_ABI, functionName: 'depositFor', args: [proxy, params.amount, CORE_SPOT_DEX] }),
    value: 0n,
    description: `Bridge ${Number(params.amount) / 1e6} USDC to the Papertrade deposit address ${proxy}`,
  });
  return { proxy, calls, minimum };
}

/**
 * HyperCore deposit route: send spot USDC straight to the deposit proxy. When the
 * funds sit in the perp balance, a usdClassTransfer to spot is prepended (and
 * signed with nonce, the send with nonce + 1), exactly like the official client.
 */
export function buildHyperCoreDeposit(params: {
  proxy: Address;
  /** USDC amount in 6 decimals. */
  amount: bigint;
  /** Where the USDC currently is on HyperCore. */
  account: 'spot' | 'perp';
  /** From fetchAccountMode(user). Unified and portfolio-margin accounts must use sendAsset. */
  accountMode: 'default' | 'unifiedAccount' | 'portfolioMargin';
  /** 1 USDC on first deposit, else 0. Moved from perp along with the amount. */
  activationFee?: bigint;
  nonce?: bigint;
  signatureChainId?: number;
}): HyperCoreAction[] {
  const nonce = params.nonce ?? BigInt(Date.now());
  const sendNonce = params.account === 'perp' ? nonce + 1n : nonce;
  const common = { signatureChainId: params.signatureChainId, nonce: sendNonce };
  const send =
    params.accountMode === 'default'
      ? spotSendUsdc({ ...common, destination: params.proxy, amount: params.amount })
      : sendAssetUsdc({ ...common, destination: params.proxy, amount: params.amount });
  if (params.account !== 'perp') return [send];
  return [
    usdClassTransfer({ signatureChainId: params.signatureChainId, nonce, amount: params.amount + (params.activationFee ?? 0n), toPerp: false }),
    send,
  ];
}

/** HyperEVM USDC balance (6 decimals). */
export async function usdcBalance(user: Address, client: PublicClient = publicClient()): Promise<bigint> {
  return (await client.readContract({ address: MAINNET.contracts.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [user] })) as bigint;
}
