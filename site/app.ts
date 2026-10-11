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

document.querySelectorAll<HTMLButtonElement>('[data-copy-sibling]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const code = btn.parentElement?.querySelector('code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  }),
);

$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const now = root.dataset.theme ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = now === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem('pt-theme', next);
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
});

/** Accessible tab lists: arrow keys move focus, panels toggle by aria-controls. */
function wireTabs(list: HTMLElement) {
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const select = (tab: HTMLButtonElement, focus: boolean) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls')!);
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t, false));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') select(tabs[(i + 1) % tabs.length], true);
      else if (e.key === 'ArrowLeft') select(tabs[(i - 1 + tabs.length) % tabs.length], true);
      else if (e.key === 'Home') select(tabs[0], true);
      else if (e.key === 'End') select(tabs[tabs.length - 1], true);
    });
  });
}
wireTabs($('play-tabs'));
wireTabs($('conn-tabs'));

/** MCP console: talks to the real /mcp endpoint exactly like an AI client. */
interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
}
const EXAMPLES: Record<string, unknown> = {
  papertrade_markets: {},
  papertrade_estimate_position: { market: 'BTC', side: 'long', marginUsd: 100, leverage: 500, priceMovePct: 0.1 },
  papertrade_paper_mint: { lossBasisUsd: 1000 },
  papertrade_wallet_positions: { address: '0x2025137a136bea7446deba681cbfc7cf1970840e' },
  papertrade_protocol_health: {},
  papertrade_prepare_open: { user: '0x2025137a136bea7446deba681cbfc7cf1970840e', market: 'ETH', side: 'short', marginUsd: 20, leverage: 500 },
  papertrade_build_typed_data: { type: 'Stake', message: { user: '0x2025137a136bea7446deba681cbfc7cf1970840e', amount: '1000000000000000000' } },
};
let rpcId = 0;
async function rpc(method: string, params?: unknown) {
  const res = await fetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (res.status === 429) throw new Error('Rate limited: wait a few seconds and run again.');
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
const mcpTools = new Map<string, McpTool>();
function setMcpStatus(text: string, kind: 'ok' | 'err' | 'wait') {
  const el = $('mcp-status');
  el.textContent = text;
  el.dataset.kind = kind;
}
function showTool() {
  const tool = mcpTools.get($<HTMLSelectElement>('mcp-tool').value);
  if (!tool) return;
  $('mcp-desc').textContent = tool.description;
  $<HTMLTextAreaElement>('mcp-args').value = JSON.stringify(EXAMPLES[tool.name] ?? {}, null, 2);
}
async function loadMcp() {
  setMcpStatus('Loading tools from /mcp', 'wait');
  try {
    const result = await rpc('tools/list');
    for (const t of result.tools as McpTool[]) mcpTools.set(t.name, t);
    const select = $<HTMLSelectElement>('mcp-tool');
    select.innerHTML = [...mcpTools.values()].map((t) => `<option value="${t.name}">${t.name}</option>`).join('');
    select.disabled = false;
    $<HTMLButtonElement>('mcp-run').disabled = false;
    showTool();
    setMcpStatus(`${mcpTools.size} read-only tools ready`, 'ok');
  } catch (err) {
    setMcpStatus(`Could not load tools: ${err instanceof Error ? err.message : String(err)}. Reload to retry.`, 'err');
  }
}
$('mcp-tool').addEventListener('change', showTool);
$('mcp-form').addEventListener('submit', async () => {
  const run = $<HTMLButtonElement>('mcp-run');
  const out = $('mcp-out');
  let args: unknown;
  try {
    args = JSON.parse($<HTMLTextAreaElement>('mcp-args').value || '{}');
  } catch {
    setMcpStatus('Arguments are not valid JSON.', 'err');
    return;
  }
  run.disabled = true;
  setMcpStatus('Calling tools/call', 'wait');
  out.textContent = '';
  try {
    const result = await rpc('tools/call', { name: $<HTMLSelectElement>('mcp-tool').value, arguments: args });
    const text = (result.content as { text: string }[]).map((c) => c.text).join('\n');
    out.textContent = text;
    setMcpStatus(result.isError ? 'Tool reported an error (see output)' : 'Done', result.isError ? 'err' : 'ok');
  } catch (err) {
    out.textContent = err instanceof Error ? err.message : String(err);
    setMcpStatus('Request failed', 'err');
  } finally {
    run.disabled = false;
  }
});
loadMcp();
