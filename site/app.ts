import {
  PapertradeClient,
  estimateClose,
  liquidationPriceRaw,
  paperMintRate,
  priceFromRaw,
  priceToRaw,
  usdToWad,
  wadToNumber,
  formatUsdCompact,
  type TradingState,
} from '../src/index.js';

const client = new PapertradeClient({ baseUrl: '/api/papertrade', clientBuild: 'papertrade-sdk-site' });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prices = new Map<number, number>();
let trading: TradingState | null = null;

function setStatus(text: string, kind: 'ok' | 'err' | 'wait') {
  const el = $('status');
  el.textContent = text;
  el.dataset.kind = kind;
}

async function refreshPrices() {
  for (const inst of trading?.instruments ?? []) {
    const { points } = await client.priceHistory({ instrumentId: inst.id, lookbackMs: 60_000 });
    const last = points.at(-1);
    if (last) prices.set(inst.id, last.price);
    const cell = document.querySelector(`[data-price="${inst.id}"]`);
    if (cell && last) cell.textContent = `$${last.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    // OI is a base-asset quantity on chain; price it at the mark for dollars.
    const oi = document.querySelector(`[data-oi="${inst.id}"]`);
    if (oi && last) oi.textContent = `${formatUsdCompact(wadToNumber(inst.longOiRaw) * last.price)} / ${formatUsdCompact(wadToNumber(inst.shortOiRaw) * last.price)}`;
  }
}

async function loadMarket() {
  setStatus('Loading live data', 'wait');
  const [state, summary] = await Promise.all([client.tradingState(), client.protocolSummary()]);
  trading = state;
  $('markets').innerHTML = state.instruments
    .map(
      (i) => `<tr><th scope="row">${i.symbol}</th><td data-price="${i.id}"><span class="skeleton"></span></td><td>${i.maxLeverage}x</td>
      <td data-oi="${i.id}"><span class="skeleton"></span></td><td>${i.openable ? 'open' : 'closed'}</td></tr>`,
    )
    .join('');
  const select = $<HTMLSelectElement>('market');
  const chosen = select.value;
  select.innerHTML = state.instruments.map((i) => `<option value="${i.id}">${i.symbol}</option>`).join('');
  if (state.instruments.some((i) => String(i.id) === chosen)) select.value = chosen;
  const rate = paperMintRate({ trackedLpUsd: wadToNumber(summary.paper.trackedLp), tailProgressUsd: wadToNumber(summary.paper.tailProgress) });
  $('stat-tvl').textContent = formatUsdCompact(wadToNumber(summary.balances.tvl));
  $('stat-lp').textContent = formatUsdCompact(wadToNumber(summary.balances.lp));
  $('stat-volume').textContent = formatUsdCompact(wadToNumber(summary.activity.volume));
  $('stat-rate').textContent = rate.toFixed(2);
  await refreshPrices();
  setStatus(`Live from exchange.papertrade.xyz, block ${state.indexedThroughBlock.toLocaleString()}`, 'ok');
  estimate();
}

function estimate() {
  if (!trading) return;
  const inst = trading.instruments.find((i) => i.id === Number($<HTMLSelectElement>('market').value));
  const live = inst && prices.get(inst.id);
  const out = $('estimate');
  if (!inst || live === undefined) {
    out.textContent = 'Waiting for a live price.';
    return;
  }
  const lev = $<HTMLInputElement>('leverage');
  lev.max = String(inst.maxLeverage);
  const isLong = $<HTMLSelectElement>('side').value === 'long';
  const margin = Number($<HTMLInputElement>('margin').value);
  const leverage = Math.round(Number($<HTMLInputElement>('leverage').value));
  const movePct = Number($<HTMLInputElement>('move').value);
  $('leverage-out').textContent = `${leverage}x`;
  $('move-out').textContent = `${movePct > 0 ? '+' : ''}${movePct.toFixed(2)}%`;
  if (!(margin >= 10) || !(leverage >= 1 && leverage <= inst.maxLeverage) || margin * leverage < 10_000) {
    out.innerHTML = `<p class="warn">Papertrade needs at least $10 margin and $10,000 notional, up to ${inst.maxLeverage}x.</p>`;
    return;
  }
  const entryPriceRaw = priceToRaw(live, inst.priceScale);
  const exitPriceRaw = priceToRaw(live * (1 + movePct / 100), inst.priceScale);
  const est = estimateClose({ instrument: inst, isLong, entryPriceRaw, exitPriceRaw, marginRaw: usdToWad(margin), leverage });
  const bust = priceFromRaw(liquidationPriceRaw({ entryPriceRaw, leverage, isLong, bustBufferRaw: inst.bustBufferRaw }), inst.priceScale);
  const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  out.innerHTML = `
    <dl>
      <div><dt>Entry (live mid)</dt><dd>${priceFromRaw(entryPriceRaw, inst.priceScale).toLocaleString()}</dd></div>
      <div><dt>Bust price</dt><dd>${bust.toLocaleString()}</dd></div>
      <div><dt>Raw PnL</dt><dd>${usd(est.rawPnlUsd)}</dd></div>
      <div><dt>After impact</dt><dd>${usd(est.adjustedPnlUsd)}</dd></div>
      <div><dt>Win fee</dt><dd>${usd(est.winFeeUsd)}</dd></div>
      <div class="total ${est.netPnlUsd >= 0 ? 'pos' : 'neg'}"><dt>Net${est.liquidated ? ' (liquidated)' : ''}</dt><dd>${usd(est.netPnlUsd)}</dd></div>
    </dl>
    ${est.rawPnlUsd > 0 ? `<p class="note">You keep ${(est.keptFraction * 100).toFixed(1)}% of the raw gain.</p>` : ''}
    ${est.paperMintBasisUsd > 0 ? `<p class="note">PAPER mint basis ${usd(est.paperMintBasisUsd)}.</p>` : ''}`;
}

for (const id of ['market', 'side', 'margin', 'leverage', 'move']) $(id).addEventListener('input', estimate);
$('retry').addEventListener('click', () => start());

async function start() {
  $('retry').hidden = true;
  try {
    await loadMarket();
  } catch (err) {
    setStatus(`Could not reach the Papertrade API: ${err instanceof Error ? err.message : String(err)}`, 'err');
    $('retry').hidden = false;
  }
}

start();
setInterval(() => {
  if (trading && document.visibilityState === 'visible') refreshPrices().then(estimate, () => undefined);
}, 3000);

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(btn.dataset.copy!);
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = 'Copy'), 1200);
  }),
);
