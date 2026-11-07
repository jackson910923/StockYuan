// StockYuan 共用 UI 元件：圖示、Toast、Sheet、搜尋面板、即時價格綁定、迷你走勢、分數環
import { $, bus, clamp, dirOf, esc, fmtChg, fmtPct, fmtPrice, fmtVol, html, isNum, raw, setHTML } from './util.js';
import { R, px, nameOf, marketOf, searchStocks, Q, LIST_META } from './api.js';
import * as store from './store.js';

export const icon = (name, cls = '') => raw(`<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`);
export const IMG = {
  logo: './assets/img/logo.webp',
  money: './assets/img/m1.webp',
  phone: './assets/img/m2.webp',
  cry: './assets/img/m3.webp',
  anchor: './assets/img/m4.webp',
  save: './assets/img/m5.webp',
  bull: './assets/img/m6.webp',
};

/* ---------- 主題 ---------- */
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const t = store.getSetting('theme');
  const dark = t === 'dark' || (t === 'system' && darkMQ.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.colors = store.getSetting('colors') === 'intl' ? 'intl' : 'tw';
  document.body.classList.toggle('easy', Boolean(store.getSetting('easy')));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#05070c' : '#f3f5fa');
  bus.emit('theme');
}
darkMQ.addEventListener?.('change', () => { if (store.getSetting('theme') === 'system') applyTheme(); });

/* ---------- Toast ---------- */
export function toast(msg, { type = 'info', ms = 2600, action = null } = {}) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  const ic = type === 'error' ? 'alert' : type === 'success' ? 'check' : type === 'star' ? 'star' : 'info';
  setHTML(el, html`${icon(ic)}<span>${msg}</span>${action ? html`<button class="toast-act">${action.label}</button>` : ''}`);
  const dismiss = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 260);
  };
  if (action) el.querySelector('.toast-act').addEventListener('click', () => { action.onClick(); dismiss(); });
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(dismiss, ms);
}

/* ---------- Sheet（手機底部抽屜 / 桌機置中對話框） ---------- */
let sheetState = null;
export function openSheet({ title = '', body = '', wide = false, onClose = null } = {}) {
  closeSheet(true);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  setHTML(
    ov,
    html`<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-grab"></div>
      <header class="sheet-hd"><h3>${title}</h3><button class="btn-icon sm" data-close aria-label="關閉">${icon('x')}</button></header>
      <div class="sheet-body"></div>
    </div>`
  );
  const bodyEl = ov.querySelector('.sheet-body');
  if (body instanceof Node) bodyEl.appendChild(body);
  else setHTML(bodyEl, body);
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-close]')) closeSheet();
  });
  enableSwipeDown(ov.querySelector('.sheet'), () => closeSheet());
  document.body.appendChild(ov);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => ov.classList.add('show'));
  sheetState = { ov, onClose };
  return { root: ov, body: bodyEl, close: () => closeSheet() };
}
export function closeSheet(immediate = false) {
  if (!sheetState) return;
  const { ov, onClose } = sheetState;
  sheetState = null;
  ov.classList.remove('show');
  if (!document.querySelector('.overlay.show')) document.body.classList.remove('modal-open');
  setTimeout(() => ov.remove(), immediate ? 0 : 280);
  onClose && onClose();
}
function enableSwipeDown(sheet, onClose) {
  let y0 = null;
  let dy = 0;
  const grab = sheet.querySelector('.sheet-grab');
  const hd = sheet.querySelector('.sheet-hd');
  const start = e => {
    if (matchMedia('(min-width: 640px)').matches) return;
    y0 = e.touches ? e.touches[0].clientY : e.clientY;
    dy = 0;
    sheet.style.transition = 'none';
  };
  const move = e => {
    if (y0 == null) return;
    dy = Math.max(0, (e.touches ? e.touches[0].clientY : e.clientY) - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (y0 == null) return;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) onClose();
    y0 = null;
  };
  [grab, hd].forEach(el => {
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (paletteState) closePalette();
    else if (sheetState) closeSheet();
  }
});

/* ---------- 即時價格綁定：data-q="代號" data-f="price|chg|pct|pill" ---------- */
export function priceText(code) {
  const p = px(code);
  return p ? fmtPrice(p.price) : '--';
}
export function pillText(p, mode = 'pct') {
  if (!p) return '--';
  if (mode === 'chg') return fmtChg(p.change, p.price);
  if (mode === 'vol') return isNum(p.vol) ? fmtVol(p.vol) : '--';
  return fmtPct(p.pct);
}
export function priceEl(code, cls = '') {
  const p = px(code);
  return html`<span class="num ${dirOf(p && p.change)} ${cls}" data-q="${code}" data-f="price">${p ? fmtPrice(p.price) : '--'}</span>`;
}
export function chgEl(code, f = 'pct', cls = '') {
  const p = px(code);
  const txt = !p ? '--' : f === 'chg' ? fmtChg(p.change, p.price) : f === 'both' ? `${fmtChg(p.change, p.price)}  ${fmtPct(p.pct)}` : fmtPct(p.pct);
  return html`<span class="num ${dirOf(p && p.change)} ${cls}" data-q="${code}" data-f="${f}">${txt}</span>`;
}
export function pillEl(code, mode = 'pct', cls = '') {
  const p = px(code);
  return html`<span class="pill ${dirOf(p && p.change)} ${cls}" data-q="${code}" data-f="pill" data-mode="${mode}">${pillText(p, mode)}</span>`;
}
export function paintQuotes(codes = null) {
  const only = codes ? new Set(codes) : null;
  document.querySelectorAll('[data-q]').forEach(el => {
    const code = el.dataset.q;
    if (only && !only.has(code)) return;
    const p = px(code);
    if (!p) return;
    const f = el.dataset.f;
    let txt;
    if (f === 'price') txt = fmtPrice(p.price);
    else if (f === 'chg') txt = fmtChg(p.change, p.price);
    else if (f === 'pct') txt = fmtPct(p.pct);
    else if (f === 'both') txt = `${fmtChg(p.change, p.price)}  ${fmtPct(p.pct)}`;
    else if (f === 'pill') txt = pillText(p, el.dataset.mode);
    else return;
    const d = dirOf(p.change);
    const changed = el.textContent !== txt;
    if (changed) el.textContent = txt;
    el.classList.remove('up', 'down', 'flat');
    el.classList.add(d);
    if (changed && only) {
      const cls = f === 'pill' ? 'flash' : 'flash';
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }
  });
}

/* ---------- 迷你走勢（SVG） ---------- */
export function sparkSVG(values, { w = 76, h = 30, base = null, cls = '' } = {}) {
  const vals = (values || []).filter(isNum);
  if (vals.length < 2) return raw('');
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (isNum(base)) { min = Math.min(min, base); max = Math.max(max, base); }
  const span = max - min || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L${w} ${h} L0 ${h} Z`;
  const by = isNum(base) ? (h - 2 - ((base - min) / span) * (h - 4)).toFixed(1) : null;
  return raw(
    `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">` +
      `<path class="spark-area" d="${area}"/>` +
      (by != null ? `<line class="spark-base" x1="0" x2="${w}" y1="${by}" y2="${by}"/>` : '') +
      `<path class="spark-line" d="${d}"/></svg>`
  );
}
export function sparkFor(code, n = 30) {
  const k = R.klines[code];
  if (!k || k.length < 5) return raw('');
  const closes = k.slice(-n).map(b => b.close);
  const q = Q[code];
  if (q && q.date && k[k.length - 1].time < q.date) closes.push(q.price);
  else if (q) closes[closes.length - 1] = q.price;
  const d = dirOf(closes[closes.length - 1] - closes[0]);
  return html`<span class="row-spark ${d}">${sparkSVG(closes)}</span>`;
}

/* ---------- 分數環、計量條 ---------- */
export function ring(value, { size = 50, stroke = 5, tone = 'brand', label = null } = {}) {
  const v = clamp(Number(value) || 0, 0, 100);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  return raw(
    `<svg class="ring ring-${tone}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || '')} ${Math.round(v)} 分">` +
      `<circle class="ring-bg" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"/>` +
      `<circle class="ring-fg" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v / 100)).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>` +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central">${Math.round(v)}</text></svg>`
  );
}
export const meter = (v, tone = '') => html`<div class="meter ${tone}"><i style="width:${clamp(Number(v) || 0, 0, 100)}%"></i></div>`;
export const lightOf = s => (s && s.verdict && s.verdict.easy_light) || 'YELLOW';

/* ---------- 空狀態 / 骨架 ---------- */
export function emptyState({ img = IMG.phone, title = '', text = '', actions = '' } = {}) {
  return html`<div class="empty">${img ? html`<img src="${img}" alt="" loading="lazy" />` : ''}<div class="empty-title">${title}</div><div class="empty-text">${text}</div>${actions ? html`<div class="hstack wrap">${actions}</div>` : ''}</div>`;
}
export function skeletonRows(n = 6) {
  return html`${Array.from({ length: n }, () => html`<div class="row" aria-hidden="true"><div class="row-main"><span class="skel" style="width:42%;height:15px"></span><span class="skel" style="width:26%;height:11px;margin-top:6px"></span></div><span class="skel" style="width:54px;height:16px"></span><span class="skel" style="width:74px;height:28px;border-radius:9px"></span></div>`)}`;
}

/* ---------- 星號（自選）按鈕 ---------- */
export function starBtn(code, cls = '') {
  const on = store.isWatched(code);
  return html`<button class="btn-icon star-btn ${on ? 'on' : ''} ${cls}" data-star="${code}" aria-pressed="${on}" aria-label="${on ? '移出自選' : '加入自選'}" title="${on ? '移出自選' : '加入自選'}">${icon('star')}</button>`;
}
export function toggleStar(code, btn = null) {
  const prevIdx = store.watchCodes().indexOf(code);
  const added = store.toggleWatch(code);
  const name = nameOf(code);
  toast(added ? `已加入自選：${name} ${code}` : `已移出自選：${name}`, {
    type: added ? 'star' : 'info',
    action: added ? null : { label: '復原', onClick: () => { store.insertWatch(code, prevIdx); syncStars(code); } },
  });
  if (navigator.vibrate) try { navigator.vibrate(added ? 12 : 6); } catch (e) { /* ignore */ }
  syncStars(code, added);
  return added;
}
function syncStars(code, pop = false) {
  const on = store.isWatched(code);
  document.querySelectorAll(`[data-star="${code}"]`).forEach(b => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? '移出自選' : '加入自選');
    if (pop && on) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  });
}
// 全域委派：任何 data-star 按鈕
document.addEventListener('click', e => {
  const b = e.target.closest('[data-star]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  toggleStar(b.dataset.star, b);
}, true);

/* ---------- 搜尋面板（⌘K / 搜尋鍵） ---------- */
let paletteState = null;
export function openPalette({ onPick = null, title = '搜尋台股' } = {}) {
  if (paletteState) return;
  const ov = document.createElement('div');
  ov.className = 'overlay palette-ov';
  setHTML(
    ov,
    html`<div class="palette" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="palette-hd">
        <div class="search-wrap">${icon('search')}<input class="input" type="search" inputmode="search" enterkeyhint="go" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入代號或股名，例如 2330、台積電、0050" aria-label="搜尋股票" /></div>
        <button class="btn btn-ghost" data-close>取消</button>
      </div>
      <div class="palette-body" role="listbox"></div>
    </div>`
  );
  const input = ov.querySelector('input');
  const body = ov.querySelector('.palette-body');
  let items = [];
  let sel = 0;
  const pick = code => {
    if (!code) return;
    store.addRecent(code);
    closePalette();
    if (onPick) onPick(code);
    else location.hash = `#/stock/${code}`;
  };
  const rowHTML = (code, i) => {
    const p = px(code);
    const s = R.stocks[code];
    return html`<div class="row ${i === sel ? 'sel' : ''}" role="option" data-pick="${code}" data-i="${i}">
      <div class="row-main"><div class="row-name"><span>${nameOf(code)}</span>${s ? html`<span class="badge brand">AI ${Math.round(s.total_score)}</span>` : ''}</div>
      <div class="row-sub"><span class="code">${code}</span><span>${marketOf(code)}</span></div></div>
      <span class="row-price ${dirOf(p && p.change)}">${p ? fmtPrice(p.price) : ''}</span>
      <div class="row-actions">${p ? html`<span class="pill sm ${dirOf(p.change)}">${fmtPct(p.pct)}</span>` : ''}${starBtn(code, 'sm')}</div>
    </div>`;
  };
  const renderList = () => {
    const q = input.value.trim();
    if (!q) {
      const recent = store.recentCodes().filter(c => R.dir[c] || R.stocks[c]);
      const hot = [...new Set([...(R.lists.top || []).slice(0, 5), ...(R.lists.hot || []).slice(0, 5)])].filter(c => !recent.includes(c)).slice(0, 8);
      items = [...recent, ...hot];
      sel = Math.min(sel, Math.max(0, items.length - 1));
      setHTML(
        body,
        html`${recent.length ? html`<div class="palette-sec"><span>最近搜尋</span><button class="link-btn" data-clear-recent>清除</button></div>${recent.map((c, i) => rowHTML(c, i))}` : ''}
        <div class="palette-sec"><span>AI 熱門標的</span><span class="desktop-only"><kbd>↑</kbd> <kbd>↓</kbd> 選擇　<kbd>Enter</kbd> 開啟</span></div>${hot.map((c, i) => rowHTML(c, recent.length + i))}`
      );
      return;
    }
    const res = searchStocks(q, 40);
    items = res.map(e => e.code);
    sel = 0;
    if (!items.length && /^[0-9]{4,6}[A-Z]?$/i.test(q)) items = [q.toUpperCase()];
    setHTML(body, items.length ? html`<div class="palette-sec"><span>搜尋結果</span><span>${items.length} 檔</span></div>${items.map((c, i) => rowHTML(c, i))}` : emptyState({ img: IMG.cry, title: '找不到符合的股票', text: '請輸入 4～6 碼代號（如 2330、00878）或中文股名。' }));
  };
  const highlight = () => {
    body.querySelectorAll('.row').forEach(r => r.classList.toggle('sel', Number(r.dataset.i) === sel));
    body.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', renderList);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(items[sel]); e.preventDefault(); }
  });
  body.addEventListener('click', e => {
    if (e.target.closest('[data-star]')) return;
    if (e.target.closest('[data-clear-recent]')) { store.clearRecent(); renderList(); return; }
    const r = e.target.closest('[data-pick]');
    if (r) pick(r.dataset.pick);
  });
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) closePalette(); });
  document.body.appendChild(ov);
  document.body.classList.add('modal-open');
  renderList();
  requestAnimationFrame(() => { ov.classList.add('show'); input.focus({ preventScroll: true }); });
  paletteState = { ov };
}
export function closePalette() {
  if (!paletteState) return;
  const { ov } = paletteState;
  paletteState = null;
  ov.classList.remove('show');
  if (!document.querySelector('.overlay.show')) document.body.classList.remove('modal-open');
  setTimeout(() => ov.remove(), 240);
}
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
    e.preventDefault();
    paletteState ? closePalette() : openPalette();
  }
});

/* ---------- 下拉刷新（觸控裝置） ---------- */
export function enablePullToRefresh(onRefresh) {
  const ptr = $('#ptr');
  if (!ptr || !matchMedia('(hover: none)').matches) return;
  let y0 = null;
  let dist = 0;
  let busy = false;
  window.addEventListener('touchstart', e => {
    if (busy || window.scrollY > 0 || document.body.classList.contains('modal-open')) return;
    y0 = e.touches[0].clientY;
    dist = 0;
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dist = e.touches[0].clientY - y0;
    if (dist <= 0) { ptr.classList.remove('on'); return; }
    const d = Math.min(90, dist * 0.5);
    ptr.classList.add('on');
    ptr.style.transform = `translateY(${d - 50}px) rotate(${d * 4}deg)`;
  }, { passive: true });
  window.addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    if (dist * 0.5 < 62) { ptr.classList.remove('on'); ptr.style.transform = ''; return; }
    busy = true;
    ptr.classList.add('loading');
    ptr.style.transform = 'translateY(14px)';
    try { await onRefresh(); } finally {
      busy = false;
      ptr.classList.remove('loading', 'on');
      ptr.style.transform = '';
    }
  });
}

/* ---------- 區塊標題 ---------- */
export const sectionHd = (title, sub = '', right = '') =>
  html`<div class="section-hd"><div><div class="section-title">${title}</div>${sub ? html`<div class="section-sub">${sub}</div>` : ''}</div>${right}</div>`;

export const toneIcon = { brand: 'sparkles', gold: 'bolt', cyan: 'waves', green: 'tree', sky: 'gem', teal: 'scale', amber: 'coin', violet: 'bear' };
export const listIcon = key => toneIcon[(LIST_META[key] || {}).tone] || 'sparkles';
