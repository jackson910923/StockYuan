// StockYuan 主要分頁：市場、自選、選股、新聞、更多
import { $, $$, bus, copyText, dirOf, fmtInt, fmtLots, fmtPct, fmtPrice, fmtVol, fmtYi, html, isNum, mdOf, raw, relTime, setHTML, tpeTime, weekdayOf, debounce } from './util.js';
import { R, Q, IDX, LIST_META, NEWS_CATS, dirEntry, fetchDaily, fetchHeadlines, fetchIntraday, liveState, marketOf, nameOf, phaseNow, px, relatedStocks, refreshQuotes, setInterest } from './api.js';
import { IMG, chgEl, emptyState, icon, lightOf, openPalette, openSheet, closeSheet, paintQuotes, pillEl, priceEl, ring, sectionHd, skeletonRows, sparkFor, sparkSVG, starBtn, toast, listIcon } from './ui.js';
import * as store from './store.js';

export const openStock = (code, mode) => { location.hash = `#/stock/${code}${mode ? `?mode=${mode}` : ''}`; };
const DISCLAIMER = html`<p class="disclaimer">StockYuan 內容由程式依公開資料（證交所、櫃買中心、鉅亨網等）自動產生，僅供研究參考，不構成任何投資建議；投資有風險，請自行審慎評估並嚴設停損。</p>`;

/* =====================================================================
 * 新聞列（共用）
 * ===================================================================== */
export function newsItem(n, { compact = false, showTags = true } = {}) {
  const fresh = Date.now() - n.ts < 30 * 60e3;
  const tags = showTags ? relatedStocks(`${n.title} ${(n.tags || []).join(' ')}`, 3, n.stocks || []) : [];
  return html`<article class="news-item">
    <a class="news-link" href="${n.link}" target="_blank" rel="noopener noreferrer">
      <div class="news-text">
        <div class="news-title clamp2">${n.title}</div>
        ${!compact && n.summary ? html`<div class="news-sum clamp2">${n.summary}</div>` : ''}
        <div class="news-meta"><span class="src">${n.source}</span><span>·</span><span data-ts="${n.ts}">${relTime(n.ts)}</span>${fresh ? html`<span class="new">NEW</span>` : ''}</div>
      </div>
      ${!compact && n.image ? html`<img class="news-thumb" src="${n.image}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}
    </a>
    ${tags.length ? html`<div class="news-tags">${tags.map(c => {
      const p = px(c);
      return html`<button class="stock-tag" data-open="${c}">${nameOf(c)} ${p ? html`<span class="num ${dirOf(p.change)}" data-q="${c}" data-f="pct">${fmtPct(p.pct)}</span>` : ''}</button>`;
    })}</div>` : ''}
  </article>`;
}
function refreshRelTimes(root) {
  $$('[data-ts]', root).forEach(el => { el.textContent = relTime(Number(el.dataset.ts)); });
}
// 全域：data-open="代號" → 開啟個股
document.addEventListener('click', e => {
  const t = e.target.closest('[data-open]');
  if (!t || e.target.closest('[data-star]')) return;
  e.preventDefault();
  openStock(t.dataset.open, t.dataset.mode);
});

/* =====================================================================
 * 市場
 * ===================================================================== */
const PICK_GROUPS = ['top', 'short_term', 'swing', 'long_term', 'high', 'mid', 'low', 'short_sell'];
const IDX_SPARK = {};
function idxCardHTML(code, label) {
  const q = IDX[code];
  if (!q) return html`<div class="card idx-card" data-idx="${code}"><div class="idx-name">${label}</div><span class="skel" style="width:70%;height:24px;margin-top:4px"></span><span class="skel" style="width:45%;height:13px;margin-top:6px"></span><div class="idx-spark" data-idx-spark="${code}">${raw(IDX_SPARK[code] || '')}</div></div>`;
  const d = dirOf(q.change);
  return html`<div class="card idx-card" data-idx="${code}">
    <div class="idx-name"><span>${label}</span><span class="muted num" style="font-weight:600">${q.ts ? tpeTime(q.ts) : ''}</span></div>
    <div class="idx-price num ${d}">${fmtPrice(q.price)}</div>
    <div class="idx-chg num ${d}">${q.change > 0 ? '▲' : q.change < 0 ? '▼' : ''} ${fmtPrice(Math.abs(q.change))}（${fmtPct(q.pct)}）</div>
    <div class="idx-spark ${d}" data-idx-spark="${code}">${raw(IDX_SPARK[code] || '')}</div>
  </div>`;
}
async function loadIdxSpark(root, code) {
  try {
    const r = await fetchIntraday(code, true);
    if (!r || !r.points.length) return;
    const pts = r.points;
    const step = Math.max(1, Math.floor(pts.length / 90));
    const vals = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => p.c);
    const prev = (IDX[code] && IDX[code].prev) || (r.quote && r.quote.prev);
    IDX_SPARK[code] = String(sparkSVG(vals, { w: 200, h: 44, base: prev }));
    const el = root.querySelector(`[data-idx-spark="${code}"]`);
    if (el) setHTML(el, raw(IDX_SPARK[code]));
  } catch (e) { /* ignore */ }
}
function regimeHTML() {
  const s = R.summary || {};
  const up = s.up_count || 0;
  const dn = s.down_count || 0;
  const fl = s.flat_count || 0;
  const tot = Math.max(1, up + dn + fl);
  const avg = Number(s.avg_return_pct) || 0;
  const img = avg <= -0.8 ? IMG.save : avg >= 0.6 ? IMG.bull : IMG.anchor;
  return html`<div class="card regime-card">
    <div>
      <div class="regime-label">${icon('activity', 'ic-xs')} AI 市場格局 · ${mdOf(R.asOf)}（${weekdayOf(R.asOf)}）</div>
      <div class="regime-text">${s.regime || '震盪選股盤'}</div>
      <div class="breadth" role="img" aria-label="上漲 ${up} 家、平盤 ${fl} 家、下跌 ${dn} 家"><i class="b-up" style="width:${(up / tot) * 100}%"></i><i class="b-flat" style="width:${(fl / tot) * 100}%"></i><i class="b-down" style="width:${(dn / tot) * 100}%"></i></div>
      <div class="breadth-legend"><span>上漲 <b class="up">${fmtInt(up)}</b></span><span>平盤 <b>${fmtInt(fl)}</b></span><span>下跌 <b class="down">${fmtInt(dn)}</b></span><span>平均 <b class="${dirOf(avg)}">${fmtPct(avg)}</b></span></div>
    </div>
    <img src="${img}" alt="" />
  </div>`;
}
function trackHTML() {
  const t = R.track;
  if (!t || !t.groups || !Object.keys(t.groups).length) return '';
  const order = ['top', 'short_term', 'swing', 'long_term', 'short_sell'];
  const mkt = Number(t.market_avg_pct);
  return html`<div class="card track-card">
    <div class="hstack" style="justify-content:space-between">
      <div class="card-title">${icon('award')} AI 昨日精選・今日實績</div>
      <button class="link-btn" data-track>明細 ${icon('chevron-right', 'ic-xs')}</button>
    </div>
    <div class="card-sub" style="margin-top:2px">${mdOf(t.from_date)} 各分類 Top 3 → ${mdOf(t.to_date)} 收盤（昨收→今收平均報酬，做空以下跌計）｜同期全市場平均 <b class="${dirOf(mkt)}">${fmtPct(mkt)}</b></div>
    <div class="track-grid">${order.filter(g => t.groups[g]).map(g => {
      const r = t.groups[g];
      const meta = LIST_META[g];
      return html`<div class="track-cell"><div class="t-name">${meta.label}</div><div class="t-val num ${dirOf(r.avg_ret_pct)}">${fmtPct(r.avg_ret_pct)}</div><div class="t-sub nowrap">勝 ${r.wins}/${r.count}${isNum(mkt) && g !== 'short_sell' ? html`・${r.avg_ret_pct >= mkt ? '贏' : '輸'}大盤` : ''}</div></div>`;
    })}</div>
  </div>`;
}
function openTrackSheet() {
  const t = R.track;
  if (!t) return;
  const order = ['top', 'short_term', 'swing', 'long_term', 'short_sell'];
  const hist = (R.trackHistory || []).slice(-10).reverse();
  openSheet({
    title: `AI 精選實績 ${mdOf(t.from_date)} → ${mdOf(t.to_date)}`,
    wide: true,
    body: html`${order.filter(g => t.groups[g]).map(g => {
      const r = t.groups[g];
      return html`<div class="section-hd" style="margin-top:14px"><div class="section-title" style="font-size:15px">${LIST_META[g].label} <span class="num ${dirOf(r.avg_ret_pct)}">${fmtPct(r.avg_ret_pct)}</span></div><span class="muted">勝 ${r.wins}/${r.count}</span></div>
      <div class="card"><div class="list">${r.items.map(it => html`<div class="row" data-open="${it.code}" data-mode="${LIST_META[g].mode}">
        <div class="row-main"><div class="row-name"><span>${it.name}</span>${it.hit_target ? html`<span class="badge gold">達標</span>` : ''}${it.hit_stop ? html`<span class="badge up">觸停損</span>` : ''}</div><div class="row-sub"><span class="code">${it.code}</span><span>${fmtPrice(it.base)} → ${fmtPrice(it.close)}</span></div></div>
        <span></span><span class="pill sm ${dirOf(it.ret_pct)}">${fmtPct(it.ret_pct)}</span></div>`)}</div></div>`;
    })}
    ${hist.length > 1 ? html`<div class="section-hd"><div class="section-title" style="font-size:15px">近期每日實績</div></div><div class="card"><div class="list">${hist.map(h => html`<div class="row" style="cursor:default"><div class="row-main"><div class="row-name"><span>${mdOf(h.from_date)} → ${mdOf(h.to_date)}</span></div></div><span></span><div class="hstack wrap" style="justify-content:flex-end">${order.filter(g => h.groups[g]).map(g => html`<span class="badge ${dirOf(h.groups[g].avg_ret_pct)}">${LIST_META[g].short} ${fmtPct(h.groups[g].avg_ret_pct)}</span>`)}</div></div>`)}</div></div>` : ''}
    <p class="disclaimer">實績以「前一交易日 AI 收盤後選出的 Top 3」在「隔日收盤」的漲跌計算，未含交易成本與滑價，過去表現不代表未來報酬。</p>`,
  });
}
function pickCardHTML(key) {
  const meta = LIST_META[key];
  const codes = (R.lists[key] || []).slice(0, 3);
  if (!codes.length) return '';
  const isShort = key === 'short_sell';
  return html`<div class="card pick-card">
    <div class="pick-hd"><div class="pick-ic ${meta.tone}">${icon(listIcon(key))}</div><div class="grow"><div class="pick-title">${meta.label} Top 3</div><div class="pick-desc ellipsis">${meta.desc}</div></div><button class="btn-icon sm" data-screener="${key}" aria-label="查看全部${meta.label}">${icon('chevron-right')}</button></div>
    ${codes.map((c, i) => {
      const s = R.stocks[c];
      const plan = isShort ? s.short_sell_plan || {} : (s.horizon_plans && s.horizon_plans[meta.mode]) || s.price_plan || {};
      const sc = s[meta.score] ?? s.total_score;
      return html`<div class="pick-row" data-open="${c}" data-mode="${meta.mode}">
        <span class="medal m${i + 1}">${i + 1}</span>
        <div class="row-main"><div class="pick-name"><span class="ellipsis">${s.name}</span><span class="code">${c}</span></div>
          <div class="pick-plan">${isShort ? '空點' : '買區'} <b class="num">${fmtPrice(plan.entry_low)}～${fmtPrice(plan.entry_high)}</b>・${isShort ? '回補' : '停損'} <b class="num">${fmtPrice(plan.stop_loss)}</b></div></div>
        <div class="pick-right">${priceEl(c, 'pick-price')}${chgEl(c, 'pct', 'pick-pct')}<span class="pick-score">${Math.round(sc)} 分</span></div>
      </div>`;
    })}
  </div>`;
}
function heatHTML(sec) {
  const v = Number(sec.avg_change_pct) || 0;
  const lv = Math.abs(v) < 0.5 ? 1 : Math.abs(v) < 1.5 ? 2 : Math.abs(v) < 3 ? 3 : 4;
  return html`<div class="heat-tile ${v >= 0 ? 'h-up' : 'h-dn'}${lv}" data-open="${sec.leader_code}" role="button" tabindex="0">
    <div class="heat-name">${sec.sector}</div>
    <div class="heat-val ${dirOf(v)}">${fmtPct(v)}</div>
    <div class="heat-sub">法人 3 日 ${fmtYi(Number(sec.inst_flow_yi))}・${sec.stock_count} 檔</div>
    <div class="heat-sub">領漲 ${String(sec.leader_name || '').replace(/\*+$/, '')}</div>
  </div>`;
}

export function marketView(root) {
  let showAllSectors = false;
  const paint = () => {
    const sectors = R.sectors || [];
    setHTML(root, html`<div class="mkt-layout">
      <div class="mkt-main">
        <div class="mkt-top">${idxCardHTML('TSE01', '加權指數')}${idxCardHTML('OTC01', '櫃買指數')}${regimeHTML()}</div>
        ${trackHTML() ? html`<div style="margin-top:12px">${trackHTML()}</div>` : ''}
        ${sectionHd(html`${icon('sparkles')} AI 今日精選`, `六大 Agent 委員會 ${mdOf(R.asOf)} 盤後評分・點選可看完整策略`, html`<button class="link-btn" data-go="screener">選股器 ${icon('chevron-right', 'ic-xs')}</button>`)}
        <div class="picks-scroller">${PICK_GROUPS.map(pickCardHTML)}</div>
        ${sectionHd(html`${icon('flame')} 產業資金熱力圖`, '族群平均漲跌 × 三大法人近 3 日資金流向・點選看領漲股')}
        <div class="heat-grid">${(showAllSectors ? sectors : sectors.slice(0, 12)).map(heatHTML)}</div>
        ${sectors.length > 12 ? html`<div style="text-align:center;margin-top:10px"><button class="btn btn-sm" data-sectors>${showAllSectors ? '收合' : `顯示全部 ${sectors.length} 個族群`}</button></div>` : ''}
      </div>
      <aside class="mkt-side">
        ${sectionHd(html`${icon('news')} 即時焦點`, '鉅亨網即時新聞・每 2 分鐘更新', html`<button class="link-btn" data-go="news">全部 ${icon('chevron-right', 'ic-xs')}</button>`)}
        <div class="card"><div class="news-list" id="mktNews">${skeletonRows(5)}</div></div>
        ${R.briefing ? html`<div class="card card-pad" style="margin-top:12px"><div class="hstack" style="justify-content:space-between"><div class="card-title">${icon('message')} LINE 投研日報</div><button class="btn btn-sm" data-copy-brief>${icon('copy', 'ic-sm')} 複製</button></div><div class="card-sub" style="margin-top:6px">一鍵複製今日各分類 Top 3 與買賣點，貼到 LINE 群組分享。</div></div>` : ''}
      </aside>
    </div>${DISCLAIMER}`);
    loadIdxSpark(root, 'TSE01');
    loadIdxSpark(root, 'OTC01');
    loadNews();
  };
  const loadNews = async () => {
    const box = root.querySelector('#mktNews');
    try {
      const list = await fetchHeadlines('all');
      if (!box.isConnected) return;
      setHTML(box, list.length ? html`${list.slice(0, 8).map(n => newsItem(n, { compact: true }))}` : emptyState({ img: IMG.anchor, title: '暫時沒有新聞', text: '新聞來源連線中，稍後再試。' }));
    } catch (e) {
      setHTML(box, html`${R.headlines.slice(0, 8).map(n => newsItem(n, { compact: true }))}`);
    }
  };
  root.addEventListener('click', e => {
    if (e.target.closest('[data-sectors]')) { showAllSectors = !showAllSectors; paint(); return; }
    if (e.target.closest('[data-track]')) { openTrackSheet(); return; }
    const sc = e.target.closest('[data-screener]');
    if (sc) { store.setSetting('screenerTab', sc.dataset.screener === 'high' || sc.dataset.screener === 'mid' || sc.dataset.screener === 'low' ? 'top' : sc.dataset.screener); if (['high', 'mid', 'low'].includes(sc.dataset.screener)) store.setSetting('screenerTier', { high: 'HIGH_200_PLUS', mid: 'MID_50_200', low: 'LOW_UNDER_50' }[sc.dataset.screener]); location.hash = '#/screener'; return; }
    if (e.target.closest('[data-copy-brief]')) copyText(R.briefing).then(ok => toast(ok ? '已複製 LINE 投研日報，可直接貼上分享' : '複製失敗，請長按文字手動複製', { type: ok ? 'success' : 'error' }));
  });
  const codes = new Set();
  PICK_GROUPS.forEach(k => (R.lists[k] || []).slice(0, 3).forEach(c => codes.add(c)));
  setInterest([...codes]);
  paint();
  let lastSpark = Date.now();
  const timer = setInterval(() => { refreshRelTimes(root); if (document.visibilityState === 'visible') loadNews(); }, 120e3);
  return {
    onQuotes(changed) {
      ['TSE01', 'OTC01'].forEach(code => {
        const el = root.querySelector(`[data-idx="${code}"]`);
        if (!el || !IDX[code]) return;
        const tmp = document.createElement('div');
        setHTML(tmp, idxCardHTML(code, code === 'TSE01' ? '加權指數' : '櫃買指數'));
        el.replaceWith(tmp.firstElementChild);
      });
      if (Date.now() - lastSpark > 60e3 && phaseNow().live) {
        lastSpark = Date.now();
        loadIdxSpark(root, 'TSE01');
        loadIdxSpark(root, 'OTC01');
      }
      paintQuotes(changed);
    },
    onReport: paint,
    destroy() { clearInterval(timer); },
  };
}

/* =====================================================================
 * 自選
 * ===================================================================== */
const SPARK_CACHE = new Map();
async function ensureSparks(root, codes) {
  const need = codes.filter(c => !(R.klines[c] && R.klines[c].length >= 5) && !SPARK_CACHE.has(c)).slice(0, 40);
  for (let i = 0; i < need.length; i += 4) {
    await Promise.all(need.slice(i, i + 4).map(async c => {
      try {
        const bars = await fetchDaily(c, 60);
        SPARK_CACHE.set(c, bars.slice(-30).map(b => b.close));
      } catch (e) { SPARK_CACHE.set(c, []); }
      const el = root.querySelector(`[data-spark="${c}"]`);
      if (el) setHTML(el, sparkOf(c));
    }));
  }
}
function sparkOf(code) {
  if (R.klines[code] && R.klines[code].length >= 5) return sparkFor(code);
  const closes = (SPARK_CACHE.get(code) || []).slice();
  if (closes.length < 5) return raw('');
  const q = Q[code];
  if (q) closes[closes.length - 1] = q.price;
  return html`<span class="row-spark ${dirOf(closes[closes.length - 1] - closes[0])}">${sparkSVG(closes)}</span>`;
}
const WL_SORTS = [
  ['custom', '自訂排序'],
  ['pct_desc', '漲幅大→小'],
  ['pct_asc', '跌幅大→小'],
  ['score', 'AI 綜合分'],
  ['code', '代號'],
];
function sortedWatch() {
  const codes = [...store.watchCodes()];
  const sort = store.getSetting('wlSort');
  const pct = c => (px(c) ? px(c).pct : -999);
  if (sort === 'pct_desc') codes.sort((a, b) => pct(b) - pct(a));
  else if (sort === 'pct_asc') codes.sort((a, b) => pct(a) - pct(b));
  else if (sort === 'score') codes.sort((a, b) => (R.stocks[b]?.total_score ?? -1) - (R.stocks[a]?.total_score ?? -1));
  else if (sort === 'code') codes.sort();
  return codes;
}
function watchRowHTML(code, editing) {
  const s = R.stocks[code];
  const pos = store.getPosition(code);
  const p = px(code);
  let posBadge = '';
  if (pos && pos.cost > 0 && p) {
    const isLong = pos.direction !== 'SHORT';
    const pnl = Math.round((isLong ? p.price - pos.cost : pos.cost - p.price) * (pos.lots || 1) * 1000);
    posBadge = html`<span class="badge ${dirOf(pnl)}">持倉 ${pnl >= 0 ? '+' : ''}${fmtInt(pnl)}</span>`;
  }
  if (editing) {
    return html`<div class="row editing" data-code="${code}">
      <button class="btn-icon sm drag-handle" aria-label="拖曳排序">${icon('grip')}</button>
      <div class="row-main"><div class="row-name"><span>${nameOf(code)}</span></div><div class="row-sub"><span class="code">${code}</span><span>${marketOf(code)}</span></div></div>
      <div class="row-actions"><button class="btn-icon sm" data-move="-1" aria-label="上移">${icon('chevron-up')}</button><button class="btn-icon sm" data-move="1" aria-label="下移">${icon('chevron-down')}</button><button class="btn-icon sm btn-danger" data-remove aria-label="移除">${icon('trash')}</button></div>
    </div>`;
  }
  return html`<div class="row" data-open="${code}" data-code="${code}">
    <div class="row-main">
      <div class="row-name"><span>${nameOf(code)}</span>${s ? html`<i class="light ${lightOf(s)}" title="AI 燈號"></i>` : ''}</div>
      <div class="row-sub"><span class="code">${code}</span><span>${marketOf(code)}</span>${s ? html`<span class="badge brand">AI ${Math.round(s.total_score)}</span>` : ''}${posBadge}</div>
    </div>
    <span data-spark="${code}">${sparkOf(code)}</span>
    <div class="row-right">${priceEl(code, 'row-price')}<button class="pill-btn" data-cycle style="border:0;background:none;padding:0">${pillEl(code, store.getSetting('wlPill'))}</button></div>
  </div>`;
}
function enableDrag(listEl, onDrop) {
  listEl.addEventListener('pointerdown', e => {
    const h = e.target.closest('.drag-handle');
    if (!h) return;
    const row = h.closest('.row');
    const rows = $$('.row[data-code]', listEl);
    const idx = rows.indexOf(row);
    const rects = rows.map(r => r.getBoundingClientRect());
    const startY = e.clientY;
    let target = idx;
    row.classList.add('dragging');
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const move = ev => {
      const dy = ev.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      const y = rects[idx].top + rects[idx].height / 2 + dy;
      target = rects.findIndex(r => y < r.bottom);
      if (target < 0) target = rows.length - 1;
      const hgt = rects[idx].height;
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (idx < target && i > idx && i <= target) shift = -hgt;
        if (idx > target && i < idx && i >= target) shift = hgt;
        r.style.transition = 'transform .15s';
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      rows.forEach(r => { r.style.transform = ''; r.style.transition = ''; });
      row.classList.remove('dragging');
      if (target !== idx) onDrop(row.dataset.code, target);
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
    e.preventDefault();
  });
}
export function openShareSheet() {
  const link = store.shareLink();
  const sum = store.storageSummary();
  const sheet = openSheet({
    title: '自選股備份與同步',
    body: html`<div class="stack">
      <div class="lite-note" style="margin:0">${icon('shield', 'ic-sm')}<span>自選股已在本機「三重備份」（localStorage + IndexedDB + Cookie），清除快取也不易遺失。換手機、或在 APP 與瀏覽器之間同步時，複製下方連結到另一台裝置開啟即可一鍵匯入。</span></div>
      <div class="field"><label>我的同步連結（${sum.count} 檔）</label><input class="input" readonly value="${link}" data-link /></div>
      <div class="hstack"><button class="btn btn-primary grow" data-copy>${icon('copy', 'ic-sm')} 複製連結</button>${navigator.share ? html`<button class="btn grow" data-share>${icon('share', 'ic-sm')} 分享</button>` : ''}</div>
      <div class="divider"></div>
      <div class="field"><label>從其他裝置匯入（貼上同步連結或代號，以空白/逗號分隔）</label><textarea class="input" rows="3" style="height:auto;padding:10px 14px" data-import placeholder="例如：2330 2317 0050 或貼上 #/import?wl=… 連結"></textarea></div>
      <div class="hstack"><button class="btn grow" data-merge>合併匯入</button><button class="btn grow btn-danger" data-replace>取代現有清單</button></div>
      <div class="muted" style="font-size:12px">上次儲存：${sum.savedAt ? new Date(sum.savedAt).toLocaleString('zh-TW', { hour12: false }) : '尚未儲存'}</div>
    </div>`,
  });
  const b = sheet.body;
  b.querySelector('[data-copy]').onclick = () => copyText(link).then(ok => toast(ok ? '已複製同步連結' : '複製失敗，請長按手動複製', { type: ok ? 'success' : 'error' }));
  const sh = b.querySelector('[data-share]');
  if (sh) sh.onclick = () => navigator.share({ title: 'StockYuan 自選股', text: '我的 StockYuan 自選股清單', url: link }).catch(() => {});
  const doImport = mode => {
    const txt = b.querySelector('[data-import]').value;
    const m = txt.match(/wl=([^&\s]+)/);
    const codes = store.parseCodes(m ? decodeURIComponent(m[1]) : txt).filter(knownCode);
    if (!codes.length) return toast('沒有找到有效的股票代號', { type: 'error' });
    store.setWatchCodes(codes, mode);
    closeSheet();
    toast(`已${mode === 'merge' ? '合併' : '取代'}匯入 ${codes.length} 檔自選股`, { type: 'success' });
  };
  b.querySelector('[data-merge]').onclick = () => doImport('merge');
  b.querySelector('[data-replace]').onclick = () => doImport('replace');
}
const knownCode = c => Boolean(R.dir[c] || R.stocks[c] || Q[c]);
export function openImportSheet(codes) {
  const valid = codes.filter(knownCode);
  if (!valid.length) return false;
  const sheet = openSheet({
    title: `匯入 ${valid.length} 檔自選股？`,
    body: html`<div class="stack"><div class="hstack wrap">${valid.slice(0, 40).map(c => html`<span class="badge outline">${nameOf(c)} ${c}</span>`)}${valid.length > 40 ? html`<span class="muted">…等 ${valid.length} 檔</span>` : ''}</div>
      <div class="sheet-actions"><button class="btn btn-primary" data-merge>合併到我的自選</button><button class="btn" data-replace>取代我的自選</button></div></div>`,
  });
  sheet.body.querySelector('[data-merge]').onclick = () => { store.setWatchCodes(valid, 'merge'); closeSheet(); toast(`已合併匯入 ${valid.length} 檔`, { type: 'success' }); };
  sheet.body.querySelector('[data-replace]').onclick = () => { store.setWatchCodes(valid, 'replace'); closeSheet(); toast(`已匯入 ${valid.length} 檔自選股`, { type: 'success' }); };
  return true;
}

export function watchView(root) {
  let editing = false;
  const paint = () => {
    const codes = editing ? [...store.watchCodes()] : sortedWatch();
    setInterest(codes);
    const up = codes.filter(c => px(c) && px(c).change > 0).length;
    const dn = codes.filter(c => px(c) && px(c).change < 0).length;
    const sort = store.getSetting('wlSort');
    setHTML(root, html`
      ${sectionHd(html`${icon('star')} 我的自選`, store.watchTouched() ? `${codes.length} 檔・本機三重備份` : `${codes.length} 檔・預設清單（加入或移除後即成為您的專屬清單）`, html`<button class="btn btn-sm btn-primary" data-add>${icon('plus', 'ic-sm')} 新增</button>`)}
      <div class="wl-toolbar">
        <select class="input" data-sort style="height:34px;font-size:13px;width:auto;flex:1;max-width:170px" aria-label="排序方式" ${editing ? 'disabled' : ''}>${WL_SORTS.map(([k, l]) => html`<option value="${k}" ${k === sort ? 'selected' : ''}>${l}</option>`)}</select>
        <div class="grow"></div>
        <button class="btn btn-sm ${editing ? 'btn-primary' : ''}" data-edit>${editing ? html`${icon('check', 'ic-sm')} 完成` : html`${icon('edit', 'ic-sm')} 編輯`}</button>
        <button class="btn btn-sm" data-share-wl aria-label="備份與同步">${icon('link', 'ic-sm')} 同步</button>
      </div>
      ${codes.length && !editing ? html`<div class="wl-summary"><span>上漲 <b class="up">${up}</b></span><span>下跌 <b class="down">${dn}</b></span><span>平盤 <b>${codes.length - up - dn}</b></span><span class="grow"></span><span>點擊漲跌標籤可切換 % / 漲跌 / 成交量</span></div>` : ''}
      <div class="card">${codes.length ? html`<div class="list" data-list>${codes.map(c => watchRowHTML(c, editing))}</div><button class="add-row btn-ghost" style="width:100%;border:0;background:none;text-align:left" data-add>${icon('plus')} 新增自選股</button>` : emptyState({ img: IMG.phone, title: '還沒有自選股', text: '搜尋代號或股名加入自選，盤中即時報價、AI 燈號與持倉損益都會集中在這裡。', actions: html`<button class="btn btn-primary" data-add>${icon('search', 'ic-sm')} 搜尋加入</button><button class="btn" data-add-top>加入 AI 精選 Top 5</button>` })}</div>
      ${DISCLAIMER}`);
    const list = root.querySelector('[data-list]');
    if (list && editing) enableDrag(list, (code, to) => { store.moveWatch(code, to); });
    if (!editing) ensureSparks(root, codes);
  };
  root.addEventListener('click', e => {
    if (e.target.closest('[data-add]')) { openPalette({ title: '新增自選股', onPick: c => { if (store.addWatch(c)) toast(`已加入自選：${nameOf(c)} ${c}`, { type: 'star' }); } }); return; }
    if (e.target.closest('[data-add-top]')) { store.setWatchCodes((R.lists.top || []).slice(0, 5), 'merge'); toast('已加入 AI 精選 Top 5', { type: 'success' }); return; }
    if (e.target.closest('[data-edit]')) { editing = !editing; if (editing) store.setSetting('wlSort', 'custom'); paint(); return; }
    if (e.target.closest('[data-share-wl]')) { openShareSheet(); return; }
    const cyc = e.target.closest('[data-cycle]');
    if (cyc) {
      e.stopPropagation();
      e.preventDefault();
      const modes = ['pct', 'chg', 'vol'];
      store.setSetting('wlPill', modes[(modes.indexOf(store.getSetting('wlPill')) + 1) % modes.length]);
      $$('[data-f="pill"]', root).forEach(el => { el.dataset.mode = store.getSetting('wlPill'); });
      paintQuotes();
      return;
    }
    const row = e.target.closest('.row.editing');
    if (row) {
      const code = row.dataset.code;
      const mv = e.target.closest('[data-move]');
      if (mv) { const i = store.watchCodes().indexOf(code); store.moveWatch(code, i + Number(mv.dataset.move)); return; }
      if (e.target.closest('[data-remove]')) {
        const idx = store.watchCodes().indexOf(code);
        store.removeWatch(code);
        toast(`已移出自選：${nameOf(code)}`, { action: { label: '復原', onClick: () => store.insertWatch(code, idx) } });
      }
    }
  }, true);
  root.addEventListener('change', e => { if (e.target.matches('[data-sort]')) { store.setSetting('wlSort', e.target.value); paint(); } });
  const off = bus.on('watchlist', paint);
  paint();
  return {
    onQuotes(changed) {
      const sort = store.getSetting('wlSort');
      if (!editing && (sort === 'pct_desc' || sort === 'pct_asc')) paint();
      else paintQuotes(changed);
    },
    onReport: paint,
    destroy() { off(); },
  };
}

/* =====================================================================
 * 選股
 * ===================================================================== */
const SCR_TABS = [
  ['top', '綜合嚴選'],
  ['short_term', '短線'],
  ['swing', '波段'],
  ['long_term', '長線'],
  ['short_sell', '做空'],
  ['cobuy', '土洋同買'],
  ['hot', '成交熱門'],
  ['rank', '全市場排行'],
];
const TIERS = [
  ['ALL', '全部價位'],
  ['HIGH_200_PLUS', '高價 ≥200'],
  ['MID_50_200', '中價 50–200'],
  ['LOW_UNDER_50', '銅板 <50'],
];
const RANK_SORTS = [
  ['gain', '漲幅'],
  ['loss', '跌幅'],
  ['f_buy', '外資買超'],
  ['t_buy', '投信買超'],
  ['f_sell', '外資賣超'],
  ['vol', '成交量'],
];
const tierOf = price => (price >= 200 ? 'HIGH_200_PLUS' : price >= 50 ? 'MID_50_200' : 'LOW_UNDER_50');
const hasDirVolume = () => { const first = R.dir['2330'] || Object.values(R.dir)[0]; return Boolean(first && first.length > 12); };
const scoreKey = tab => ({ top: 'total_score', short_term: 'short_term_score', swing: 'swing_score', long_term: 'long_term_score', short_sell: 'short_sell_score' }[tab] || 'total_score');

function screenerList(tab, tier, rankSort) {
  if (tab === 'rank') {
    let rows = Object.keys(R.dir).map(dirEntry).filter(Boolean);
    if (tier !== 'ALL') rows = rows.filter(d => tierOf(d.close) === tier);
    const sorters = { gain: (a, b) => b.pct - a.pct, loss: (a, b) => a.pct - b.pct, f_buy: (a, b) => b.f - a.f, t_buy: (a, b) => b.t - a.t, f_sell: (a, b) => a.f - b.f, vol: (a, b) => (b.vol || 0) - (a.vol || 0) };
    rows.sort(sorters[rankSort] || sorters.gain);
    return rows.map(d => d.code);
  }
  let codes;
  const all = Object.values(R.stocks);
  if (tab === 'cobuy') codes = all.filter(s => s.metrics && s.metrics.foreign_lots > 0 && s.metrics.trust_lots > 0).sort((a, b) => b.metrics.inst_3d_val_yi - a.metrics.inst_3d_val_yi).map(s => s.code);
  else if (tab === 'hot') codes = [...(R.lists.hot || []), ...all.sort((a, b) => (b.metrics?.turnover_yi || 0) - (a.metrics?.turnover_yi || 0)).map(s => s.code)];
  else { const k = scoreKey(tab); codes = all.sort((a, b) => (b[k] ?? b.total_score) - (a[k] ?? a.total_score)).map(s => s.code); }
  codes = [...new Set(codes)];
  if (tier !== 'ALL') codes = codes.filter(c => (R.stocks[c].price_tier || tierOf(R.stocks[c].close)) === tier);
  return codes;
}
function scrRowHTML(code, i, tab) {
  if (tab === 'rank') {
    const d = dirEntry(code);
    return html`<div class="row" data-open="${code}">
      <div class="row-main"><div class="row-name"><span class="rank ${i < 3 ? 'top' : ''}">${i + 1}</span><span>${d.name}</span>${R.stocks[code] ? html`<span class="badge brand">AI</span>` : ''}</div>
        <div class="row-sub"><span class="code">${code}</span><span>${d.market === 'TPEx' ? '上櫃' : '上市'}</span><span>外資 <b class="${dirOf(d.f)}">${fmtLots(d.f)}</b></span><span>投信 <b class="${dirOf(d.t)}">${fmtLots(d.t)}</b></span>${isNum(d.vol) ? html`<span>量 ${fmtVol(d.vol)}</span>` : ''}</div></div>
      <span></span>
      <div class="row-right">${priceEl(code, 'row-price')}${pillEl(code)}</div>
    </div>`;
  }
  const s = R.stocks[code];
  const isShort = tab === 'short_sell';
  const mode = isShort ? 'short_sell' : ['short_term', 'swing', 'long_term'].includes(tab) ? tab : 'swing';
  const plan = isShort ? s.short_sell_plan || {} : (s.horizon_plans && s.horizon_plans[mode]) || s.price_plan || {};
  const sc = s[scoreKey(tab)] ?? s.total_score;
  const picked = (R.lists[tab] || []).includes(code);
  const m = s.metrics || {};
  return html`<div class="row" data-open="${code}" data-mode="${mode}">
    <div class="row-main">
      <div class="row-name"><span class="rank ${i < 3 ? 'top' : ''}">${i + 1}</span><span>${s.name}</span><span class="badge ${isShort ? 'violet' : 'brand'}">${Math.round(sc)} 分</span>${picked ? html`<span class="badge gold">精選</span>` : ''}</div>
      <div class="row-sub"><span class="code">${code}</span><span>${isShort ? '空點' : '買區'} <b class="num">${fmtPrice(plan.entry_low)}～${fmtPrice(plan.entry_high)}</b></span><span>${isShort ? '回補' : '停損'} <b class="num">${fmtPrice(plan.stop_loss)}</b></span></div>
      <div class="row-sub pro-only"><span>外資 <b class="${dirOf(m.foreign_lots)}">${fmtLots(m.foreign_lots)}</b></span><span>投信 <b class="${dirOf(m.trust_lots)}">${fmtLots(m.trust_lots)}</b></span><span>3日 <b class="${dirOf(m.inst_3d_val_yi)}">${fmtYi(m.inst_3d_val_yi)}</b></span></div>
    </div>
    <span></span>
    <div class="row-right">${priceEl(code, 'row-price')}${pillEl(code)}</div>
  </div>`;
}
export function screenerView(root) {
  let limit = 60;
  const paint = () => {
    const tab = store.getSetting('screenerTab');
    const tier = store.getSetting('screenerTier');
    const rankSort = store.getSetting('screenerSort') || 'gain';
    const codes = screenerList(tab, tier, rankSort);
    const shown = codes.slice(0, limit);
    setInterest(shown.slice(0, 120));
    const meta = LIST_META[tab];
    setHTML(root, html`
      ${sectionHd(html`${icon('filter')} 選股器`, tab === 'rank' ? `全市場 ${fmtInt(Object.keys(R.dir).length)} 檔上市櫃・${mdOf(R.asOf)} 收盤` : `AI 會診 ${Object.keys(R.stocks).length} 檔・${meta ? meta.desc : tab === 'cobuy' ? '外資與投信同步買超' : '成交值最大的人氣股'}`)}
      <div class="scr-filters">
        <div class="chips" role="tablist">${SCR_TABS.map(([k, l]) => html`<button class="chip ${k === tab ? 'on' : ''} ${k === 'short_sell' && k === tab ? 'violet' : ''}" data-scr="${k}" role="tab" aria-selected="${k === tab}">${l}</button>`)}</div>
        <div class="chips">${TIERS.map(([k, l]) => html`<button class="chip ${k === tier ? 'on' : ''}" data-tier="${k}">${l}</button>`)}</div>
        ${tab === 'rank' ? html`<div class="seg">${RANK_SORTS.filter(([k]) => k !== 'vol' || hasDirVolume()).map(([k, l]) => html`<button class="${k === rankSort ? 'on' : ''}" data-rsort="${k}">${l}</button>`)}</div>` : ''}
      </div>
      <div class="scr-bar"><span class="scr-count">共 ${fmtInt(codes.length)} 檔${codes.length > shown.length ? `・顯示前 ${shown.length}` : ''}</span>${tab === 'short_sell' ? html`<span class="badge violet">${icon('alert', 'ic-xs')} 放空風險高，務必嚴守回補價</span>` : ''}</div>
      <div class="card" style="margin-top:8px">${shown.length ? html`<div class="list">${shown.map((c, i) => scrRowHTML(c, i, tab))}</div>` : emptyState({ img: IMG.cry, title: '此條件下沒有標的', text: '試試切換其他價位或分類。' })}</div>
      ${codes.length > shown.length ? html`<div style="text-align:center;margin-top:12px"><button class="btn" data-more>顯示更多</button></div>` : ''}
      ${DISCLAIMER}`);
  };
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-scr]');
    if (t) { store.setSetting('screenerTab', t.dataset.scr); limit = 60; paint(); window.scrollTo({ top: 0 }); return; }
    const tr = e.target.closest('[data-tier]');
    if (tr) { store.setSetting('screenerTier', tr.dataset.tier); limit = 60; paint(); return; }
    const rs = e.target.closest('[data-rsort]');
    if (rs) { store.setSetting('screenerSort', rs.dataset.rsort); limit = 60; paint(); return; }
    if (e.target.closest('[data-more]')) { limit += 80; paint(); }
  });
  paint();
  return { onQuotes: changed => paintQuotes(changed), onReport: paint };
}

/* =====================================================================
 * 新聞
 * ===================================================================== */
export function newsView(root) {
  let cat = store.getSetting('newsCat') || 'all';
  let items = [];
  let pending = null;
  let updatedAt = 0;
  const cats = [...NEWS_CATS, { key: 'media', label: '媒體精選' }];
  const shell = () => setHTML(root, html`
    <div class="news-layout">
      <div>
        ${sectionHd(html`${icon('news')} 財經新聞`, '鉅亨網即時新聞 × AI 報告媒體精選・依發布時間由新到舊')}
        <div class="chips" style="margin-bottom:10px">${cats.map(c => html`<button class="chip ${c.key === cat ? 'on' : ''}" data-cat="${c.key}">${c.label}</button>`)}</div>
        <div class="news-toolbar"><span class="live-dot" data-upd>連線中…</span><button class="btn btn-sm" data-refresh>${icon('refresh', 'ic-sm')} 更新</button></div>
        <div class="new-pill hidden" data-newpill><button data-shownew>${icon('chevron-up', 'ic-sm')} <span></span></button></div>
        <div class="card"><div class="news-list" data-list>${skeletonRows(8)}</div></div>
      </div>
      <aside class="desktop-only">
        ${sectionHd('AI 報告頭條', `${mdOf(R.asOf)} 盤後彙整・多家媒體`)}
        <div class="card"><div class="news-list">${R.headlines.slice(0, 10).map(n => newsItem(n, { compact: true }))}</div></div>
      </aside>
    </div>${DISCLAIMER}`);
  const renderList = list => {
    const box = root.querySelector('[data-list]');
    if (!box) return;
    setHTML(box, list.length ? html`${list.map(n => newsItem(n))}` : emptyState({ img: IMG.anchor, title: '目前沒有新聞', text: '來源暫時無法連線，請稍後下拉重新整理。' }));
    root.querySelector('[data-newpill]')?.classList.add('hidden');
  };
  const setUpd = (txt, ok = true) => {
    const el = root.querySelector('[data-upd]');
    if (el) { el.textContent = txt; el.style.opacity = ok ? 1 : 0.7; }
  };
  const load = async ({ background = false } = {}) => {
    if (!background) setUpd('更新中…');
    let list;
    try {
      list = cat === 'media' ? R.headlines : await fetchHeadlines(cat);
    } catch (e) {
      list = cat === 'all' ? R.headlines : [];
    }
    updatedAt = Date.now();
    setUpd(cat === 'media' ? `AI 報告 ${mdOf(R.asOf)} 彙整` : `即時・${tpeTime(updatedAt)} 更新・每 2 分鐘自動更新`);
    if (background && items.length && window.scrollY > 300) {
      const known = new Set(items.map(n => n.id));
      const fresh = list.filter(n => !known.has(n.id));
      if (fresh.length) {
        pending = list;
        const pill = root.querySelector('[data-newpill]');
        pill.querySelector('span').textContent = `${fresh.length} 則新消息`;
        pill.classList.remove('hidden');
        return;
      }
    }
    items = list;
    renderList(items);
  };
  root.addEventListener('click', e => {
    const c = e.target.closest('[data-cat]');
    if (c) { cat = c.dataset.cat; store.setSetting('newsCat', cat); $$('[data-cat]', root).forEach(b => b.classList.toggle('on', b.dataset.cat === cat)); setHTML(root.querySelector('[data-list]'), skeletonRows(8)); items = []; load(); return; }
    if (e.target.closest('[data-refresh]')) { load(); return; }
    if (e.target.closest('[data-shownew]')) { items = pending || items; pending = null; renderList(items); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  shell();
  load();
  const timer = setInterval(() => { if (document.visibilityState === 'visible') { refreshRelTimes(root); load({ background: true }); } }, 120e3);
  return { refresh: () => load(), onQuotes: changed => paintQuotes(changed), destroy: () => clearInterval(timer) };
}

/* =====================================================================
 * 更多（設定、備份、安裝、資料狀態）
 * ===================================================================== */
export let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || /[?&]app=apk/.test(location.search) || sessionStorage.getItem('sy.apk') === '1';

export function moreView(root, { version }) {
  const seg = (key, opts) => html`<div class="seg">${opts.map(([v, l]) => html`<button class="${store.getSetting(key) === v ? 'on' : ''}" data-set="${key}" data-val="${v}">${l}</button>`)}</div>`;
  const sw = (key, label) => html`<label class="switch" aria-label="${label}"><input type="checkbox" data-switch="${key}" ${store.getSetting(key) ? 'checked' : ''} /><i></i></label>`;
  const paint = () => {
    const sum = store.storageSummary();
    const appUrl = `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
    setHTML(root, html`
      <div class="card about"><img src="${IMG.logo}" alt="" /><div><div class="brand-name" style="font-size:20px">Stock<b>Yuan</b></div><div class="muted" style="font-size:12.5px">台股 AI 多智能體投研・短線 / 波段 / 長線 / 做空</div><div class="muted" style="font-size:12px">版本 ${version}</div></div></div>
      <div class="two-col">
      <div>
        ${sectionHd('外觀與閱讀')}
        <div class="card set-group">
          <div class="set-row"><div class="set-k"><span class="set-ic brand">${icon('moon')}</span><div><div class="set-t">主題</div><div class="set-s">深色 / 淺色 / 跟隨系統</div></div></div>${seg('theme', [['dark', '深色'], ['light', '淺色'], ['system', '系統']])}</div>
          <div class="set-row"><div class="set-k"><span class="set-ic gold">${icon('trend-up')}</span><div><div class="set-t">漲跌顏色</div><div class="set-s">台股慣用紅漲綠跌</div></div></div>${seg('colors', [['tw', '紅漲綠跌'], ['intl', '綠漲紅跌']])}</div>
          <div class="set-row"><div class="set-k"><span class="set-ic green">${icon('eye')}</span><div><div class="set-t">白話直覺模式</div><div class="set-s">大字體、隱藏專業指標，長輩也看得懂</div></div></div>${sw('easy', '白話直覺模式')}</div>
        </div>
        ${sectionHd('即時行情')}
        <div class="card set-group">
          <div class="set-row"><div class="set-k"><span class="set-ic cyan">${icon('bolt')}</span><div><div class="set-t">盤中自動更新報價</div><div class="set-s">09:00–13:30 頁面開啟時自動更新</div></div></div>${sw('autoRefresh', '盤中自動更新')}</div>
          <div class="set-row"><div class="set-k"><span class="set-ic">${icon('clock')}</span><div><div class="set-t">更新頻率</div></div></div>${seg('interval', [[10, '10秒'], [15, '15秒'], [30, '30秒'], [60, '60秒']])}</div>
        </div>
        ${sectionHd('自選股')}
        <div class="card set-group">
          <div class="set-row" role="button" data-share-wl><div class="set-k"><span class="set-ic gold">${icon('link')}</span><div><div class="set-t">備份與跨裝置同步</div><div class="set-s">${sum.count} 檔・產生同步連結、匯入清單</div></div></div>${icon('chevron-right')}</div>
          <div class="set-row"><div class="set-k"><span class="set-ic green">${icon('shield')}</span><div><div class="set-t">儲存狀態</div><div class="set-s" data-persist>本機三重備份・上次儲存 ${sum.savedAt ? relTime(sum.savedAt) : '—'}</div></div></div></div>
        </div>
      </div>
      <div>
        ${sectionHd('分享與安裝')}
        <div class="card set-group">
          ${R.briefing ? html`<div class="set-row" role="button" data-brief><div class="set-k"><span class="set-ic green">${icon('message')}</span><div><div class="set-t">複製 LINE 投研日報</div><div class="set-s">各分類 Top 3 與買賣點，一鍵貼到群組</div></div></div>${icon('copy')}</div>` : ''}
          ${isStandalone() ? html`<div class="set-row"><div class="set-k"><span class="set-ic brand">${icon('phone')}</span><div><div class="set-t">已在 App 模式中使用</div><div class="set-s">全螢幕、主畫面圖示啟動</div></div></div>${icon('check')}</div>` : html`
          <div class="set-row" role="button" data-install><div class="set-k"><span class="set-ic brand">${icon('download')}</span><div><div class="set-t">安裝到主畫面</div><div class="set-s">${isIOS() ? 'iPhone：Safari 分享 → 加入主畫面' : '免下載商店，像原生 App 一樣使用'}</div></div></div>${icon('chevron-right')}</div>
          ${!isIOS() ? html`<a class="set-row" href="./StockYuan.apk" download><div class="set-k"><span class="set-ic">${icon('phone')}</span><div><div class="set-t">Android APK 安裝檔</div><div class="set-s">StockYuan.apk（約 1.3 MB）</div></div></div>${icon('download')}</a>` : ''}`}
        </div>
        <div class="card desktop-only" style="margin-top:12px"><div class="card-hd"><div class="card-title">${icon('qr')} 手機掃碼開啟</div></div>
          <div class="qr-pair"><div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=${encodeURIComponent(appUrl)}" alt="App QR code" loading="lazy" />iPhone / Android 通用（PWA）</div><div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=${encodeURIComponent(appUrl + 'StockYuan.apk')}" alt="APK QR code" loading="lazy" />Android APK 下載</div></div></div>
        ${sectionHd('資料狀態')}
        <div class="card set-group">
          <div class="set-row"><div class="set-k"><span class="set-ic violet">${icon('sparkles')}</span><div><div class="set-t">AI 策略報告</div><div class="set-s">${R.asOf} 盤後・產生於 ${R.generatedAt}</div></div></div></div>
          <div class="set-row"><div class="set-k"><span class="set-ic cyan">${icon('activity')}</span><div><div class="set-t">即時報價</div><div class="set-s">${liveState.lastAt ? `${tpeTime(liveState.lastAt, true)} 更新・${liveState.ok ? '連線正常' : '連線異常'}` : '尚未更新'}・來源：鉅亨網</div></div></div><button class="btn btn-sm" data-refresh-q>${icon('refresh', 'ic-sm')}</button></div>
          <div class="set-row" role="button" data-clear><div class="set-k"><span class="set-ic">${icon('trash')}</span><div><div class="set-t">清除快取並重新載入</div><div class="set-s">畫面異常時使用（不會刪除自選股）</div></div></div>${icon('chevron-right')}</div>
        </div>
      </div>
      </div>
      <p class="disclaimer">資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料，鉅亨網即時報價與新聞，FinMind 歷史 K 線。AI 分析由程式依籌碼、技術面規則自動產生，可能有錯誤或延遲，僅供研究參考，不構成投資建議。</p>`);
    navigator.storage?.persisted?.().then(p => {
      const el = root.querySelector('[data-persist]');
      if (el && p) el.textContent += '・已啟用永久儲存';
    }).catch(() => {});
  };
  root.addEventListener('click', async e => {
    const s = e.target.closest('[data-set]');
    if (s) {
      const v = s.dataset.set === 'interval' ? Number(s.dataset.val) : s.dataset.val;
      store.setSetting(s.dataset.set, v);
      paint();
      return;
    }
    if (e.target.closest('[data-share-wl]')) { openShareSheet(); return; }
    if (e.target.closest('[data-brief]')) { const ok = await copyText(R.briefing); toast(ok ? '已複製 LINE 投研日報' : '複製失敗', { type: ok ? 'success' : 'error' }); return; }
    if (e.target.closest('[data-refresh-q]')) { await refreshQuotes({ all: true }); toast('報價已更新', { type: 'success' }); paint(); return; }
    if (e.target.closest('[data-install]')) {
      if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (err) { /* ignore */ } deferredInstall = null; return; }
      openSheet({ title: '安裝 StockYuan', body: html`<div class="stack">
        <div class="hstack" style="align-items:flex-start"><span class="set-ic brand">${icon('phone')}</span><div><div class="set-t">iPhone / iPad</div><div class="set-s">用 Safari 開啟本站 → 點下方「分享」→「加入主畫面」。</div></div></div>
        <div class="hstack" style="align-items:flex-start"><span class="set-ic green">${icon('phone')}</span><div><div class="set-t">Android</div><div class="set-s">Chrome 右上選單 →「安裝應用程式」，或下載 APK 安裝檔。</div></div></div>
        <a class="btn btn-primary" href="./StockYuan.apk" download>${icon('download', 'ic-sm')} 下載 Android APK</a></div>` });
      return;
    }
    if (e.target.closest('[data-clear]')) {
      try { navigator.serviceWorker?.controller?.postMessage('CLEAR_CACHES'); } catch (err) { /* ignore */ }
      try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch (err) { /* ignore */ }
      toast('快取已清除，重新載入中…', { type: 'success' });
      setTimeout(() => location.reload(), 600);
    }
  });
  root.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.switch;
    if (k) store.setSetting(k, e.target.checked);
  });
  paint();
  return { onReport: paint };
}
