import { zeroAddress, type Address, type Hex } from 'viem';
import { PapertradeClient } from './api.js';
import { ACTIVATION_FEE_USDC, INTENT_TTL_SECONDS, MAINNET, MAX_CLOSE_BATCH, instrumentByName } from './deployment.js';
import { formatCoreUsdc, HYPEREVM_GAS_ALLOWANCE_USDC, HYPEREVM_USDC_SYSTEM_ADDRESS, sendAssetUsdc, signHyperCoreAction } from './hypercore.js';
import { notionalToQuantityRaw } from './math.js';
import { NonceAllocator, type NonceStorage } from './nonce.js';
import { createSessionKey, type SessionKey } from './session.js';
import {
  cancellationDomain,
  computeIntentId,
  exchangeDomain,
  hashIntent,
  paperStakingDomain,
  signIntent,
  type PapertradePrimaryType,
  type SignedIntent,
  type TypedDataDomain,
  type TypedDataSigner,
} from './typed-data.js';
import type { IntentAction, IntentReceipt, TradingState } from './types.js';

/** Minimum USDC a withdrawal must deliver after the activation fee (6 decimals). */
export const MIN_WITHDRAWAL_USDC = 10_000_000n;

/**
 * HyperCore charges 1 USDC to activate an account that has never received funds.
 * The official client charges it only when the wallet has never withdrawn and
 * the funding endpoint reports no HyperCore account.
 */
export function withdrawalActivationFee(lifetimeWithdrawnRaw: bigint, coreAccountExists: boolean): bigint {
  return lifetimeWithdrawnRaw === 0n && !coreAccountExists ? ACTIVATION_FEE_USDC : 0n;
}
import { formatUnits, parseUnits, usdcToWad, wadToUsdc } from './units.js';
import { fetchWalletState } from './live.js';

/** A signed intent ready to submit, plus everything needed to show it to a human first. */
export interface PreparedIntent {
  action: IntentAction;
  primaryType: PapertradePrimaryType;
  domain: TypedDataDomain;
  signed: SignedIntent;
  /** Locally computed id; the relayer returns the same id on acceptance. */
  intentId: Hex;
  signer: Address;
  extra: Record<string, unknown>;
  /** One-line plain-language summary for confirmation prompts. */
  summary: string;
}

export interface SubmittedIntent extends PreparedIntent {
  receipt: IntentReceipt;
}

export interface TraderOptions {
  /** The trader's wallet address (the account that owns balances and positions). */
  user: Address;
  /** Wallet signer: needed for registering session keys, withdrawals and PAPER actions. */
  wallet?: TypedDataSigner;
  /** Session key: signs opens, closes and cancels without wallet prompts. */
  session?: SessionKey;
  client?: PapertradeClient;
  /** Persist nonces across restarts (localStorage in browsers, a file-backed store in CLIs). */
  nonceStorage?: NonceStorage;
  chainId?: number;
  exchange?: Address;
  paperStaking?: Address;
  /** Clock override for deterministic tests. */
  now?: () => number;
}

export interface OpenPositionParams {
  /** 'BTC' | 'ETH' or an instrument id. */
  market: string | number;
  side: 'long' | 'short';
  /** Margin in USD (decimal string or number). */
  marginUsd: string | number;
  leverage: number;
  /** Pay margin from the queued (owed) balance instead of the free balance. */
  useDebt?: boolean;
  /**
   * Latest mark in raw price units. When given, validation also checks the side's
   * open-interest cap, which the protocol counts in base-asset quantity.
   */
  markPriceRaw?: bigint;
}

export class PapertradeIntentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PapertradeIntentError';
  }
}

/**
 * Signs and submits Papertrade intents through the relayer. Every action has a
 * `prepare*` method that signs without submitting (so callers can show the
 * exact intent and ask for confirmation) and a submitting counterpart.
 */
export class PapertradeTrader {
  readonly user: Address;
  readonly client: PapertradeClient;
  readonly nonces: NonceAllocator;
  private readonly wallet?: TypedDataSigner;
  private session?: SessionKey;
  private readonly chainId: number;
  private readonly exchange: Address;
  private readonly paperStaking: Address;
  private readonly now: () => number;

  constructor(options: TraderOptions) {
    this.user = options.user.toLowerCase() as Address;
    this.wallet = options.wallet;
    this.session = options.session;
    this.client = options.client ?? new PapertradeClient();
    this.chainId = options.chainId ?? MAINNET.chainId;
    this.exchange = options.exchange ?? MAINNET.contracts.exchange;
    this.paperStaking = options.paperStaking ?? MAINNET.contracts.paperStaking;
    this.now = options.now ?? Date.now;
    this.nonces = new NonceAllocator({ chainId: this.chainId, verifyingContract: this.exchange, storage: options.nonceStorage });
    if (this.wallet && this.wallet.address.toLowerCase() !== this.user) {
      throw new PapertradeIntentError('The wallet signer does not match the trader address.');
    }
  }

  get sessionKey(): SessionKey | undefined {
    return this.session;
  }

  private deadline() {
    return BigInt(Math.floor(this.now() / 1000) + INTENT_TTL_SECONDS);
  }

  private requireWallet(): TypedDataSigner {
    if (!this.wallet) throw new PapertradeIntentError('This action must be signed by the wallet; pass `wallet` to PapertradeTrader.');
    return this.wallet;
  }

  private requireSession(): SessionKey {
    if (!this.session) throw new PapertradeIntentError('No session key. Call registerSession() first or pass `session`.');
    return this.session;
  }

  private async sign(
    action: IntentAction,
    primaryType: PapertradePrimaryType,
    domain: TypedDataDomain,
    signer: TypedDataSigner,
    message: Record<string, unknown>,
    summary: string,
    extra: Record<string, unknown> = {},
  ): Promise<PreparedIntent> {
    const signed = await signIntent(signer, domain, primaryType, message);
    const digest = hashIntent(domain, primaryType, signed);
    const signerAddress = signer.address.toLowerCase() as Address;
    return { action, primaryType, domain, signed, intentId: computeIntentId(digest, signerAddress), signer: signerAddress, extra, summary };
  }

  /** Submit a prepared intent. Verifies the relayer derived the same intent id. */
  async submit(prepared: PreparedIntent, signal?: AbortSignal): Promise<SubmittedIntent> {
    const receipt = await this.client.submitIntent(prepared.action, prepared.signed, prepared.extra, signal);
    if (receipt.intentId && receipt.intentId.toLowerCase() !== prepared.intentId.toLowerCase()) {
      throw new PapertradeIntentError(`Relayer returned intent ${receipt.intentId}, expected ${prepared.intentId}.`);
    }
    return { ...prepared, receipt };
  }

  // Session keys

  /** Sign RegisterSessionKey with the wallet for a new (or given) session key. */
  async prepareRegisterSession(session: SessionKey = createSessionKey(undefined, this.now())) {
    const wallet = this.requireWallet();
    const prepared = await this.sign(
      'registerSessionKey',
      'RegisterSessionKey',
      exchangeDomain(this.chainId, this.exchange),
      wallet,
      {
        user: this.user,
        key: session.account.address,
        expiry: session.expiry,
        feeAddress: zeroAddress,
        nonce: this.nonces.take(this.user, 'registerSessionKey'),
        deadline: this.deadline(),
      },
      `Authorize session key ${session.account.address} to trade for ${this.user} until ${new Date(Number(session.expiry) * 1000).toISOString()}`,
    );
    return { prepared, session };
  }

  /** Register a session key and start using it for trades. */
  async registerSession(session?: SessionKey, signal?: AbortSignal) {
    const { prepared, session: key } = await this.prepareRegisterSession(session);
    const submitted = await this.submit(prepared, signal);
    this.session = key;
    return { ...submitted, session: key };
  }

  useSession(session: SessionKey) {
    this.session = session;
  }

  // Trading

  /** Validate an open against live market limits. Throws a plain-language error when the relayer would reject it. */
  validateOpen(params: OpenPositionParams, trading: TradingState) {
    const id = typeof params.market === 'number' ? params.market : instrumentByName(params.market).id;
    const inst = trading.instruments.find((i) => i.id === id);
    if (!inst) throw new PapertradeIntentError(`Unknown market ${params.market}.`);
    if (trading.tradingPaused) throw new PapertradeIntentError('Trading is paused protocol-wide.');
    if (!inst.openable) throw new PapertradeIntentError(`${inst.symbol} is not accepting new positions.`);
    if (!trading.intake.actions.openPosition) throw new PapertradeIntentError('The relayer is not accepting new positions right now.');
    if (!Number.isSafeInteger(params.leverage) || params.leverage < 1 || params.leverage > inst.maxLeverage) {
      throw new PapertradeIntentError(`Leverage must be a whole number from 1 to ${inst.maxLeverage}.`);
    }
    const margin = parseUnits(String(params.marginUsd), 18);
    const notional = margin * BigInt(params.leverage);
    if (margin < trading.minimumTradeSizeRaw) throw new PapertradeIntentError(`Minimum margin is $${formatUnits(trading.minimumTradeSizeRaw, 18)}.`);
    if (notional < trading.minimumOpenNotionalRaw) {
      throw new PapertradeIntentError(`Minimum position value (margin x leverage) is $${formatUnits(trading.minimumOpenNotionalRaw, 18)}.`);
    }
    if (notional > inst.maxPositionNotionalRaw) throw new PapertradeIntentError(`Maximum position value is $${formatUnits(inst.maxPositionNotionalRaw, 18)}.`);
    if (params.markPriceRaw !== undefined) {
      const sideOi = params.side === 'long' ? inst.longOiRaw : inst.shortOiRaw;
      const sideCap = params.side === 'long' ? inst.longCapRaw : inst.shortCapRaw;
      if (sideOi + notionalToQuantityRaw(notional, params.markPriceRaw, inst.priceScale) > sideCap) {
        throw new PapertradeIntentError(`${inst.symbol} ${params.side} open interest cap would be exceeded.`);
      }
    }
    return { instrument: inst, margin, notional };
  }

  async prepareOpen(params: OpenPositionParams, trading?: TradingState): Promise<PreparedIntent> {
    const session = this.requireSession();
    const state = trading ?? (await this.client.tradingState());
    const { instrument, margin, notional } = this.validateOpen(params, state);
    return this.sign(
      'openPosition',
      'OpenPosition',
      exchangeDomain(this.chainId, this.exchange),
      session.account,
      {
        user: this.user,
        instrumentId: instrument.id,
        isLong: params.side === 'long',
        size: margin,
        leverage: params.leverage,
        useDebt: Boolean(params.useDebt),
        nonce: this.nonces.take(this.user, 'openPosition'),
        deadline: this.deadline(),
      },
      `Open ${params.side.toUpperCase()} ${instrument.symbol} ${params.leverage}x: $${formatUnits(margin, 18)} margin, $${formatUnits(notional, 18)} notional`,
    );
  }

  async openPosition(params: OpenPositionParams, signal?: AbortSignal) {
    return this.submit(await this.prepareOpen(params), signal);
  }

  /** Sign Close intents, batching ids 12 per intent as the relayer requires. */
  async prepareClose(positionIds: Array<bigint | string | number>): Promise<PreparedIntent[]> {
    const session = this.requireSession();
    const ids = [...new Set(positionIds.map((id) => BigInt(id)))];
    if (!ids.length) throw new PapertradeIntentError('Choose at least one position to close.');
    const out: PreparedIntent[] = [];
    for (let i = 0; i < ids.length; i += MAX_CLOSE_BATCH) {
      const batch = ids.slice(i, i + MAX_CLOSE_BATCH);
      out.push(
        await this.sign(
          'closePositions',
          'Close',
          exchangeDomain(this.chainId, this.exchange),
          session.account,
          { user: this.user, positionIds: batch, nonce: this.nonces.take(this.user, 'closePositions'), deadline: this.deadline() },
          `Close position${batch.length > 1 ? 's' : ''} ${batch.join(', ')}`,
        ),
      );
    }
    return out;
  }

  async closePositions(positionIds: Array<bigint | string | number>, signal?: AbortSignal) {
    const prepared = await this.prepareClose(positionIds);
    const out: SubmittedIntent[] = [];
    for (const p of prepared) out.push(await this.submit(p, signal));
    return out;
  }

  /** Cancel a still-queued intent (signed by the session key). */
  async prepareCancel(intentId: Hex) {
    const session = this.requireSession();
    const domain = cancellationDomain(this.chainId, this.exchange);
    const deadline = this.deadline();
    const signed = await signIntent(session.account, domain, 'CancelIntent', { user: this.user, intentId, deadline });
    const { intentId: _omit, ...body } = signed;
    return { intentId, body, summary: `Cancel queued intent ${intentId}` };
  }

  async cancel(intentId: Hex, signal?: AbortSignal) {
    const { body } = await this.prepareCancel(intentId);
    return this.client.cancelIntent(intentId, body as Omit<SignedIntent, 'intentId'>, signal);
  }

  // Withdrawals

  /**
   * Withdraw USDC from Papertrade (wallet-signed). Route `hypercore` lands in the
   * wallet's HyperCore spot balance; `hyperevm` continues on to the wallet's
   * HyperEVM address with an extra wallet-signed onward transfer (0.1 USDC gas allowance).
   *
   * `activationFee` is 1 USDC on a wallet's first withdrawal when its HyperCore
   * account does not exist yet, else 0 (see withdrawalActivationFee).
   */
  async prepareWithdraw(params: { amountUsdc: string | number; route: 'hypercore' | 'hyperevm'; activationFee: bigint }): Promise<PreparedIntent> {
    const wallet = this.requireWallet();
    const amount = parseUnits(String(params.amountUsdc), 6);
    const sent = amount - params.activationFee;
    if (sent < MIN_WITHDRAWAL_USDC) {
      throw new PapertradeIntentError(`Withdraw at least ${formatCoreUsdc(MIN_WITHDRAWAL_USDC + params.activationFee)} USDC.`);
    }
    const gas = params.route === 'hypercore' ? 0n : HYPEREVM_GAS_ALLOWANCE_USDC;

    let onward: Record<string, unknown> | undefined;
    if (params.route === 'hyperevm') {
      const nonce = BigInt(this.now());
      const built = sendAssetUsdc({ destination: HYPEREVM_USDC_SYSTEM_ADDRESS, amount: sent - gas, nonce, signatureChainId: this.chainId });
      const sig = await signHyperCoreAction(wallet, built, this.chainId);
      onward = { nonce: String(nonce), maximumFee: '0', createRecipient: false, signature: { v: String(sig.v), r: sig.r.toLowerCase(), s: sig.s.toLowerCase() } };
    }
    const fees = params.activationFee + gas;
    return this.sign(
      'withdrawToCore',
      'WithdrawToCore',
      exchangeDomain(this.chainId, this.exchange),
      wallet,
      { user: this.user, amount: sent, nonce: this.nonces.take(this.user, 'withdrawToCore'), deadline: this.deadline() },
      `Withdraw ${formatCoreUsdc(amount)} USDC to ${params.route === 'hypercore' ? 'HyperCore spot' : 'HyperEVM'} for ${this.user}` +
        (fees > 0n ? ` (fees ${formatCoreUsdc(fees)} USDC, receive ${formatCoreUsdc(sent - gas)} USDC)` : ''),
      { withdrawal: { route: params.route, ...(onward ? { onward } : {}) } },
    );
  }

  /** Read live balances, work out the activation fee, check the amount is available, then sign and submit. */
  async withdraw(params: { amountUsdc: string | number; route: 'hypercore' | 'hyperevm' }, signal?: AbortSignal) {
    const [funding, state] = await Promise.all([
      this.client.accountFunding(this.user, signal),
      fetchWalletState(this.user, { baseUrl: this.client.http.baseUrl, signal }),
    ]);
    const amount = parseUnits(String(params.amountUsdc), 6);
    if (usdcToWad(amount) > state.funds.availableBalance) {
      throw new PapertradeIntentError(`Only ${formatUnits(wadToUsdc(state.funds.availableBalance), 6)} USDC is available to withdraw.`);
    }
    const activationFee = withdrawalActivationFee(state.lifetime.withdrawnRaw, funding.coreAccount);
    return this.submit(await this.prepareWithdraw({ ...params, activationFee }), signal);
  }

  // PAPER staking (wallet-signed, PaperStaking domain)

  // Distribute also has an EIP-712 type, but the relayer only accepts it from its own keeper:
  // the official client never submits it and user-signed Distribute intents are rejected (400).
  private paperIntent(action: 'paperStake' | 'paperUnstake' | 'paperClaim', amount?: bigint) {
    const wallet = this.requireWallet();
    const type = ({ paperStake: 'Stake', paperUnstake: 'Unstake', paperClaim: 'Claim' } as const)[action];
    const message: Record<string, unknown> = { user: this.user, nonce: this.nonces.take(this.user, action), deadline: this.deadline() };
    if (amount !== undefined) message.amount = amount;
    const label =
      action === 'paperStake'
        ? `Stake ${formatUnits(amount!, 18)} PAPER`
        : action === 'paperUnstake'
          ? `Unstake ${formatUnits(amount!, 18)} PAPER`
          : 'Claim PAPER staking rewards (USDC)';
    return this.sign(action, type, paperStakingDomain(this.chainId, this.paperStaking), wallet, message, label);
  }

  prepareStake(amountPaper: string | number) {
    return this.paperIntent('paperStake', parseUnits(String(amountPaper), 18));
  }
  prepareUnstake(amountPaper: string | number) {
    return this.paperIntent('paperUnstake', parseUnits(String(amountPaper), 18));
  }
  prepareClaim() {
    return this.paperIntent('paperClaim');
  }

  async stake(amountPaper: string | number, signal?: AbortSignal) {
    return this.submit(await this.prepareStake(amountPaper), signal);
  }
  async unstake(amountPaper: string | number, signal?: AbortSignal) {
    return this.submit(await this.prepareUnstake(amountPaper), signal);
  }
  async claim(signal?: AbortSignal) {
    return this.submit(await this.prepareClaim(), signal);
  }
}
