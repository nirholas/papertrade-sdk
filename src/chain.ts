import { defineChain } from 'viem';
import { hyperEvm as viemHyperEvm } from 'viem/chains';
import { MAINNET } from './deployment.js';

/** HyperEVM mainnet (chain 999): viem's definition plus a fallback RPC and the HyperEVMScan explorer. */
export const hyperEvm = defineChain({
  ...viemHyperEvm,
  rpcUrls: {
    default: { http: [MAINNET.network.rpcUrl, ...MAINNET.network.fallbackRpcUrls] },
  },
  blockExplorers: {
    default: { name: 'HyperEVMScan', url: MAINNET.network.explorerUrl },
  },
});
