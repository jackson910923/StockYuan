// StockYuan v6 — App 啟動、路由、全域列
import { $, $$, bus, dirOf, fmtPct, fmtPrice, html, mdOf, setHTML, tpeTime } from './util.js';
import * as store from './store.js';
import { IDX, R, checkReportUpdate, liveState, loadReport, nameOf, phaseNow, refreshQuotes, startLive } from './api.js';
import { applyTheme, closePalette, closeSheet, emptyState, enablePullToRefresh, icon, IMG, openPalette, paintQuotes, pillEl, priceEl, toast } from './ui.js';
import { marketView, moreView, newsView, openImportSheet, screenerView, watchView } from './views.js';
import { stockView } from './stock.js';

const VERSION = '6.0.0';
const TABS = ['market', 'watch', 'screener', 'news', 'more'];
const TITLES = { market: '市場總覽', watch: '我的自選', screener: 'AI 選股器', news: '財經新聞', more: '設定與更多' };
const VIEWS = {
  market: marketView,
  watch: watchView,
  screener: screenerView,
  news: newsView,
  more: (root, r) => moreView(root, { ...r, version: VERSION }),
  stock: stockView,
};

let current = null;
let currentKey = '';
const scrollMem = new Map();
const stack = [];
let replacing = false;

function parseRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || 'market', arg: parts[1] || '', params: new URLSearchParams(qs || ''), key: path || 'market' };
}

export function navigateTab(tab) {
  replacing = true;
  location.replace(`#/${tab}`);
}
function goBack() {
  if (stack.length > 1) history.back();
  else navigateTab('market');
}
bus.on('back', goBack);

function render() {
  const r = parseRoute();
  if (r.name === 'import') {
    const codes = store.parseCodes(r.params.get('wl') || '');
    navigateTab('watch');
    if (codes.length) setTimeout(() => openImportSheet(codes), 300);
    return;
  }
  // 堆疊：判斷是返回還是新頁
  let isBack = false;
  if (replacing) {
    stack[stack.length ? stack.length - 1 : 0] = r.key;
    replacing = false;
  } else if (stack.length > 1 && stack[stack.length - 2] === r.key) {
    stack.pop();
    isBack = true;
  } else if (stack[stack.length - 1] !== r.key) {
    stack.push(r.key);
  }
  if (stack.length > 50) stack.splice(0, stack.length - 50);

  if (current && current.destroy) {
    try { current.destroy(); } catch (e) { console.error(e); }
  }
  if (currentKey) scrollMem.set(currentKey, window.scrollY);
  closePalette();
  closeSheet(true);

  const name = VIEWS[r.name] ? r.name : 'market';
  const root = document.createElement('section');
  root.className = 'view';
  root.id = 'view';
  $('#view').replaceWith(root);
  try {
    current = VIEWS[name](root, r) || {};
  } catch (e) {
    console.error(e);
    current = {};
    setHTML(root, emptyState({ img: IMG.cry, title: '頁面載入發生錯誤', text: String(e && e.message ? e.message : e), actions: html`<button class="btn btn-primary" onclick="location.reload()">重新整理</button>` }));
  }
  currentKey = r.key;
  const tab = name === 'stock' ? null : name;
  $$('[data-tab]').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on && !b.classList.contains('link-btn'));
    if (b.classList.contains('tab') || b.classList.contains('side-link')) b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.title = name === 'stock' ? `${nameOf(r.arg.toUpperCase())} ${r.arg.toUpperCase()}｜StockYuan` : `StockYuan｜${TITLES[name]}`;
  const y = scrollMem.get(r.key);
  const restore = (isBack || name !== 'stock') && y ? y : 0;
  window.scrollTo(0, restore);
  if (restore) requestAnimationFrame(() => window.scrollTo(0, restore));
  renderSideWatch();
}

/* ---------- 頂部列：指數、交易狀態 ---------- */
function renderTopbar() {
  const ph = phaseNow();
  const phEl = $('[data-phase]');
  if (phEl) {
    phEl.className = `phase ${ph.key}`;
    phEl.textContent = ph.label;
    phEl.title = liveState.lastAt ? `報價更新 ${tpeTime(liveState.lastAt, true)}` : '';
  }
  const tk = $('[data-tickers]');
  if (tk) {
    setHTML(tk, html`${[['TSE01', '加權'], ['OTC01', '櫃買']].map(([c, l]) => {
      const q = IDX[c];
      if (!q) return '';
      const d = dirOf(q.change);
      return html`<span class="tk"><span class="tk-n">${l}</span><span class="tk-p num ${d}">${fmtPrice(q.price)}</span><span class="tk-c num ${d}">${fmtPct(q.pct)}</span></span>`;
    })}`);
  }
}

/* ---------- 桌機側欄：自選即時 ---------- */
function renderSideWatch() {
  const box = $('[data-side-wl]');
  const codes = store.watchCodes();
  $$('[data-wl-count]').forEach(el => { el.textContent = codes.length || ''; });
  const badge = $('[data-wl-badge]');
  if (badge) badge.classList.add('hidden');
  if (!box || !matchMedia('(min-width: 1024px)').matches) return;
  const active = parseRoute().name === 'stock' ? parseRoute().arg.toUpperCase() : '';
  setHTML(box, codes.length ? html`${codes.slice(0, 40).map(c => html`<div class="row ${c === active ? 'active' : ''}" data-open="${c}"><div class="row-main"><div class="row-name"><span>${nameOf(c)}</span></div><div class="row-sub"><span class="code">${c}</span></div></div><div class="row-right" style="flex-direction:column;align-items:flex-end;gap:3px">${priceEl(c, 'row-price')}${pillEl(c, 'pct', 'sm')}</div></div>`)}` : html`<div class="muted" style="font-size:12.5px;padding:6px 10px">尚無自選股，點右上搜尋加入。</div>`);
  renderSideFoot();
}
function renderSideFoot() {
  const foot = $('[data-side-foot]');
  if (foot) setHTML(foot, html`AI 報告 ${mdOf(R.asOf)} 盤後<br/>${liveState.lastAt ? `報價 ${tpeTime(liveState.lastAt, true)}` : '報價連線中…'}・v${VERSION}`);
}

/* ---------- 全域更新 ---------- */
let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const btn = $('[data-refresh-all]');
  btn && btn.classList.add('spin');
  try {
    const [q] = await Promise.all([refreshQuotes({ all: true }), checkReportUpdate()]);
    current && current.refresh && (await current.refresh());
    toast(q && q.ok ? `已更新・${tpeTime(Date.now(), true)}` : '報價來源暫時無法連線，稍後再試', { type: q && q.ok ? 'success' : 'error', ms: 1800 });
  } finally {
    refreshing = false;
    btn && btn.classList.remove('spin');
  }
}

/* ---------- 全域事件委派 ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) { e.preventDefault(); navigateTab(t.dataset.tab); return; }
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); location.hash = `#/${g.dataset.go}`; return; }
  if (e.target.closest('[data-search]')) { openPalette(); return; }
  if (e.target.closest('[data-refresh-all]')) { refreshAll(); return; }
  if (e.target.closest('[data-toggle-theme]')) {
    const cur = document.documentElement.dataset.theme;
    store.setSetting('theme', cur === 'dark' ? 'light' : 'dark');
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest('[role="button"][data-open], .heat-tile[data-open]');
  if (t) { e.preventDefault(); t.click(); }
});

bus.on('quotes', ({ changed } = {}) => {
  renderTopbar();
  if (current && current.onQuotes) {
    try { current.onQuotes(changed); } catch (e) { console.error(e); }
  } else paintQuotes(changed);
  const box = $('[data-side-wl]');
  if (box && !box.children.length && matchMedia('(min-width: 1024px)').matches) renderSideWatch();
  else renderSideFoot();
});
bus.on('phase', renderTopbar);
bus.on('watchlist', renderSideWatch);
bus.on('settings', k => {
  if (k === 'theme' || k === 'colors' || k === 'easy') applyTheme();
});
bus.on('report', () => {
  toast(`AI 報告已更新：${mdOf(R.asOf)} 盤後（${R.generatedAt.slice(11, 16)}）`, { type: 'success', ms: 3200 });
  if (current && current.onReport) current.onReport();
  renderSideWatch();
});
window.addEventListener('online', () => { $('#offline')?.classList.add('hidden'); refreshQuotes(); });
window.addEventListener('offline', () => $('#offline')?.classList.remove('hidden'));
matchMedia('(min-width: 1024px)').addEventListener?.('change', renderSideWatch);

/* ---------- 啟動 ---------- */
function hideSplash() {
  const sp = $('#splash');
  if (!sp) return;
  sp.classList.add('out');
  setTimeout(() => sp.remove(), 400);
}

async function boot() {
  await store.ready;
  applyTheme();
  if (!navigator.onLine) $('#offline')?.classList.remove('hidden');
  try {
    await loadReport();
  } catch (e) {
    console.error('load report failed', e);
    hideSplash();
    setHTML($('#view'), emptyState({ img: IMG.cry, title: '資料載入失敗', text: '請確認網路連線後重新整理。若持續發生，可至「更多」清除快取。', actions: html`<button class="btn btn-primary" onclick="location.reload()">${icon('refresh', 'ic-sm')} 重新整理</button>` }));
    return;
  }
  window.addEventListener('hashchange', render);
  render();
  renderTopbar();
  hideSplash();
  startLive();
  enablePullToRefresh(refreshAll);
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => reg.update().catch(() => {})).catch(() => {});
  });
}
