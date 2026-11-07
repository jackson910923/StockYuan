// StockYuan 個股深度頁：即時報價、分時/日K/週K、AI 委員會、四大策略劇本、昨日驗證、籌碼、技術、多空辯論、試算、新聞
import { $, $$, bus, clamp, copyText, dirOf, fmtAmount, fmtChg, fmtInt, fmtLots, fmtPct, fmtPrice, fmtVol, fmtYi, html, isNum, mdOf, num, raw, relTime, setHTML, tpeDate, tpeTime } from './util.js';
import { R, Q, LIST_META, addInterest, dirEntry, fetchDaily, fetchIntraday, fetchStockNews, marketOf, nameOf, phaseNow, px, refreshQuotes, withLiveBar } from './api.js';
import { IMG, chgEl, emptyState, icon, lightOf, paintQuotes, priceEl, ring, starBtn, toast } from './ui.js';
import { PriceChart, calcTech, toWeekly } from './charts.js';
import { newsItem, openStock } from './views.js';
import * as store from './store.js';

const MODES = [
  ['short_term', '短線', '1～5 日'],
  ['swing', '波段', '2～8 週'],
  ['long_term', '長線', '季 / 年'],
  ['short_sell', '做空', '避險'],
];
const RANGES = [
  ['I', '分時'],
  ['D', '日K'],
  ['W', '週K'],
];
const stripEmoji = s => String(s || '').replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '').trim();
const pctFrom = (a, b) => (isNum(a) && isNum(b) && b ? ((a - b) / b) * 100 : null);
const BULL_RE = /看多|買進|認養|布局|偏多|籌碼安定|突破|加碼/;
const BEAR_RE = /看空|調節|賣|減碼|警戒|過熱|偏空|保守|避險/;
const voteTone = v => (BEAR_RE.test(v) ? 'bear' : BULL_RE.test(v) ? 'bull' : '');

function defaultMode(s) {
  const b = String((s && s.best_horizon) || '').toUpperCase();
  if (b.includes('SHORT_SELL')) return 'short_sell';
  if (b.includes('SHORT')) return 'short_term';
  if (b.includes('LONG')) return 'long_term';
  return 'swing';
}

/** 取出目前劇本的價位規劃（統一欄位） */
function planOf(s, mode) {
  if (!s) return null;
  if (mode === 'short_sell') {
    const sp = s.short_sell_plan || {};
    const mid = (num(sp.entry_low) + num(sp.entry_high)) / 2;
    return {
      short: true,
      label: '🐻 做空／避險',
      score: sp.score ?? s.short_sell_score,
      suitability: stripEmoji(sp.badge),
      entry_low: sp.entry_low,
      entry_high: sp.entry_high,
      stop_loss: sp.stop_loss,
      target_price: sp.target_price,
      rr: sp.risk_reward_ratio || (isNum(mid) && sp.stop_loss > mid ? +((mid - sp.target_price) / (sp.stop_loss - mid)).toFixed(2) : null),
      holding: '反彈布空・跌深分批回補',
      note: html`操作原則：<b>反彈無力時於空點區布空，不追殺急跌</b>；帶量站回 <b>${fmtPrice(sp.stop_loss)}</b> 元務必回補停損。${sp.squeeze_risk ? html`<br/>軋空風險：${stripEmoji(sp.squeeze_risk)}` : ''}`,
      advisor: sp.easy_short_advisor || (s.agents && s.agents.easy_advisor),
    };
  }
  const hp = (s.horizon_plans && s.horizon_plans[mode]) || {};
  const pp = s.price_plan || {};
  const el = hp.entry_low ?? pp.entry_low;
  const eh = hp.entry_high ?? pp.entry_high;
  const st = hp.stop_loss ?? pp.stop_loss;
  const tg = hp.target_price ?? pp.target_price;
  const mid = (num(el) + num(eh)) / 2;
  return {
    short: false,
    label: hp.label,
    score: hp.score ?? s.total_score,
    suitability: stripEmoji(hp.suitability),
    entry_low: el,
    entry_high: eh,
    stop_loss: st,
    target_price: tg,
    rr: mode === 'swing' && pp.risk_reward_ratio ? pp.risk_reward_ratio : isNum(mid) && mid > st ? +((tg - mid) / (mid - st)).toFixed(2) : null,
    holding: hp.holding_period,
    note: hp.strategy_note ? raw(html`${hp.strategy_note}`) : '',
    advisor: s.agents && s.agents.easy_advisor,
  };
}

/** 昨日策略驗證：盤中（報價日期晚於報告）→ 以最新報告策略對照即時價；否則以真正前一交易日策略對照最新收盤 */
function validationOf(code) {
  const s = R.stocks[code];
  if (!s) return null;
  const q = Q[code];
  if (q && q.date && q.date > R.asOf) {
    return {
      planDate: R.asOf, nowDate: q.date, live: true, base: s.close, now: q.price,
      bull: s.total_score, bear: s.short_sell_score,
      plan: s.price_plan || {}, splan: s.short_sell_plan || {},
    };
  }
  const ye = s.yesterday_eval;
  if (ye && ye.has_data && ye.close > 0) {
    return {
      planDate: ye.as_of_date, nowDate: R.asOf, live: false, base: ye.close, now: q ? q.price : s.close,
      bull: ye.total_score, bear: ye.short_sell_score,
      plan: { entry_low: ye.entry_low, entry_high: ye.entry_high, stop_loss: ye.stop_loss, target_price: ye.target_price },
      splan: { entry_low: ye.short_entry_low, entry_high: ye.short_entry_high, stop_loss: ye.short_stop_loss, target_price: ye.short_target },
    };
  }
  return { none: true, invalid: Boolean(ye && ye.invalid) };
}

export function stockView(root, route) {
  const code = String(route.arg || '').toUpperCase();
  let s = R.stocks[code] || null;
  let mode = route.params.get('mode') || (s ? defaultMode(s) : 'swing');
  if (!MODES.some(m => m[0] === mode)) mode = 'swing';
  let range = store.getSetting('chartRange') || 'D';
  let chart = null;
  let bars = null;
  let intra = null;
  let liteTech = null; // 由最新日 K 即時計算的技術指標（所有個股；AI 報告值可能落後一天）
  let techDate = '';
  let destroyed = false;
  let io = null;
  const timers = [];

  addInterest([code]);
  store.addRecent(code);

  const known = () => Boolean(R.stocks[code] || R.dir[code] || Q[code]);

  /* ---------- 區塊模板 ---------- */
  const headHTML = () => html`<div class="stock-head" data-sh>
    <button class="btn-icon" data-back aria-label="返回">${icon('chevron-left', 'ic-lg')}</button>
    <div class="sh-title"><div class="sh-name">${nameOf(code)} <span class="muted num" style="font-weight:600;font-size:13px">${code}</span></div><div class="sh-sub">${marketOf(code)}${s && s.sector ? `・${s.sector}` : ''}</div></div>
    <div class="sh-px">${priceEl(code)}<div class="sub">${chgEl(code, 'pct')}</div></div>
    ${starBtn(code)}
    <button class="btn-icon" data-share aria-label="分享">${icon('share')}</button>
  </div>`;

  const heroDynHTML = () => {
    const p = px(code);
    if (!p) return '';
    const ph = phaseNow();
    const liveQ = Q[code];
    const stamp = liveQ && liveQ.ts ? `${liveQ.date === tpeDate() ? '' : mdOf(liveQ.date) + ' '}${tpeTime(liveQ.ts, ph.live)}` : `${mdOf(R.asOf)} 收盤`;
    const lo = p.low;
    const hi = p.high;
    const pos = isNum(lo) && isNum(hi) && hi > lo ? clamp(((p.price - lo) / (hi - lo)) * 100, 0, 100) : null;
    const m = s && s.metrics;
    const amount = liveQ && isNum(liveQ.amount) ? fmtAmount(liveQ.amount) : m && isNum(m.turnover_yi) ? fmtYi(m.turnover_yi, false) : '--';
    return html`
      <div class="hero-time"><span class="phase ${ph.key}">${ph.label}</span><span>${stamp} 更新</span><span>·</span><span>${liveQ ? '鉅亨網即時報價' : 'AI 報告收盤價'}</span></div>
      ${pos != null ? html`<div class="range-bar" title="今日區間"><i style="left:${pos}%"></i></div><div class="range-labels"><span>低 ${fmtPrice(lo)}</span><span>今日區間</span><span>高 ${fmtPrice(hi)}</span></div>` : ''}
      <div class="kv-grid">
        <div class="kv"><span>開盤</span><b class="${dirOf((p.open ?? NaN) - p.prev)}">${fmtPrice(p.open)}</b></div>
        <div class="kv"><span>昨收</span><b>${fmtPrice(p.prev)}</b></div>
        <div class="kv"><span>成交量</span><b>${isNum(p.vol) ? fmtVol(p.vol) : '--'}</b></div>
        <div class="kv"><span>最高</span><b class="${dirOf((p.high ?? NaN) - p.prev)}">${fmtPrice(p.high)}</b></div>
        <div class="kv"><span>最低</span><b class="${dirOf((p.low ?? NaN) - p.prev)}">${fmtPrice(p.low)}</b></div>
        <div class="kv"><span>成交值</span><b>${amount}</b></div>
        ${liveQ && isNum(liveQ.limitUp) ? html`<div class="kv"><span>漲停</span><b class="up">${fmtPrice(liveQ.limitUp)}</b></div><div class="kv"><span>跌停</span><b class="down">${fmtPrice(liveQ.limitDown)}</b></div>` : ''}
        ${m && m.pe_ratio > 0 ? html`<div class="kv"><span>本益比</span><b>${m.pe_ratio.toFixed(1)}</b></div>` : ''}
      </div>`;
  };

  const heroHTML = () => {
    const tierLabel = s ? stripEmoji(s.price_tier_label) : '';
    return html`<div class="card hero o1">
      <div class="hero-top"><div class="grow">
        <div class="hero-name">${nameOf(code)} <span class="badge outline num">${code}</span></div>
        <div class="hero-tags"><span class="badge">${marketOf(code) || '台股'}</span>${s && s.sector ? html`<span class="badge">${s.sector}</span>` : ''}${s ? html`<span class="badge gold">${tierLabel}・一張約 ${fmtPrice(s.lot_cost_wan)} 萬</span>` : ''}${s ? html`<span class="badge brand">首選：${stripEmoji(s.best_horizon_label)}</span>` : html`<span class="badge cyan">即時查詢</span>`}</div>
      </div></div>
      <div class="hero-price" data-hero-px>${priceEl(code, 'big')}${chgEl(code, 'both', 'chg')}</div>
      <div data-hero-dyn>${heroDynHTML()}</div>
    </div>`;
  };

  const chartHTML = () => html`<div class="card chart-card o2">
    <div class="chart-toolbar">
      <div class="seg" role="tablist">${RANGES.map(([k, l]) => html`<button class="${k === range ? 'on' : ''}" data-range="${k}" role="tab" aria-selected="${k === range}">${l}</button>`)}</div>
      ${s ? html`<button class="chip ${store.getSetting('showPlanLines') ? 'on' : ''}" data-planlines style="height:30px">${icon('target', 'ic-xs')} 策略線</button>` : ''}
    </div>
    <div class="chart-legend" data-legend></div>
    <div class="chart-box" data-chart><div class="chart-state">${icon('activity')}&nbsp;走勢載入中…</div></div>
    <div class="chart-foot" data-chart-foot></div>
  </div>`;

  const footHTML = () => {
    if (range === 'I') return html`<span><i style="border-color:var(--text-3)"></i>昨收基準線</span><span>紅區高於昨收・綠區低於昨收</span>`;
    const short = mode === 'short_sell';
    return html`<span style="color:var(--ma5)">— MA5</span><span style="color:var(--ma20)">— MA20</span><span style="color:var(--ma60)">— MA60</span>${s && store.getSetting('showPlanLines') ? html`<span><i style="border-color:${short ? 'var(--violet)' : 'var(--green)'}"></i>${short ? '空點區' : '買區'}</span><span><i style="border-color:var(--danger);border-top-style:solid"></i>${short ? '回補' : '停損'}</span><span><i style="border-color:var(--gold)"></i>目標</span>` : ''}`;
  };

  const verdictHTML = () => {
    if (!s) {
      const t = liteTech;
      const p = px(code);
      let trend = '資料載入中';
      if (t && p) trend = p.price >= t.ma20 && t.ma20 >= t.ma60 ? '價在月線、季線之上，趨勢偏多' : p.price < t.ma20 && t.ma20 < t.ma60 ? '價在月線、季線之下，趨勢偏空' : '均線糾結，區間整理';
      return html`<div class="card verdict o3"><div class="verdict-top"><div class="verdict-light YELLOW">${icon('info')}</div><div><div class="verdict-badge">未列入今日 AI 委員會會診</div><div class="verdict-action">AI 每日深度會診約 ${Object.keys(R.stocks).length} 檔精選股；此股提供即時報價、籌碼與技術面數據。</div></div></div>
        <div class="lite-note" style="margin:12px 0 0">${icon('activity', 'ic-sm')}<span>技術面速覽：${trend}${t ? `（RSI ${t.rsi14}、KD ${t.k9}/${t.d9}）` : ''}</span></div></div>`;
    }
    const light = lightOf(s);
    const cells = [
      ['total_score', '綜合', 'brand', 'swing'],
      ['short_term_score', '短線', 'gold', 'short_term'],
      ['swing_score', '波段', 'cyan', 'swing'],
      ['long_term_score', '長線', 'green', 'long_term'],
      ['short_sell_score', '空方', 'violet', 'short_sell'],
    ];
    const best = defaultMode(s);
    return html`<div class="card verdict o3">
      <div class="verdict-top"><div class="verdict-light ${light}">${icon(light === 'GREEN' ? 'trend-up' : light === 'RED' ? 'trend-down' : 'scale', 'ic-lg')}</div>
        <div class="grow"><div class="card-sub">${icon('sparkles', 'ic-xs')} AI 六大 Agent 委員會・${mdOf(R.asOf)} 盤後</div><div class="verdict-badge">${stripEmoji(s.verdict && s.verdict.badge)}</div><div class="verdict-action">${s.verdict && s.verdict.easy_action}</div></div></div>
      <div class="scores">${cells.map(([k, l, tone, m]) => html`<button class="score-cell ${m === best && k !== 'total_score' ? 'best' : ''}" data-mode-pick="${m}" style="border:0;cursor:pointer" aria-label="${l} ${Math.round(s[k] || 0)} 分">${ring(s[k], { tone, label: l })}<span>${l}</span></button>`)}</div>
      <div class="verdict-foot"><span class="badge brand">建議部位 ${s.price_plan && s.price_plan.suggested_position_pct}%</span><span class="badge pro-only">籌碼 ${Math.round(s.chip_score)}・趨勢 ${Math.round(s.trend_score)}・風控 ${Math.round(s.risk_score)}</span></div>
    </div>`;
  };

  const ladderHTML = (plan, price) => {
    const vals = [plan.stop_loss, plan.entry_low, plan.entry_high, plan.target_price, price].map(Number).filter(v => v > 0);
    if (vals.length < 4) return '';
    const lo = Math.min(...vals) * 0.996;
    const hi = Math.max(...vals) * 1.004;
    const pos = v => clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
    const zl = pos(Math.min(plan.entry_low, plan.entry_high));
    const zh = pos(Math.max(plan.entry_low, plan.entry_high));
    let cap;
    if (plan.short) {
      if (price >= plan.stop_loss) cap = html`<span class="badge up">${icon('alert', 'ic-xs')} 已觸及回補停損價</span>`;
      else if (price <= plan.target_price) cap = html`<span class="badge gold">已達回補目標</span>`;
      else if (price >= plan.entry_low && price <= plan.entry_high) cap = html`<span class="badge violet">現價位於空點區</span>`;
      else cap = html`<span class="badge">${price > plan.entry_high ? '高於空點區，留意軋空' : `低於空點區 ${fmtPct(pctFrom(price, plan.entry_low))}，勿追空`}</span>`;
    } else {
      if (price <= plan.stop_loss) cap = html`<span class="badge up">${icon('alert', 'ic-xs')} 已跌破停損價</span>`;
      else if (price >= plan.target_price) cap = html`<span class="badge gold">已達目標價</span>`;
      else if (price >= plan.entry_low && price <= plan.entry_high) cap = html`<span class="badge down">現價位於建議買區</span>`;
      else if (price > plan.entry_high) cap = html`<span class="badge">高於買區 ${fmtPct(pctFrom(price, plan.entry_high))}，等拉回</span>`;
      else cap = html`<span class="badge">低於買區，接近停損 ${fmtPct(pctFrom(price, plan.stop_loss))}</span>`;
    }
    return html`<div class="ladder ${plan.short ? 'short' : ''}" aria-hidden="true">
      <div class="zone" style="left:${zl}%;width:${Math.max(1.5, zh - zl)}%"></div>
      <div class="tick stop" style="left:${pos(plan.stop_loss)}%"></div><div class="mark stop" style="left:${pos(plan.stop_loss)}%">${plan.short ? '回補' : '停損'}</div>
      <div class="tick target" style="left:${pos(plan.target_price)}%"></div><div class="mark target" style="left:${pos(plan.target_price)}%">目標</div>
      <div class="now" style="left:${pos(price)}%"></div><div class="mark now-l" style="left:${pos(price)}%">現價</div>
    </div><div class="ladder-cap">${cap}</div>`;
  };

  const planBodyHTML = () => {
    const plan = planOf(s, mode);
    const p = px(code);
    if (!plan || !p) return '';
    const short = plan.short;
    const stopDist = pctFrom(plan.stop_loss, p.price);
    const tgtDist = pctFrom(plan.target_price, p.price);
    return html`
      <div class="levels">
        <div class="level entry ${short ? 'short' : ''}"><div class="lv-k">${icon(short ? 'trend-down' : 'trend-up', 'ic-xs')} ${short ? '反彈布空區' : '建議買區'}</div><div class="lv-v">${fmtPrice(plan.entry_low)}～${fmtPrice(plan.entry_high)}</div><div class="lv-s">${short ? '反彈無力再布空' : '分批承接・不追高'}</div></div>
        <div class="level stop"><div class="lv-k">${icon('shield', 'ic-xs')} ${short ? '回補停損' : '停損價'}</div><div class="lv-v">${fmtPrice(plan.stop_loss)}</div><div class="lv-s">距現價 ${fmtPct(stopDist)}</div></div>
        <div class="level target"><div class="lv-k">${icon('target', 'ic-xs')} ${short ? '回補目標' : '目標價'}</div><div class="lv-v">${fmtPrice(plan.target_price)}</div><div class="lv-s">${fmtPct(tgtDist)}${plan.rr ? `・風報比 1:${plan.rr}` : ''}</div></div>
      </div>
      ${ladderHTML(plan, p.price)}
      <div class="plan-note"><b>${plan.suitability || ''}</b>${plan.score != null ? html`・評分 <b>${Math.round(plan.score)}</b>` : ''}${plan.holding ? html`・${plan.holding}` : ''}${plan.note ? html`<br/>${plan.note}` : ''}</div>`;
  };

  const planHTML = () => {
    if (!s) return '';
    return html`<div class="card plan o4">
      <div class="card-hd"><div class="card-title">${icon('target')} 操作策略</div><span class="card-sub">依 ${mdOf(R.asOf)} 收盤規劃</span></div>
      <div class="seg full" role="tablist">${MODES.map(([k, l, sub]) => html`<button class="${k === mode ? 'on' : ''} ${k === 'short_sell' ? 'violet' : ''}" data-mode="${k}" role="tab" aria-selected="${k === mode}">${l}<span class="sub">${sub}</span></button>`)}</div>
      <div data-plan-body>${planBodyHTML()}</div>
    </div>`;
  };

  const pnlBodyHTML = () => {
    const v = validationOf(code);
    if (!v) return '';
    if (v.none) {
      return html`<div class="stance na">${icon('info', 'ic-sm')} ${v.invalid ? '前一交易日的 AI 評分存檔不完整，暫不提供驗證（避免以今日分數事後諸葛）' : '此股為今日新納入 AI 追蹤，前一交易日尚無策略存檔'}</div>`;
    }
    const diff = (Number(v.bull) || 0) - (Number(v.bear) || 0);
    const stance = diff > 5 ? 'bull' : diff < -5 ? 'bear' : 'even';
    const chg = v.now - v.base;
    const pct = pctFrom(v.now, v.base);
    const longPnl = Math.round(chg * 1000);
    const shortPnl = -longPnl;
    const plan = v.plan || {};
    const sp = v.splan || {};
    const when = v.live ? `${mdOf(v.planDate)} 收盤 → 今日盤中` : `${mdOf(v.planDate)} 收盤 → ${mdOf(v.nowDate)} 收盤`;
    let text;
    if (stance === 'bull') {
      if (chg > 0) text = html`前一日 AI <b>主推做多</b>，${v.live ? '盤中' : '隔日'}上漲 <b class="up">${fmtPct(pct)}</b>，方向正確。${plan.target_price && v.now >= plan.target_price ? html`已達目標價 <b>${fmtPrice(plan.target_price)}</b>，可分批停利。` : html`停損可上移至 <b>${fmtPrice(v.base)}</b> 保護獲利。`}`;
      else if (chg < 0) text = plan.stop_loss && v.now <= plan.stop_loss ? html`前一日主推做多，但已跌破停損價 <b>${fmtPrice(plan.stop_loss)}</b>（${fmtPct(pct)}），依紀律應停損，避免擴大虧損。` : plan.entry_low && v.now >= plan.entry_low && v.now <= plan.entry_high ? html`前一日主推做多，今日拉回 <b class="down">${fmtPct(pct)}</b> 至建議買區（${fmtPrice(plan.entry_low)}～${fmtPrice(plan.entry_high)}），仍在策略防守範圍內。` : html`前一日主推做多，今日回檔 <b class="down">${fmtPct(pct)}</b>，尚未觸及停損 ${fmtPrice(plan.stop_loss)}，策略未失效但方向暫時不利。`;
      else text = html`前一日主推做多，今日平盤。`;
    } else if (stance === 'bear') {
      if (chg < 0) text = html`前一日 AI <b>空方分數較高</b>，${v.live ? '盤中' : '隔日'}下跌 <b class="down">${fmtPct(pct)}</b>：未追多的投資人避開虧損，若依策略放空帳面 <b>+${fmtInt(shortPnl)}</b> 元。`;
      else if (chg > 0) text = sp.stop_loss && v.now >= sp.stop_loss ? html`前一日偏空，但今日上漲 <b class="up">${fmtPct(pct)}</b> 並觸及回補價 <b>${fmtPrice(sp.stop_loss)}</b>，若有空單應回補停損。` : html`前一日偏空，今日反彈 <b class="up">${fmtPct(pct)}</b>，方向不利；空單留意回補價 <b>${fmtPrice(sp.stop_loss)}</b>。`;
      else text = html`前一日偏空，今日平盤。`;
    } else {
      text = html`前一日多空分數接近（區間整理判斷），今日 <b class="${dirOf(chg)}">${fmtPct(pct)}</b>。`;
    }
    return html`
      <div class="stance ${stance}"><span>${stance === 'bull' ? '前一日 AI：多方分數較高（主推做多）' : stance === 'bear' ? '前一日 AI：空方分數較高（偏空／避險）' : '前一日 AI：多空分數接近'}</span><span class="vs">多 ${Number(v.bull).toFixed(1)} vs 空 ${Number(v.bear).toFixed(1)}</span></div>
      <div class="pnl-grid">
        <div class="pnl-cell ${stance === 'bull' ? 'primary' : ''}"><div class="pc-k">做多一張 ${stance === 'bull' ? html`<span class="badge brand">主推</span>` : ''}</div><div class="pc-v ${dirOf(longPnl)}">${longPnl > 0 ? '+' : ''}${fmtInt(longPnl)} 元</div><div class="pc-s">${fmtPct(pct)}・${fmtPrice(v.base)} → ${fmtPrice(v.now)}</div></div>
        <div class="pnl-cell ${stance === 'bear' ? 'primary' : ''}"><div class="pc-k">放空一張 ${stance === 'bear' ? html`<span class="badge violet">主推</span>` : ''}</div><div class="pc-v ${dirOf(shortPnl)}">${shortPnl > 0 ? '+' : ''}${fmtInt(shortPnl)} 元</div><div class="pc-s">${fmtPct(pct == null ? null : -pct)}・未含手續費與借券費</div></div>
      </div>
      <div class="pnl-text">${text}</div>
      <div class="pnl-text muted" style="font-size:12px">${when}・1 張 = 1,000 股・不含交易成本</div>`;
  };
  const pnlHTML = () => (s ? html`<div class="card pnl o5"><div class="card-hd"><div class="card-title">${icon('scale')} 昨日策略・今日驗證</div><span class="card-sub">誠實公開、不事後諸葛</span></div><div data-pnl>${pnlBodyHTML()}</div></div>` : '');

  const advisorHTML = () => {
    const plan = planOf(s, mode);
    const text = plan && plan.advisor;
    if (!text) return '';
    const img = mode === 'short_sell' ? IMG.cry : mode === 'short_term' ? IMG.bull : IMG.anchor;
    return html`<div class="card advisor advisor-card o6"><img src="${img}" alt="" data-adv-img /><div><div class="advisor-k">${icon('message', 'ic-xs')} 白話重點${mode === 'short_sell' ? '（做空視角）' : ''}</div><div class="advisor-t" data-adv-text>${text}</div></div></div>`;
  };

  const chipsHTML = () => {
    const m = s ? s.metrics || {} : null;
    const d = dirEntry(code);
    const f = m ? m.foreign_lots : d && d.f;
    const t = m ? m.trust_lots : d && d.t;
    const dl = m ? m.dealer_lots : d && d.d;
    if (!isNum(f) && !isNum(t)) return '';
    const total = m ? m.inst_total_lots : (f || 0) + (t || 0) + (dl || 0);
    const margin = m ? m.margin_diff_lots : d && d.margin;
    const dtp = m ? m.day_trade_pct : d && d.dt;
    const mx = Math.max(1, ...[f, t, dl].map(v => Math.abs(v || 0)));
    const bar = v => {
      const w = (Math.abs(v || 0) / mx) * 50;
      return html`<div class="div-bar"><i class="${v >= 0 ? 'pos' : 'neg'}" style="width:${w}%"></i></div>`;
    };
    return html`<div class="card o7"><div class="card-hd"><div class="card-title">${icon('users')} 籌碼動向</div><span class="card-sub">${mdOf(R.asOf)} 三大法人（張）</span></div>
      <div class="chip-rows">
        <div class="chip-row"><span class="cr-k">外資</span>${bar(f)}<span class="cr-v ${dirOf(f)}">${fmtLots(f)}</span></div>
        <div class="chip-row"><span class="cr-k">投信</span>${bar(t)}<span class="cr-v ${dirOf(t)}">${fmtLots(t)}</span></div>
        <div class="chip-row"><span class="cr-k">自營商</span>${bar(dl)}<span class="cr-v ${dirOf(dl)}">${fmtLots(dl)}</span></div>
      </div>
      <div class="mini-kv">
        <div><span>法人合計</span><b class="${dirOf(total)}">${fmtLots(total)}</b></div>
        <div><span>融資增減</span><b>${fmtLots(margin)}</b></div>
        <div><span>當沖比</span><b>${isNum(dtp) ? dtp.toFixed(1) + '%' : '--'}</b></div>
        ${m ? html`<div><span>法人 3 日</span><b class="${dirOf(m.inst_3d_val_yi)}">${fmtYi(m.inst_3d_val_yi)}</b></div><div><span>量比</span><b>${isNum(m.vol_ratio) ? m.vol_ratio.toFixed(2) + 'x' : '--'}</b></div><div><span>成交值</span><b>${fmtYi(m.turnover_yi, false)}</b></div>` : ''}
      </div>
      ${s && s.agents && s.agents.chip_agent ? html`<div class="agent-notes pro-only"><div class="agent-note"><b>籌碼追蹤官</b>${s.agents.chip_agent}</div></div>` : ''}
    </div>`;
  };

  const techHTML = () => {
    const t = liteTech || (s ? s.technicals : null);
    if (!t) return html`<div class="card o8 pro-only"><div class="card-hd"><div class="card-title">${icon('activity')} 技術指標</div></div><div class="card-body"><span class="skel" style="height:90px"></span></div></div>`;
    const p = px(code);
    const price = p ? p.price : null;
    const gauge = v => html`<div class="gauge"><i style="left:${clamp(Number(v) || 0, 0, 100)}%"></i></div>`;
    const rsiTxt = t.rsi14 >= 70 ? '過熱' : t.rsi14 <= 30 ? '超賣' : '中性';
    const ma = (k, label) => {
      const v = t[k];
      const rel = isNum(price) && isNum(v) ? (price >= v ? html`<small class="up">▲ 站上</small>` : html`<small class="down">▼ 跌破</small>`) : '';
      return html`<div class="ma-item"><span>${label}</span><b>${fmtPrice(v)}</b>${rel}</div>`;
    };
    return html`<div class="card o8 pro-only"><div class="card-hd"><div class="card-title">${icon('activity')} 技術指標</div><span class="card-sub">${liteTech ? `依 ${mdOf(techDate)} 日K 即時計算` : `依 ${mdOf(R.asOf)} 收盤`}</span></div>
      <div class="tech-grid">
        <div class="tech"><div class="tech-k"><span>RSI (14)</span><span>${rsiTxt}</span></div><div class="tech-v">${t.rsi14}</div>${gauge(t.rsi14)}</div>
        <div class="tech"><div class="tech-k"><span>KD (9)</span><span>${t.kd_signal || ''}</span></div><div class="tech-v">${t.k9}<small>/ ${t.d9}</small></div>${gauge(t.k9)}</div>
        <div class="tech"><div class="tech-k"><span>MACD 柱</span></div><div class="tech-v ${dirOf(t.macd_hist)}">${t.macd_hist > 0 ? '+' : ''}${t.macd_hist}<small>${t.macd_signal || ''}</small></div><div class="meter ${t.macd_hist >= 0 ? '' : 'green'}"><i style="width:${clamp(Math.abs(t.macd_hist) / Math.max(0.01, (price || 1) * 0.004) * 50, 4, 100)}%"></i></div></div>
        <div class="tech"><div class="tech-k"><span>布林 %B</span><span>${t.bb_pct > 100 ? '突破上軌' : t.bb_pct < 0 ? '跌破下軌' : ''}</span></div><div class="tech-v">${t.bb_pct}%</div>${gauge(t.bb_pct)}</div>
        <div class="tech"><div class="tech-k"><span>20 日支撐</span></div><div class="tech-v">${fmtPrice(t.support_20d)}</div><div class="muted" style="font-size:11px">距現價 ${fmtPct(pctFrom(t.support_20d, price))}</div></div>
        <div class="tech"><div class="tech-k"><span>20 日壓力</span></div><div class="tech-v">${fmtPrice(t.resistance_20d)}</div><div class="muted" style="font-size:11px">距現價 ${fmtPct(pctFrom(t.resistance_20d, price))}</div></div>
      </div>
      <div class="ma-list">${ma('ma5', 'MA5')}${ma('ma10', 'MA10')}${ma('ma20', 'MA20')}${ma('ma60', 'MA60')}</div>
      ${s && s.agents && s.agents.technical_agent ? html`<div class="agent-notes"><div class="agent-note"><b>量化技術官</b>${s.agents.technical_agent}</div></div>` : ''}
    </div>`;
  };

  const debateHTML = () => {
    if (!s || !s.agents) return '';
    const bulls = s.agents.bull_researcher || [];
    const bears = [...(s.agents.bear_researcher || [])];
    ((s.short_sell_plan && s.short_sell_plan.reasons) || []).forEach(r => { if (!bears.includes(r)) bears.push(r); });
    return html`<div class="card o10"><div class="card-hd"><div class="card-title">${icon('scale')} 多空交叉辯論</div><span class="card-sub">看多研究員 vs 看空風控官</span></div>
      <div class="debate">
        <div class="debate-col"><h4 class="up">${icon('trend-up', 'ic-sm')} 看多理由</h4><ul>${bulls.length ? bulls.map(b => html`<li>${b}</li>`) : html`<li>暫無明確利多訊號</li>`}</ul></div>
        <div class="debate-col bear"><h4 class="down">${icon('trend-down', 'ic-sm')} 風險與放空理由</h4><ul>${bears.length ? bears.map(b => html`<li>${b}</li>`) : html`<li>暫無明確風險訊號</li>`}</ul></div>
      </div></div>`;
  };

  const personasHTML = () => {
    const ps = (s && s.agents && s.agents.personas) || [];
    if (!ps.length) return '';
    const tones = ps.map(p => voteTone(p.vote));
    const nb = tones.filter(t => t === 'bull').length;
    const ns = tones.filter(t => t === 'bear').length;
    const nn = ps.length - nb - ns;
    return html`<div class="card o11 pro-only"><div class="card-hd"><div class="card-title">${icon('users')} 六大流派圓桌投票</div><span class="card-sub"><span class="up">偏多 ${nb}</span>・中性 ${nn}・<span class="down">偏空 ${ns}</span></span></div>
      <div class="vote-bar"><i style="width:${(nb / ps.length) * 100}%;background:var(--up)"></i><i style="width:${(nn / ps.length) * 100}%;background:var(--surface-4)"></i><i style="width:${(ns / ps.length) * 100}%;background:var(--down)"></i></div>
      <div class="personas">${ps.map((p, i) => html`<div class="persona"><div class="persona-hd"><span class="persona-name">${p.name}</span><span class="persona-vote ${tones[i]}">${p.vote}</span></div><p>${p.reason}</p></div>`)}</div></div>`;
  };

  const calcHTML = () => {
    const pos = store.getPosition(code) || {};
    return html`<div class="card o12"><div class="card-hd"><div class="card-title">${icon('calculator')} 持倉損益試算</div><span class="card-sub">自動記住每檔成本</span></div>
      <div class="calc">
        <div class="calc-inputs">
          <div class="field"><label for="c-cost">成交均價</label><input id="c-cost" class="input num" type="number" inputmode="decimal" step="0.01" min="0" placeholder="元" value="${pos.cost || ''}" data-calc /></div>
          <div class="field"><label for="c-lots">張數</label><input id="c-lots" class="input num" type="number" inputmode="decimal" step="0.001" min="0" value="${pos.lots || 1}" data-calc /></div>
          <div class="field"><label for="c-dir">方向</label><select id="c-dir" class="input" data-calc><option value="LONG" ${pos.direction !== 'SHORT' ? 'selected' : ''}>做多</option><option value="SHORT" ${pos.direction === 'SHORT' ? 'selected' : ''}>做空</option></select></div>
        </div>
        <div data-calc-out></div>
      </div></div>`;
  };
  const calcOutHTML = () => {
    const cost = parseFloat($('#c-cost', root)?.value);
    const lots = parseFloat($('#c-lots', root)?.value) || 1;
    const dir = $('#c-dir', root)?.value || 'LONG';
    const p = px(code);
    if (!(cost > 0) || !p) return html`<div class="muted" style="font-size:12.5px">輸入成交均價即可即時試算帳面損益，並依 AI 策略給出停損 / 停利建議（零股可填 0.1 張）。</div>`;
    const isLong = dir === 'LONG';
    const diff = isLong ? p.price - cost : cost - p.price;
    const pnl = Math.round(diff * lots * 1000);
    const pct = (diff / cost) * 100;
    const plan = planOf(s, isLong ? (mode === 'short_sell' ? 'swing' : mode) : 'short_sell');
    let advice = '';
    if (plan) {
      if (isLong) advice = p.price <= plan.stop_loss ? `已跌破停損價 ${fmtPrice(plan.stop_loss)}，建議依紀律減碼，切勿向下攤平。` : pct >= 8 ? `獲利 ${fmtPct(pct)}，可先分批入袋 1/3～1/2，其餘停損上移至成本 ${fmtPrice(cost)}。` : `守住停損 ${fmtPrice(plan.stop_loss)} 之上可續抱，目標 ${fmtPrice(plan.target_price)}。`;
      else advice = p.price >= plan.stop_loss ? `已突破回補停損價 ${fmtPrice(plan.stop_loss)}，建議立即回補，勿硬凹空單。` : pct >= 6 ? `空單獲利 ${fmtPct(pct)}，可於急跌時分批回補，回補線下移至成本 ${fmtPrice(cost)}。` : `未突破回補價 ${fmtPrice(plan.stop_loss)} 可續抱，目標下看 ${fmtPrice(plan.target_price)}。`;
    }
    return html`<div class="calc-out"><img src="${pnl >= 0 ? IMG.money : IMG.cry}" alt="" /><div><div class="big ${dirOf(pnl)}">${pnl >= 0 ? '+' : ''}${fmtInt(pnl)} 元 <span style="font-size:14px">${fmtPct(pct)}</span></div><p>現價 ${fmtPrice(p.price)} vs 成本 ${fmtPrice(cost)}・${lots} 張${isLong ? '' : '（做空）'}${advice ? html`<br/>${advice}` : ''}</p></div></div>`;
  };

  const newsHTML = () => html`<div class="card o13"><div class="card-hd"><div class="card-title">${icon('news')} ${nameOf(code)} 相關新聞</div><span class="card-sub">近 7 日・新→舊</span></div><div class="news-list" data-news>${raw(String(html`<div class="row" style="cursor:default"><div class="row-main"><span class="skel" style="width:90%;height:14px"></span><span class="skel" style="width:40%;height:11px;margin-top:6px"></span></div></div>`).repeat(3))}</div></div>`;

  const linksHTML = () => {
    const tv = `https://www.tradingview.com/symbols/${(R.stocks[code]?.market || (R.dir[code] && R.dir[code][1])) === 'TPEx' ? 'TPEX' : 'TWSE'}-${code}/`;
    const links = [
      ['Yahoo 股市', `https://tw.stock.yahoo.com/quote/${code}`],
      ['鉅亨網個股', `https://www.cnyes.com/twstock/${code}`],
      ['Goodinfo!', `https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID=${code}`],
      ['TradingView', tv],
    ];
    return html`<div class="card o14"><div class="card-hd"><div class="card-title">${icon('external')} 外部資訊</div></div><div class="links-row">${links.map(([l, u]) => html`<a class="ext-link" href="${u}" target="_blank" rel="noopener noreferrer"><span>${l}</span>${icon('external', 'ic-sm')}</a>`)}</div></div>`;
  };

  /* ---------- 繪製 ---------- */
  const paint = () => {
    s = R.stocks[code] || null;
    setHTML(root, html`${headHTML()}
      <div class="stock-layout">
        <div class="col">${heroHTML()}${chartHTML()}${planHTML()}${pnlHTML()}${debateHTML()}</div>
        <div class="col">${verdictHTML()}${advisorHTML()}${chipsHTML()}${techHTML()}${personasHTML()}${calcHTML()}${newsHTML()}${linksHTML()}</div>
      </div>
      <p class="disclaimer">AI 策略由程式依公開籌碼與技術資料自動產生，僅供研究參考，不構成投資建議；請自行評估風險並嚴設停損。</p>`);
    setHTML($('[data-calc-out]', root), calcOutHTML());
    setHTML($('[data-chart-foot]', root), footHTML());
    const hero = $('[data-hero-px]', root);
    const head = $('[data-sh]', root);
    io && io.disconnect();
    if (hero && head && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([en]) => head.classList.toggle('compact', !en.isIntersecting), { rootMargin: '-110px 0px 0px 0px' });
      io.observe(hero);
    }
    mountChart();
    loadNews();
    ensureTech();
  };

  const notFound = () => setHTML(root, html`${headHTML()}${emptyState({ img: IMG.cry, title: `查無代號 ${code}`, text: '請確認輸入的是 4～6 碼上市櫃股票或 ETF 代號。', actions: html`<button class="btn btn-primary" data-go="market">回到市場</button>` })}`);

  /* ---------- 走勢圖 ---------- */
  const legend = info => {
    const el = $('[data-legend]', root);
    if (!el) return;
    if (!info) { el.textContent = ''; return; }
    if (info.mode === 'intraday') {
      const pct = pctFrom(info.price, info.prevClose);
      setHTML(el, html`<span><b>${info.time}</b></span><span>成交 <b class="${dirOf(pct)}">${fmtPrice(info.price)}</b></span>${pct != null ? html`<span class="${dirOf(pct)}">${fmtPct(pct)}</span>` : ''}`);
      return;
    }
    const b = info.bar;
    const pct = pctFrom(b.close, info.prev);
    const fma = v => { const d = Math.abs(v) >= 500 ? 1 : 2; return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
    setHTML(el, html`<span><b>${mdOf(b.time)}</b></span><span>開 <b>${fmtPrice(b.open)}</b></span><span>高 <b>${fmtPrice(b.high)}</b></span><span>低 <b>${fmtPrice(b.low)}</b></span><span>收 <b class="${dirOf(pct)}">${fmtPrice(b.close)}</b></span>${pct != null ? html`<span class="${dirOf(pct)}">${fmtPct(pct)}</span>` : ''}<span>量 <b>${fmtVol(b.volume)}</b></span>${info.ma5 ? html`<span class="lg-ma5">MA5 ${fma(info.ma5)}</span>` : ''}${info.ma20 ? html`<span class="lg-ma20">MA20 ${fma(info.ma20)}</span>` : ''}${info.ma60 ? html`<span class="lg-ma60">MA60 ${fma(info.ma60)}</span>` : ''}`);
  };
  const chartState = msg => {
    const box = $('[data-chart]', root);
    if (!box) return;
    let st = box.querySelector('.chart-state');
    if (!msg) { st && st.remove(); return; }
    if (!st) { st = document.createElement('div'); st.className = 'chart-state'; box.appendChild(st); }
    st.textContent = msg;
  };
  const waitLWC = async () => {
    for (let i = 0; i < 50 && !window.LightweightCharts; i++) await new Promise(r => setTimeout(r, 100));
    return Boolean(window.LightweightCharts);
  };
  async function mountChart() {
    const box = $('[data-chart]', root);
    if (!box) return;
    if (!(await waitLWC()) || destroyed) { chartState('圖表元件載入失敗，請重新整理'); return; }
    chart && chart.destroy();
    chart = new PriceChart(box, { onHover: legend });
    await drawRange(true);
  }
  async function drawRange(initial = false) {
    if (!chart || destroyed) return;
    const plan = planOf(s, mode);
    try {
      if (range === 'I') {
        chartState(initial ? '分時走勢載入中…' : '');
        const r = await fetchIntraday(code);
        if (destroyed || range !== 'I') return;
        if (!r || !r.points.length) { chartState('今日尚無分時資料'); return; }
        intra = r;
        const p = px(code);
        const prev = (r.quote && r.quote.prev) || (p && p.prev);
        const lastDate = tpeDate(r.points[r.points.length - 1].t);
        chart.setIntraday(r.points, { prevClose: prev, live: phaseNow().live && lastDate === tpeDate() });
        chartState('');
      } else {
        chartState(bars ? '' : 'K 線載入中…');
        const days = range === 'W' ? 520 : 220;
        const raw0 = await fetchDaily(code, days);
        if (destroyed || range === 'I') return;
        bars = withLiveBar(raw0, code);
        if (!bars.length) { chartState('查無 K 線資料'); return; }
        const series = range === 'W' ? toWeekly(bars) : bars;
        chart.setBars(series, { plan, short: plan && plan.short, showPlan: Boolean(s) && store.getSetting('showPlanLines'), weekly: range === 'W' });
        chartState('');
      }
    } catch (e) {
      chartState('走勢資料暫時無法取得');
    }
    setHTML($('[data-chart-foot]', root), footHTML());
  }

  /* ---------- 技術指標（以最新日 K 即時計算，含今日 K 棒） ---------- */
  const replaceCard = (sel, tpl) => {
    const el = root.querySelector(sel);
    if (!el) return;
    const tmp = document.createElement('div');
    setHTML(tmp, tpl);
    if (tmp.firstElementChild) el.replaceWith(tmp.firstElementChild);
  };
  async function ensureTech() {
    try {
      const b = withLiveBar(await fetchDaily(code, 220), code);
      if (destroyed || b.length < 20) return;
      liteTech = calcTech(b);
      techDate = b[b.length - 1].time;
      replaceCard('.o8', techHTML());
      if (!s) replaceCard('.o3', verdictHTML());
    } catch (e) { /* 沿用 AI 報告數值 */ }
  }

  /* ---------- 新聞 ---------- */
  async function loadNews() {
    const box = $('[data-news]', root);
    if (!box) return;
    try {
      const list = await fetchStockNews(code);
      if (destroyed || !box.isConnected) return;
      setHTML(box, list.length ? html`${list.slice(0, 10).map(n => newsItem(n, { showTags: false }))}` : html`<div class="card-body muted" style="font-size:13px;padding-top:4px">近 7 日沒有 ${nameOf(code)} 的重大新聞。可至下方 Yahoo / 鉅亨個股頁查看歷史公告。</div>`);
    } catch (e) {
      setHTML(box, html`<div class="card-body muted" style="font-size:13px">新聞來源暫時無法連線。</div>`);
    }
  }

  /* ---------- 互動 ---------- */
  const switchMode = m => {
    if (!s || m === mode) return;
    mode = m;
    $$('[data-mode]', root).forEach(b => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-selected', String(b.dataset.mode === mode)); });
    setHTML($('[data-plan-body]', root), planBodyHTML());
    const adv = root.querySelector('.advisor-card');
    if (adv) { const tmp = document.createElement('div'); setHTML(tmp, advisorHTML()); adv.replaceWith(tmp.firstElementChild); }
    if (chart && range !== 'I' && bars) {
      const plan = planOf(s, mode);
      chart.setPlan(plan, store.getSetting('showPlanLines'));
    }
    setHTML($('[data-chart-foot]', root), footHTML());
    setHTML($('[data-calc-out]', root), calcOutHTML());
    history.replaceState(null, '', `#/stock/${code}?mode=${mode}`);
  };
  root.addEventListener('click', e => {
    if (e.target.closest('[data-back]')) { bus.emit('back'); return; }
    if (e.target.closest('[data-share]')) {
      const p = px(code);
      const url = `${location.origin}${location.pathname.replace(/index\.html$/, '')}#/stock/${code}`;
      const text = `${nameOf(code)}（${code}）${p ? `${fmtPrice(p.price)} ${fmtPct(p.pct)}` : ''}｜StockYuan 台股 AI`;
      if (navigator.share) navigator.share({ title: `${nameOf(code)} ${code}`, text, url }).catch(() => {});
      else copyText(`${text}\n${url}`).then(ok => toast(ok ? '已複製個股連結' : '複製失敗', { type: ok ? 'success' : 'error' }));
      return;
    }
    const r = e.target.closest('[data-range]');
    if (r && r.dataset.range !== range) {
      range = r.dataset.range;
      store.setSetting('chartRange', range);
      $$('[data-range]', root).forEach(b => { b.classList.toggle('on', b.dataset.range === range); b.setAttribute('aria-selected', String(b.dataset.range === range)); });
      drawRange();
      return;
    }
    if (e.target.closest('[data-planlines]')) {
      const on = !store.getSetting('showPlanLines');
      store.setSetting('showPlanLines', on);
      e.target.closest('[data-planlines]').classList.toggle('on', on);
      if (chart && range !== 'I') chart.setPlan(planOf(s, mode), on);
      setHTML($('[data-chart-foot]', root), footHTML());
      return;
    }
    const m = e.target.closest('[data-mode]');
    if (m) { switchMode(m.dataset.mode); return; }
    const mp = e.target.closest('[data-mode-pick]');
    if (mp) { switchMode(mp.dataset.modePick); $('.o4', root)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  root.addEventListener('input', e => {
    if (!e.target.matches('[data-calc]')) return;
    const cost = parseFloat($('#c-cost', root).value);
    const lots = parseFloat($('#c-lots', root).value) || 1;
    const direction = $('#c-dir', root).value;
    store.setPosition(code, cost > 0 ? { cost, lots, direction } : null);
    setHTML($('[data-calc-out]', root), calcOutHTML());
  });

  /* ---------- 啟動 ---------- */
  if (known()) paint();
  else setHTML(root, html`${headHTML()}<div class="card card-pad" style="margin-top:8px"><span class="skel" style="height:120px"></span></div>`);
  refreshQuotes().then(() => {
    if (destroyed) return;
    if (!known()) { notFound(); return; }
    if (!root.querySelector('.stock-layout')) paint();
  });

  // 盤中分時自動更新
  timers.push(setInterval(() => {
    if (destroyed || document.visibilityState !== 'visible' || !phaseNow().live) return;
    if (range === 'I') drawRange();
  }, 30e3));

  return {
    onQuotes(changed) {
      if (!root.querySelector('.stock-layout')) return;
      paintQuotes(changed);
      if (changed && !changed.includes(code)) return;
      const dyn = $('[data-hero-dyn]', root);
      if (dyn) setHTML(dyn, heroDynHTML());
      const pnl = $('[data-pnl]', root);
      if (pnl) setHTML(pnl, pnlBodyHTML());
      const pb = $('[data-plan-body]', root);
      if (pb) setHTML(pb, planBodyHTML());
      setHTML($('[data-calc-out]', root), calcOutHTML());
      if (chart && bars && range !== 'I' && Q[code]) {
        const nb = withLiveBar(bars, code);
        const last = nb[nb.length - 1];
        if (range === 'D') chart.updateLastBar(last);
        bars = nb;
      }
    },
    onReport: paint,
    destroy() {
      destroyed = true;
      timers.forEach(clearInterval);
      io && io.disconnect();
      chart && chart.destroy();
    },
  };
}
