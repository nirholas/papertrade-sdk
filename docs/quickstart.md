---
title: Quickstart
description: Install papertrade-sdk, read the market, stream a wallet, quote a close and sign a trade in a few minutes.
order: 2
---
# Quickstart

## Install

```bash
npm install papertrade-sdk viem
```

`viem` is a peer dependency. Node 20 or newer is required for the global `fetch` and `AbortSignal.any`.

## Read the market

```ts
import { PapertradeClient, paperMintRate, wadToNumber } from 'papertrade-sdk';

const client = new PapertradeClient();
const trading = await client.tradingState();
for (const m of trading.instruments) {
  console.log(m.symbol, `max ${m.maxLeverage}x`, m.openable ? 'open' : 'closed');
}

const { points } = await client.priceHistory({ instrumentId: 0, lookbackMs: 15 * 60_000 });
console.log('BTC mark', points.at(-1)?.price);

const s = await client.protocolSummary();
console.log('PAPER per $1 of loss:', paperMintRate({
  trackedLpUsd: wadToNumber(s.paper.trackedLp),
  tailProgressUsd: wadToNumber(s.paper.tailProgress),
}));
```

## Quote a position before you open it

```ts
import { PapertradeClient, estimateClose, liquidationPriceRaw, priceFromRaw, priceToRaw, usdToWad } from 'papertrade-sdk';

const btc = (await new PapertradeClient().tradingState()).instruments[0];
const entry = priceToRaw(83000, btc.priceScale);

const est = estimateClose({
  instrument: btc,
  isLong: true,
  entryPriceRaw: entry,
  exitPriceRaw: priceToRaw(83083, btc.priceScale),
  marginRaw: usdToWad(100),
  leverage: 500,
});
console.log(est.netPnlUsd, est.keptFraction);

const bust = liquidationPriceRaw({ entryPriceRaw: entry, leverage: 500, isLong: true, bustBufferRaw: btc.bustBufferRaw });
console.log('bust', priceFromRaw(bust, btc.priceScale));
```

The same numbers come from the MCP tool `papertrade_estimate_position`, and the home page runs this code live.

## Watch a wallet

```ts
import { streamWallet, wadToNumber } from 'papertrade-sdk';

const stop = streamWallet({
  wallet: '0x...',
  onState(state, kind) {
    console.log(kind, wadToNumber(state.balance), state.positions.length, 'open');
  },
});
// later: stop();
```

For a one-off snapshot use `fetchWalletState(address)`.

## Trade with a session key

A wallet authorizes a session key once. The key can open and close positions but can never withdraw.

```ts
import { PapertradeTrader, createSessionKey } from 'papertrade-sdk';
import { privateKeyToAccount } from 'viem/accounts';

const wallet = privateKeyToAccount(process.env.PAPERTRADE_WALLET_KEY as `0x${string}`);
const trader = new PapertradeTrader({ user: wallet.address, wallet });
await trader.registerSession(createSessionKey());

const intent = await trader.prepareOpen({ market: 'BTC', side: 'long', marginUsd: 10, leverage: 1000 });
console.log(intent.summary);              // show the user exactly what will be sent
const { receipt } = await trader.submit(intent); // only after an explicit yes
```

Never submit an open, close, withdrawal, stake or deposit without the user's explicit confirmation of that specific action.

## Browsers and CORS

`exchange.papertrade.xyz` sends no CORS headers. Run a same-origin proxy and point the client at it:

```ts
new PapertradeClient({ baseUrl: '/api/papertrade' });
```

This site ships one as a Pages Function; see [Self-hosting](self-hosting).
