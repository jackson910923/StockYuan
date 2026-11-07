// StockYuan 走勢圖（TradingView Lightweight Charts v4）+ 前端技術指標
import { bus, fmtPrice, fmtVol, isNum, tpeTime } from './util.js';

const LWC = () => window.LightweightCharts;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const TPE_SHIFT = 8 * 3600; // 分時：把 UTC 秒數平移 +8h，讓座標軸直接顯示台北時間

function palette() {
  return {
    text: css('--text-3') || '#6f788b',
    grid: css('--chart-grid') || 'rgba(255,255,255,.04)',
    up: css('--up') || '#ff5268',
    down: css('--down') || '#1dcf87',
    upA: css('--up-a') || 'rgba(255,82,104,.42)',
    downA: css('--down-a') || 'rgba(29,207,135,.42)',
    upRGB: css('--up-rgb') || '255, 82, 104',
    downRGB: css('--down-rgb') || '29, 207, 135',
    brand: css('--brand') || '#8b7cff',
    ma5: css('--ma5') || '#f6bd45',
    ma20: css('--ma20') || '#8b7cff',
    ma60: css('--ma60') || '#22d3ee',
    gold: css('--gold') || '#f6bd45',
    violet: css('--violet') || '#b590ff',
    green: css('--green') || '#22c55e',
    danger: css('--danger') || '#ff5a6e',
    surface: css('--surface-4') || '#1e2533',
    font: css('--font') || 'Inter, sans-serif',
  };
}

export const sma = (vals, n) => vals.map((_, i) => (i + 1 >= n ? vals.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : null));

export class PriceChart {
  constructor(el, { onHover = null } = {}) {
    this.el = el;
    this.onHover = onHover;
    this.lines = [];
    this.mode = null;
    this.data = [];
    const c = (this.c = palette());
    this.chart = LWC().createChart(el, {
      width: el.clientWidth || 320,
      height: el.clientHeight || 300,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: c.text, fontFamily: c.font, fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.24 } },
      timeScale: { borderVisible: false, rightOffset: 3, barSpacing: 7, minBarSpacing: 2, fixLeftEdge: false, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: 1, vertLine: { color: c.text, width: 1, style: 3, labelBackgroundColor: c.surface }, horzLine: { color: c.text, width: 1, style: 3, labelBackgroundColor: c.surface } },
      localization: { locale: 'zh-TW', priceFormatter: p => fmtPrice(p) },
      handleScroll: { vertTouchDrag: false },
      kineticScroll: { touch: true, mouse: false },
    });
    this.candle = this.chart.addCandlestickSeries({ upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down, priceLineWidth: 1 });
    this.vol = this.chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
    const ln = color => this.chart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.ma5 = ln(c.ma5);
    this.ma20 = ln(c.ma20);
    this.ma60 = ln(c.ma60);
    this.base = this.chart.addBaselineSeries({
      baseValue: { type: 'price', price: 0 },
      lineWidth: 2,
      priceLineVisible: false,
      // 縱軸永遠包含昨收，讓「高於/低於昨收」一眼可見
      autoscaleInfoProvider: original => {
        const res = original();
        if (res && res.priceRange && isNum(this.prevClose)) {
          res.priceRange.minValue = Math.min(res.priceRange.minValue, this.prevClose);
          res.priceRange.maxValue = Math.max(res.priceRange.maxValue, this.prevClose);
        }
        return res;
      },
      topLineColor: c.up,
      bottomLineColor: c.down,
      topFillColor1: `rgba(${c.upRGB}, .26)`,
      topFillColor2: `rgba(${c.upRGB}, .02)`,
      bottomFillColor1: `rgba(${c.downRGB}, .02)`,
      bottomFillColor2: `rgba(${c.downRGB}, .26)`,
    });
    this.chart.subscribeCrosshairMove(p => this._hover(p));
    this.ro = new ResizeObserver(entries => {
      const r = entries[0] && entries[0].contentRect;
      if (r && r.width > 50) this.chart.applyOptions({ width: Math.floor(r.width), height: Math.floor(r.height) || 300 });
    });
    this.ro.observe(el);
    this.offTheme = bus.on('theme', () => this.retheme());
  }

  retheme() {
    const c = (this.c = palette());
    this.chart.applyOptions({ layout: { textColor: c.text }, grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } } });
    this.candle.applyOptions({ upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    this.ma5.applyOptions({ color: c.ma5 });
    this.ma20.applyOptions({ color: c.ma20 });
    this.ma60.applyOptions({ color: c.ma60 });
    this.base.applyOptions({ topLineColor: c.up, bottomLineColor: c.down, topFillColor1: `rgba(${c.upRGB}, .26)`, topFillColor2: `rgba(${c.upRGB}, .02)`, bottomFillColor1: `rgba(${c.downRGB}, .02)`, bottomFillColor2: `rgba(${c.downRGB}, .26)` });
    if (this.mode && this._last) this.mode === 'intraday' ? this.setIntraday(...this._last) : this.setBars(...this._last);
  }

  _clearLines() {
    this.lines.forEach(([s, l]) => { try { s.removePriceLine(l); } catch (e) { /* ignore */ } });
    this.lines = [];
  }
  _line(series, price, color, title, style = 2, width = 1) {
    if (!isNum(Number(price)) || !(Number(price) > 0)) return;
    this.lines.push([series, series.createPriceLine({ price: Number(price), color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title })]);
  }

  /** 日 K / 週 K：K 棒 + 量 + 均線 + AI 策略價位線 */
  setBars(bars, { plan = null, short = false, showPlan = true, weekly = false } = {}) {
    this._last = [bars, { plan, short, showPlan, weekly }];
    this.mode = weekly ? 'weekly' : 'daily';
    const c = this.c;
    this.data = bars;
    this.base.setData([]);
    this.chart.applyOptions({ timeScale: { timeVisible: false, barSpacing: weekly ? 9 : 7 }, rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.24 } } });
    this.candle.setData(bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    this.vol.setData(bars.map(b => ({ time: b.time, value: b.volume || 0, color: b.close >= b.open ? c.upA : c.downA })));
    const closes = bars.map(b => b.close);
    const toLine = arr => arr.map((v, i) => (v == null ? { time: bars[i].time } : { time: bars[i].time, value: +v.toFixed(2) }));
    this.maData = { ma5: sma(closes, 5), ma20: sma(closes, 20), ma60: sma(closes, 60) };
    this.ma5.setData(toLine(this.maData.ma5));
    this.ma20.setData(toLine(this.maData.ma20));
    this.ma60.setData(toLine(this.maData.ma60));
    this._clearLines();
    if (plan && showPlan) {
      const zone = short ? c.violet : c.green;
      this._line(this.candle, plan.entry_high, zone, short ? '空點上緣' : '買區上緣');
      this._line(this.candle, plan.entry_low, zone, short ? '空點下緣' : '買區下緣');
      this._line(this.candle, plan.stop_loss, c.danger, short ? '回補停損' : '停損', 0, 1);
      this._line(this.candle, plan.target_price, c.gold, '目標');
    }
    const n = bars.length;
    const show = weekly ? 60 : 75;
    if (n > show) this.chart.timeScale().setVisibleLogicalRange({ from: n - show, to: n + 2 });
    else this.chart.timeScale().fitContent();
    this._hover({});
  }

  /** 只重畫策略價位線（切換劇本時不重設縮放） */
  setPlan(plan, showPlan = true) {
    if (this.mode === 'intraday') return;
    const c = this.c;
    this._clearLines();
    if (this._last) this._last[1] = { ...this._last[1], plan, short: plan && plan.short, showPlan };
    if (!plan || !showPlan) return;
    const zone = plan.short ? c.violet : c.green;
    this._line(this.candle, plan.entry_high, zone, plan.short ? '空點上緣' : '買區上緣');
    this._line(this.candle, plan.entry_low, zone, plan.short ? '空點下緣' : '買區下緣');
    this._line(this.candle, plan.stop_loss, c.danger, plan.short ? '回補停損' : '停損', 0, 1);
    this._line(this.candle, plan.target_price, c.gold, '目標');
  }

  /** 盤中即時更新最後一根日 K（不重設縮放） */
  updateLastBar(bar) {
    if (this.mode !== 'daily' || !bar || !this.data.length) return;
    const last = this.data[this.data.length - 1];
    if (bar.time < last.time) return;
    if (bar.time === last.time) this.data[this.data.length - 1] = bar;
    else this.data.push(bar);
    const c = this.c;
    try {
      this.candle.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      this.vol.update({ time: bar.time, value: bar.volume || 0, color: bar.close >= bar.open ? c.upA : c.downA });
    } catch (e) { /* ignore */ }
    this._hover({});
  }

  /** 分時：以昨收為基準線的漲跌雙色面積圖 + 每分鐘量 */
  setIntraday(points, { prevClose = null, live = false } = {}) {
    this._last = [points, { prevClose, live }];
    this.mode = 'intraday';
    const c = this.c;
    this.prevClose = prevClose;
    this.candle.setData([]);
    this.ma5.setData([]);
    this.ma20.setData([]);
    this.ma60.setData([]);
    this._clearLines();
    this.chart.applyOptions({ timeScale: { timeVisible: true, secondsVisible: false, barSpacing: 3 }, rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.22 } } });
    const base = isNum(prevClose) ? prevClose : points.length ? points[0].o : 0;
    this.base.applyOptions({ baseValue: { type: 'price', price: base } });
    const seen = new Set();
    const data = [];
    const vol = [];
    let last = base;
    for (const p of points) {
      const t = Math.floor(p.t / 1000) + TPE_SHIFT;
      if (seen.has(t)) continue;
      seen.add(t);
      data.push({ time: t, value: p.c });
      vol.push({ time: t, value: p.v || 0, color: p.c >= last ? c.upA : c.downA });
      last = p.c;
    }
    // 盤中：補滿至 13:30 的空白時間，讓走勢依交易時段比例呈現
    if (live && data.length) {
      const lastT = data[data.length - 1].time;
      const dayStart = lastT - (lastT % 86400);
      const close = dayStart + 13 * 3600 + 30 * 60;
      for (let t = lastT + 60; t <= close; t += 60) data.push({ time: t });
    }
    this.data = data;
    this.base.setData(data);
    this.vol.setData(vol);
    if (isNum(prevClose)) this._line(this.base, prevClose, c.text, '昨收', 2, 1);
    this.chart.timeScale().fitContent();
    this._hover({});
  }

  _hover(p) {
    if (!this.onHover) return;
    if (this.mode === 'intraday') {
      const d = p && p.seriesData ? p.seriesData.get(this.base) : null;
      const pt = d && isNum(d.value) ? d : [...this.data].reverse().find(x => isNum(x.value));
      if (!pt) return this.onHover(null);
      this.onHover({ mode: 'intraday', time: tpeTime((pt.time - TPE_SHIFT) * 1000), price: pt.value, prevClose: this.prevClose });
    } else {
      const d = p && p.seriesData ? p.seriesData.get(this.candle) : null;
      let idx = -1;
      if (d && isNum(d.close)) {
        const t = d.time && typeof d.time === 'object'
          ? `${d.time.year}-${String(d.time.month).padStart(2, '0')}-${String(d.time.day).padStart(2, '0')}`
          : d.time;
        idx = this.data.findIndex(b => b.time === t);
      }
      if (idx < 0) idx = this.data.length - 1;
      const bar = this.data[idx];
      if (!bar) return this.onHover(null);
      const prev = idx > 0 ? this.data[idx - 1].close : null;
      const m = this.maData || {};
      const at = arr => (arr && isNum(arr[idx]) ? arr[idx] : null);
      this.onHover({ mode: this.mode, bar, prev, ma5: at(m.ma5), ma20: at(m.ma20), ma60: at(m.ma60) });
    }
  }

  destroy() {
    try { this.ro.disconnect(); } catch (e) { /* ignore */ }
    this.offTheme && this.offTheme();
    try { this.chart.remove(); } catch (e) { /* ignore */ }
  }
}

/** 日 K → 週 K */
export function toWeekly(bars) {
  const out = [];
  let cur = null;
  let key = null;
  for (const b of bars) {
    const d = new Date(`${b.time}T00:00:00Z`);
    const dow = d.getUTCDay() || 7;
    const monday = new Date(d.getTime() - (dow - 1) * 86400e3).toISOString().slice(0, 10);
    if (monday !== key) {
      if (cur) out.push(cur);
      key = monday;
      cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 前端技術指標（與後端 compute_technical_indicators 同口徑），供非 AI 會診個股使用 */
export function calcTech(bars) {
  if (!bars || bars.length < 5) return null;
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const last = closes[closes.length - 1];
  const avg = (arr, n) => { const s = arr.slice(-n); return s.reduce((a, b) => a + b, 0) / s.length; };
  const ma5 = avg(closes, 5);
  const ma10 = avg(closes, 10);
  const ma20 = avg(closes, 20);
  const ma60 = avg(closes, 60);
  const g = [];
  const l = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g.push(Math.max(0, d));
    l.push(Math.max(0, -d));
  }
  const n = Math.min(14, g.length);
  const ag = g.slice(-n).reduce((a, b) => a + b, 0) / n;
  const al = l.slice(-n).reduce((a, b) => a + b, 0) / n;
  const rsi14 = al === 0 ? 85 : 100 - 100 / (1 + ag / al);
  let k = 50;
  let d = 50;
  for (let i = 0; i < closes.length; i++) {
    const s = Math.max(0, i - 8);
    const h9 = Math.max(...highs.slice(s, i + 1));
    const l9 = Math.min(...lows.slice(s, i + 1));
    const rsv = h9 - l9 > 1e-6 ? ((closes[i] - l9) / (h9 - l9)) * 100 : 50;
    k = (2 / 3) * k + rsv / 3;
    d = (2 / 3) * d + k / 3;
  }
  const ema = (arr, span) => { const a = 2 / (span + 1); const o = [arr[0]]; for (let i = 1; i < arr.length; i++) o.push(a * arr[i] + (1 - a) * o[i - 1]); return o; };
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const dif = e12.map((v, i) => v - e26[i]);
  const dea = ema(dif, 9);
  const hist = dif[dif.length - 1] - dea[dea.length - 1];
  const prevHist = dif.length > 1 ? dif[dif.length - 2] - dea[dea.length - 2] : 0;
  const sub = closes.slice(-20);
  const mean = sub.reduce((a, b) => a + b, 0) / sub.length;
  const std = Math.sqrt(sub.reduce((a, b) => a + (b - mean) ** 2, 0) / sub.length);
  const bbU = mean + 2 * std;
  const bbL = Math.max(0.01, mean - 2 * std);
  const trs = bars.slice(1).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - bars[i].close), Math.abs(b.low - bars[i].close)));
  const atr = trs.length ? trs.slice(-14).reduce((a, b) => a + b, 0) / Math.min(14, trs.length) : last * 0.02;
  const r2 = v => +v.toFixed(2);
  return {
    ma5: r2(ma5), ma10: r2(ma10), ma20: r2(ma20), ma60: r2(ma60),
    rsi14: +rsi14.toFixed(1), k9: +k.toFixed(1), d9: +d.toFixed(1),
    kd_signal: k >= 80 ? '高檔鈍化' : k <= 20 ? '低檔超賣' : k >= d ? '多方排列' : '空方修正',
    macd_hist: r2(hist),
    macd_signal: hist > 0 && prevHist <= 0 ? '柱狀翻紅' : hist > 0 ? '紅柱延續' : hist > prevHist ? '綠柱收斂' : '綠柱擴大',
    bb_upper: r2(bbU), bb_lower: r2(bbL), bb_pct: +(((last - bbL) / Math.max(0.01, bbU - bbL)) * 100).toFixed(1),
    support_20d: r2(Math.min(...lows.slice(-20))), resistance_20d: r2(Math.max(...highs.slice(-20))),
    atr14: r2(atr),
  };
}

export const volText = v => fmtVol(v);
