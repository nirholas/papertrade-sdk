// Open a position with a session key. Signs locally and prints the exact intent; submits only with
// --submit AND an interactive "yes". Real funds: this trades the wallet's actual Papertrade balance.
//
//   PAPERTRADE_WALLET_KEY=0x... npx tsx examples/trade.ts BTC long 10 1000            # dry run
//   PAPERTRADE_WALLET_KEY=0x... npx tsx examples/trade.ts BTC long 10 1000 --submit   # asks, then sends
//
// The wallet key signs RegisterSessionKey once; the session key is cached in .papertrade-session.json
// (keep it out of git) and signs every trade after that.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { PapertradeTrader, fetchWalletState, isSessionKeyActive, restoreSessionKey, createSessionKey } from '../src/index.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const submit = process.argv.includes('--submit');
const [market = 'BTC', side = 'long', marginUsd = '10', leverage = '1000'] = args;
const key = process.env.PAPERTRADE_WALLET_KEY as Hex | undefined;
if (!key) throw new Error('Set PAPERTRADE_WALLET_KEY to the trading wallet private key.');

const wallet = privateKeyToAccount(key);
const SESSION_FILE = '.papertrade-session.json';
const cached = existsSync(SESSION_FILE) ? (JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as { privateKey: Hex; expiry: string }) : null;
const session = cached ? restoreSessionKey(cached.privateKey, BigInt(cached.expiry)) : createSessionKey();
const trader = new PapertradeTrader({ user: wallet.address, wallet, session });

async function confirm(summary: string) {
  console.log(`\n${summary}`);
  if (!submit) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "yes" to sign and submit this with real funds: ');
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

const state = await fetchWalletState(wallet.address);
if (!isSessionKeyActive(state.sessionKeys, session.account.address)) {
  const { prepared: reg } = await trader.prepareRegisterSession(session);
  if (!(await confirm(reg.summary))) {
    console.log('Dry run: session key not registered. Re-run with --submit to register it.');
    process.exit(0);
  }
  await trader.submit(reg);
  writeFileSync(SESSION_FILE, JSON.stringify({ privateKey: session.privateKey, expiry: session.expiry.toString() }), { mode: 0o600 });
  console.log(`Session key ${session.account.address} registered.`);
}

const open = await trader.prepareOpen({ market, side: side as 'long' | 'short', marginUsd, leverage: Number(leverage) });
console.log(JSON.stringify({ action: open.action, intentId: open.intentId, signer: open.signer, signed: open.signed }, null, 2));
if (!(await confirm(open.summary))) {
  console.log('Dry run: nothing submitted.');
  process.exit(0);
}
const sent = await trader.submit(open);
console.log(`Accepted: ${sent.receipt.intentId}`);
