/**
 * Papertrade mainnet deployment constants.
 *
 * Every address here was read from the production exchange frontend and
 * cross-checked on HyperEVM: the PaperStaking domain separator and a mainnet
 * Close signature both recover against these values (see test/typed-data.test.ts).
 */
export const MAINNET = {
  environmentId: 'production',
  chainId: 999,
  genesisMs: 1791326520000,
  apiUrl: 'https://exchange.papertrade.xyz',
  network: {
    chainName: 'HyperEVM Mainnet',
    rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    fallbackRpcUrls: ['https://rpc.hypurrscan.io'],
    explorerUrl: 'https://hyperevmscan.io',
    infoApiUrl: 'https://api.hyperliquid.xyz/info',
    exchangeApiUrl: 'https://api.hyperliquid.xyz/exchange',
    wsApiUrl: 'wss://api.hyperliquid.xyz/ws',
    signingEnvironment: 'Mainnet',
  },
  governance: {
    multisig: '0x696292762fd5ac3677a45edbe54eaece4194d1f6',
    timelock: '0xb915fa41e824d6aa31bb833ee81220c0f2c8ea0f',
  },
  contracts: {
    exchange: '0x6cd5661646289fb6e65ea5c032310fded797d0a2',
    batchExecutor: '0x233ff29b239abc1d7748605da9b205c3e008626e',
    paper: '0xe40f17915daa230324030003a197cdaef2261c0e',
    paperStaking: '0xaad6c7b0cc3014fc80ffedae0ed7ce5967b0f016',
    depositProxyFactory: '0x1629b7d46bef6e13ff754174fc9f32dea309b38f',
    /** CoreDepositWallet: the HyperEVM to HyperCore USDC bridge the deposit route calls `depositFor` on. */
    coreDepositWallet: '0x6b9e773128f453f5c2c60935ee2de2cbc5390a24',
    /** Canonical native USDC on HyperEVM (6 decimals). */
    usdc: '0xb88339cb7199b77e23db6e890353e22632ba630f',
  },
  precompiles: {
    spotBalance: '0x0000000000000000000000000000000000000801',
    withdrawable: '0x0000000000000000000000000000000000000803',
    mark: '0x0000000000000000000000000000000000000806',
    oracle: '0x0000000000000000000000000000000000000807',
    bbo: '0x000000000000000000000000000000000000080e',
  },
  funding: {
    ethereumRpcUrl: 'https://ethereum-rpc.publicnode.com',
    arbitrumRpcUrl: 'https://arb1.arbitrum.io/rpc',
    solanaRpcUrl: 'https://solana-rpc.publicnode.com',
    robinhoodRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    irisApiUrl: 'https://iris-api.circle.com',
    acrossApiUrl: 'https://app.across.to/api',
  },
  instruments: [
    { id: 0, name: 'BTC', assetIndex: 0, priceScale: 10 },
    { id: 1, name: 'ETH', assetIndex: 1, priceScale: 100 },
  ],
} as const;

export type Deployment = typeof MAINNET;
export type InstrumentName = (typeof MAINNET.instruments)[number]['name'];

/** Every trade intent is valid for one hour after signing. */
export const INTENT_TTL_SECONDS = 3600;
/** Session keys last 30 days. */
export const SESSION_KEY_TTL_SECONDS = 30 * 24 * 3600;
/** Close intents carry at most this many position ids. */
export const MAX_CLOSE_BATCH = 12;
/** Minimum USDC that must arrive at a deposit address for a sweep (6 decimals). */
export const MIN_DEPOSIT_USDC = 10_000_000n;
/** One-time activation fee charged on the first deposit (6 decimals). */
export const ACTIVATION_FEE_USDC = 1_000_000n;
/** `destinationDex` value CoreDepositWallet uses for the spot dex. */
export const CORE_SPOT_DEX = 4294967295;

export function instrumentByName(name: string) {
  const upper = name.toUpperCase();
  const found = MAINNET.instruments.find((i) => i.name === upper);
  if (!found) throw new RangeError(`Unknown Papertrade instrument "${name}". Live markets: BTC, ETH.`);
  return found;
}

export function instrumentById(id: number) {
  const found = MAINNET.instruments.find((i) => i.id === id);
  if (!found) throw new RangeError(`Unknown Papertrade instrument id ${id}.`);
  return found;
}
