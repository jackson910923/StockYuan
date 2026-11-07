// StockYuan 資料層：AI 報告、即時報價（鉅亨 CORS）、分時/日 K、即時新聞
import { bus, cleanName, decodeEntities, fetchJSON, isNum, marketPhase, memo, num, parseTpe, tpe, tpeDate } from './util.js';
import { getSetting, isValidCode, setDefaultWatchlist, watchCodes } from './store.js';

const REPORT_URL = './data/latest_report.json';
const QUOTE_API = 'https://ws.api.cnyes.com/ws/api/v1/quote/quotes/';
const CHART_API = 'https://ws.api.cnyes.com/ws/api/v1/charting/history';
const NEWS_API = 'https://ess.api.cnyes.com/ess/api/v1/news/keyword';
const FINMIND_API = 'https://api.finmindtrade.com/api/v4/data';

/* =====================================================================
 * AI 報告
 * ===================================================================== */
export const R = {
  loaded: false,
  asOf: '',
  generatedAt: '',
  stocks: {},
  dir: {},
  lists: {},
  klines: {},
  sectors: [],
  summary: {},
  headlines: [],
  track: null,
  trackHistory: [],
  briefing: '',
  etag: null,
};

export const LIST_META = {
  top: { label: '綜合嚴選', short: '綜合', desc: '籌碼 × 趨勢 × 風控總分最高', score: 'total_score', mode: 'swing', tone: 'brand' },
  short_term: { label: '短線衝刺', short: '短線', desc: '1～5 日・爆量突破與法人點火', score: 'short_term_score', mode: 'short_term', tone: 'gold' },
  swing: { label: '波段操作', short: '波段', desc: '2～8 週・法人連買初升段', score: 'swing_score', mode: 'swing', tone: 'cyan' },
  long_term: { label: '長線存股', short: '長線', desc: '季/年・護城河與高息穩健', score: 'long_term_score', mode: 'long_term', tone: 'green' },
  high: { label: '高價股', short: '高價', desc: '200 元以上・權值成長', score: 'total_score', mode: 'swing', tone: 'sky' },
  mid: { label: '中價股', short: '中價', desc: '50～200 元・主流中堅', score: 'total_score', mode: 'swing', tone: 'teal' },
  low: { label: '銅板股', short: '銅板', desc: '50 元以下・小資親民', score: 'total_score', mode: 'swing', tone: 'amber' },
  short_sell: { label: '做空避險', short: '做空', desc: '法人連賣破線・融資套牢', score: 'short_sell_score', mode: 'short_sell', tone: 'violet' },
};

function normNews(n) {
  if (!n || !n.title) return null;
  let ts = num(n.ts);
  if (ts && ts < 1e12) ts *= 1000;
  if (!ts) ts = parseTpe(n.pub_date);
  let title = decodeEntities(String(n.title).replace(/<[^>]+>/g, '')).trim();
  let source = n.source || '財經新聞';
  if (title.includes('股市爆料同學會') || source === 'CMoney') {
    title = title.replace(/\s*-?\s*股市爆料同學會\s*$/, '').replace(/^\s*[0-9A-Z]{4,6}\s*\S+\s*-\s*/, '').trim();
    if (/股市爆料同學會/.test(n.title)) source = 'CMoney 論壇';
  }
  return {
    id: n.id || n.link,
    title,
    link: n.link,
    source,
    ts,
    summary: decodeEntities(n.summary || '').replace(/\s+/g, ' ').trim(),
    image: n.image || null,
    stocks: Array.isArray(n.stocks) ? n.stocks.map(String) : [],
    tags: n.tags || [],
  };
}

function normalizeReport(raw) {
  R.asOf = raw.as_of_date || '';
  R.generatedAt = raw.generated_at || '';
  const stocks = {};
  for (const [code, d] of Object.entries(raw.all_debates || {})) {
    if (!d) continue;
    d.code = d.code || code;
    d.name = cleanName(d.name);
    const ye = d.yesterday_eval;
    // 防呆：舊版管線同日重跑會把「今日分數」寫成昨日，前端一律視為無效
    if (ye && ye.has_data && !(String(ye.as_of_date || '') < R.asOf)) d.yesterday_eval = { ...ye, has_data: false, invalid: true };
    d.news = (d.news || []).map(normNews).filter(Boolean);
    stocks[d.code] = d;
  }
  R.stocks = stocks;
  const codes = key => (raw[key] || []).map(x => (typeof x === 'string' ? x : x && x.code)).filter(c => c && stocks[c]);
  R.lists = {
    top: codes('top_picks_debates'),
    short_term: codes('short_term_debates'),
    swing: codes('swing_debates'),
    long_term: codes('long_term_debates'),
    high: codes('high_price_debates'),
    mid: codes('mid_price_debates'),
    low: codes('low_price_debates'),
    short_sell: codes('short_sell_debates'),
    cobuy: codes('co_buy_debates'),
    hot: codes('volume_hot_debates'),
  };
  R.dir = raw.market_directory || {};
  R.klines = raw.klines || {};
  R.sectors = raw.sector_heatmap || [];
  R.summary = raw.market_summary || {};
  R.headlines = (raw.headline_news || []).map(normNews).filter(Boolean).sort((a, b) => b.ts - a.ts);
  R.track = raw.track_record || null;
  R.trackHistory = raw.track_history || [];
  R.briefing = raw.family_briefing_text || '';
  setDefaultWatchlist(raw.watchlist_codes || []);
  buildIndex();
  R.loaded = true;
}

export async function loadReport() {
  const resp = await fetch(REPORT_URL, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  R.etag = resp.headers.get('etag') || resp.headers.get('last-modified');
  normalizeReport(await resp.json());
  return R;
}

/** 輕量檢查（HEAD）AI 報告是否已由排程更新；有更新才重新下載 */
export async function checkReportUpdate() {
  try {
    const head = await fetch(REPORT_URL, { method: 'HEAD', cache: 'no-store' });
    const tag = head.headers.get('etag') || head.headers.get('last-modified');
    if (!tag || tag === R.etag) return false;
    const prevGen = R.generatedAt;
    await loadReport();
    if (R.generatedAt !== prevGen) {
      bus.emit('report');
      return true;
    }
  } catch (e) { /* 離線 */ }
  return false;
}

/* ---------- 全市場字典 ---------- */
export function dirEntry(code) {
  const a = R.dir[code];
  if (!a) return null;
  const close = +a[2];
  return {
    code,
    name: cleanName(a[0]),
    market: a[1],
    close,
    pct: +a[3] || 0,
    f: +a[4] || 0,
    t: +a[5] || 0,
    d: +a[6] || 0,
    margin: +a[7] || 0,
    dt: +a[8] || 0,
    open: +a[9] || close,
    high: +a[10] || close,
    low: +a[11] || close,
    vol: a[12] != null ? +a[12] : null,
  };
}
export function nameOf(code) {
  return R.stocks[code]?.name || (R.dir[code] ? cleanName(R.dir[code][0]) : '') || Q[code]?.name || code;
}
export function marketOf(code) {
  const m = R.stocks[code]?.market || (R.dir[code] && R.dir[code][1]) || '';
  return m === 'TPEx' ? '上櫃' : m === 'TWSE' ? '上市' : m || '';
}

/* ---------- 搜尋索引 ---------- */
let INDEX = [];
let NAME_MATCHERS = [];
const NAME_BLOCK = new Set(['統一', '大同', '中華', '大成', '全國', '國際', '台灣', '美國', '中國', '日本', '新光', '遠東', '聯合', '第一']);
function buildIndex() {
  const seen = new Set();
  INDEX = [];
  const add = (code, name, market) => {
    if (!code || seen.has(code)) return;
    seen.add(code);
    INDEX.push({ code, name, nameU: name.toUpperCase(), market });
  };
  Object.keys(R.dir).forEach(c => add(c, cleanName(R.dir[c][0]), R.dir[c][1]));
  Object.values(R.stocks).forEach(s => add(s.code, s.name, s.market));
  NAME_MATCHERS = INDEX.filter(e => e.name.length >= 3 || (e.name.length === 2 && R.stocks[e.code] && !NAME_BLOCK.has(e.name)))
    .map(e => [e.name, e.code])
    .sort((a, b) => b[0].length - a[0].length);
}
export function searchStocks(q, limit = 30) {
  const query = String(q || '').trim().toUpperCase();
  if (!query) return [];
  const res = [];
  for (const e of INDEX) {
    let s = -1;
    if (e.code === query) s = 0;
    else if (e.code.startsWith(query)) s = 1;
    else if (e.nameU.startsWith(query)) s = 2;
    else if (e.nameU.includes(query)) s = 3;
    else if (e.code.includes(query)) s = 4;
    if (s >= 0) res.push([s, e]);
  }
  res.sort((a, b) => a[0] - b[0] || (R.stocks[b[1].code] ? 1 : 0) - (R.stocks[a[1].code] ? 1 : 0) || a[1].code.length - b[1].code.length || a[1].code.localeCompare(b[1].code));
  return res.slice(0, limit).map(x => x[1]);
}
/** 從文字中找出相關個股（代號 + 股名，長名稱優先、避免子字串重複比對） */
export function relatedStocks(text, max = 3, preset = []) {
  const out = [];
  const push = c => { if (c && !out.includes(c) && (R.dir[c] || R.stocks[c])) out.push(c); };
  preset.forEach(push);
  let work = String(text || '');
  for (const m of work.matchAll(/(?:^|[(（\s])([0-9]{4,6}[A-Z]?)(?=$|[)）\s-]|-TW|\.TW)/g)) push(m[1]);
  for (const [name, code] of NAME_MATCHERS) {
    if (out.length >= max) break;
    const i = work.indexOf(name);
    if (i >= 0) {
      push(code);
      work = work.slice(0, i) + '\u0000'.repeat(name.length) + work.slice(i + name.length);
    }
  }
  return out.slice(0, max);
}

/* =====================================================================
 * 即時報價（鉅亨網 quote API，原生 CORS）
 * ===================================================================== */
export const Q = {};
export const IDX = {};
export const liveState = { lastAt: 0, ok: null, polling: false, holiday: false };

function parseQuote(x) {
  const sym = String(x['0'] || '');
  const [, code, type] = sym.split(':');
  const price = num(x['6']);
  if (!code || !(price > 0)) return null;
  const prev = num(x['21']);
  const change = num(x['11']) ?? (prev ? +(price - prev).toFixed(2) : 0);
  const pct = num(x['56']) ?? (prev ? (change / prev) * 100 : 0);
  const ts = (num(x['200007']) || 0) * 1000;
  return {
    code,
    type,
    name: x['200009'] ? cleanName(x['200009']) : null,
    price,
    change,
    pct,
    prev,
    open: num(x['19']),
    high: num(x['12']),
    low: num(x['13']),
    vol: type === 'STOCK' ? num(x['200013']) : null,
    amount: num(x['200067']),
    limitUp: num(x['75']),
    limitDown: num(x['76']),
    ts,
    date: ts ? tpeDate(ts) : '',
  };
}

const interest = new Set();
export function setInterest(codes = []) {
  interest.clear();
  codes.forEach(c => c && interest.add(c));
}
export function addInterest(codes = []) {
  codes.forEach(c => c && interest.add(c));
}

let refreshing = null;
export async function refreshQuotes({ all = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const set = new Set([...watchCodes(), ...interest]);
    if (all) Object.keys(R.stocks).forEach(c => set.add(c));
    const syms = ['TWS:TSE01:INDEX', 'TWS:OTC01:INDEX', ...[...set].filter(isValidCode).map(c => `TWS:${c}:STOCK`)];
    const chunks = [];
    for (let i = 0; i < syms.length; i += 60) chunks.push(syms.slice(i, i + 60));
    const changed = [];
    let got = 0;
    await Promise.all(
      chunks.map(async ch => {
        try {
          const j = await fetchJSON(QUOTE_API + ch.join(','), { cache: 'no-store', timeout: 7000 });
          for (const x of j.data || []) {
            const q = parseQuote(x);
            if (!q) continue;
            got++;
            if (q.type === 'INDEX') {
              IDX[q.code] = q;
              continue;
            }
            const old = Q[q.code];
            if (!old || old.price !== q.price || old.ts !== q.ts || old.vol !== q.vol) changed.push(q.code);
            Q[q.code] = q;
          }
        } catch (e) { /* 單批失敗不影響其他批 */ }
      })
    );
    liveState.lastAt = Date.now();
    liveState.ok = got > 0;
    liveState.holiday = detectHoliday();
    bus.emit('quotes', { changed, ok: liveState.ok });
    return { changed, ok: liveState.ok };
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

function detectHoliday() {
  const ph = marketPhase();
  if (!ph.live) return false;
  const t = tpe();
  const tse = IDX.TSE01;
  return t.h * 60 + t.mi >= 550 && Boolean(tse && tse.date && tse.date < tpeDate());
}
export function phaseNow() {
  const ph = marketPhase();
  if (liveState.holiday && ph.live) return { key: 'holiday', label: '休市', live: false };
  return ph;
}

let pollTimer = null;
let reportTimer = null;
function schedule(ms) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(tick, ms);
}
async function tick() {
  const ph = phaseNow();
  const visible = document.visibilityState === 'visible';
  if (visible && ph.live && getSetting('autoRefresh')) {
    liveState.polling = true;
    await refreshQuotes();
    bus.emit('phase', phaseNow());
    schedule(Math.max(5, Number(getSetting('interval')) || 15) * 1000);
  } else {
    liveState.polling = false;
    bus.emit('phase', ph);
    schedule(60e3);
  }
}
export function startLive() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - liveState.lastAt > 45e3) refreshQuotes().finally(() => schedule(1000));
    checkReportUpdate();
  });
  bus.on('settings', k => { if (k === 'autoRefresh' || k === 'interval') schedule(500); });
  refreshQuotes({ all: true }).finally(() => schedule(1500));
  clearInterval(reportTimer);
  reportTimer = setInterval(() => { if (document.visibilityState === 'visible') checkReportUpdate(); }, 8 * 60e3);
}

/** 單一價格來源：即時報價 > AI 報告收盤 > 全市場字典 */
export function px(code) {
  const q = Q[code];
  if (q) return q;
  const s = R.stocks[code];
  if (s) {
    const prev = num(s.prev_close) ?? +(s.close - s.change).toFixed(2);
    return { code, price: s.close, change: s.change, pct: s.change_pct, prev, open: null, high: null, low: null, vol: null, ts: 0, date: R.asOf, stale: true };
  }
  const d = dirEntry(code);
  if (d) {
    const prev = d.pct ? +(d.close / (1 + d.pct / 100)).toFixed(2) : d.close;
    return { code, price: d.close, change: +(d.close - prev).toFixed(2), pct: d.pct, prev, open: d.open, high: d.high, low: d.low, vol: d.vol, ts: 0, date: R.asOf, stale: true };
  }
  return null;
}

/* =====================================================================
 * 走勢圖：分時（1 分 K）／日 K
 * ===================================================================== */
const intradayCache = memo(25e3);
export function fetchIntraday(code, isIndex = false) {
  const sym = isIndex ? `TWS:${code}:INDEX` : `TWS:${code}:STOCK`;
  return intradayCache(sym, async () => {
    const j = await fetchJSON(`${CHART_API}?resolution=1&symbol=${sym}&quote=1`, { cache: 'no-store', timeout: 8000 });
    const d = j && j.data;
    if (!d || !d.t || !d.t.length) return null;
    const pts = [];
    for (let i = d.t.length - 1; i >= 0; i--) {
      if (!isNum(d.c[i])) continue;
      pts.push({ t: d.t[i] * 1000, o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i], v: d.v[i] || 0 });
    }
    const quote = d.quote ? parseQuote({ ...d.quote, 0: d.quote['0'] || sym }) : null;
    return { points: pts, quote };
  });
}

const dailyCache = memo(8 * 60e3);
export function fetchDaily(code, days = 200) {
  return dailyCache(`${code}:${days}`, async () => {
    const now = Math.floor(Date.now() / 1000);
    try {
      const j = await fetchJSON(`${CHART_API}?resolution=D&symbol=TWS:${code}:STOCK&from=${now}&to=${now - days * 86400}`, { cache: 'no-store', timeout: 8000 });
      const d = j && j.data;
      if (d && d.t && d.t.length >= 2) {
        const bars = [];
        for (let i = d.t.length - 1; i >= 0; i--) {
          if (!(d.c[i] > 0)) continue;
          bars.push({ time: tpeDate(d.t[i] * 1000), open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: Math.round(d.v[i] || 0) });
        }
        return dedupeBars(bars);
      }
    } catch (e) { /* 改用 FinMind */ }
    try {
      const start = tpeDate(Date.now() - days * 86400e3);
      const j = await fetchJSON(`${FINMIND_API}?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(code)}&start_date=${start}`, { timeout: 8000 });
      const bars = (j.data || [])
        .filter(r => r.close > 0 && r.open > 0)
        .map(r => ({ time: r.date, open: +r.open, high: +r.max, low: +r.min, close: +r.close, volume: Math.round((r.Trading_Volume || 0) / 1000) }));
      if (bars.length >= 2) return dedupeBars(bars);
    } catch (e) { /* 改用報告內建 K 線 */ }
    return dedupeBars((R.klines[code] || []).map(b => ({ ...b })));
  });
}
function dedupeBars(bars) {
  const map = new Map();
  bars.forEach(b => map.set(b.time, b));
  return [...map.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
}
/** 以即時報價補上/更新最後一根日 K */
export function withLiveBar(bars, code) {
  const q = Q[code];
  if (!q || !q.date || !bars.length) return bars;
  const last = bars[bars.length - 1];
  const bar = { time: q.date, open: q.open ?? q.price, high: q.high ?? q.price, low: q.low ?? q.price, close: q.price, volume: Math.round(q.vol ?? last.volume ?? 0) };
  if (last.time === q.date) return [...bars.slice(0, -1), { ...last, ...bar }];
  if (last.time < q.date) return [...bars, bar];
  return bars;
}

/* =====================================================================
 * 即時新聞（鉅亨網 keyword API，原生 CORS，依發布時間由新到舊）
 * ===================================================================== */
const newsCache = memo(90e3);
function newsKeyword(q, limit = 30, page = 1) {
  return newsCache(`${q}|${limit}|${page}`, async () => {
    const j = await fetchJSON(`${NEWS_API}?q=${encodeURIComponent(q)}&limit=${limit}&page=${page}`, { cache: 'no-store', timeout: 8000 });
    return ((j.data || {}).items || [])
      .filter(it => it && it.newsId && it.title)
      .map(it =>
        normNews({
          id: `cnyes-${it.newsId}`,
          title: it.title,
          link: `https://news.cnyes.com/news/id/${it.newsId}`,
          source: '鉅亨網',
          ts: it.publishAt,
          summary: it.summary,
          image: it.coverSrc && (it.coverSrc.s || it.coverSrc.xs || {}).src,
          tags: it.keywordForTag || [],
        })
      )
      .filter(Boolean);
  });
}
const keyOf = t => String(t || '').replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 20);
const isFlash = t => /^(營收速報|鉅亨速報)/.test(t);

export const NEWS_CATS = [
  { key: 'all', label: '焦點', kw: ['台股', '外資', '台積電', '美股'] },
  { key: 'tw', label: '台股', kw: ['台股', '大盤', '加權指數'] },
  { key: 'chips', label: '法人籌碼', kw: ['外資', '投信', '三大法人'] },
  { key: 'tech', label: '科技產業', kw: ['半導體', 'AI', '伺服器'] },
  { key: 'intl', label: '國際總經', kw: ['美股', '聯準會', '央行'] },
  { key: 'flash', label: '營收速報', kw: ['營收速報'], flash: true },
];

export async function fetchHeadlines(catKey = 'all') {
  const cat = NEWS_CATS.find(c => c.key === catKey) || NEWS_CATS[0];
  const raw = await Promise.all(cat.kw.map(k => newsKeyword(k, 30).catch(() => [])));
  // 關鍵字全文搜尋會帶入「內文順帶一提」的文章：只保留標題或標籤含關鍵字者，太少時才放寬
  const strict = raw.map((pool, i) => pool.filter(n => n.title.includes(cat.kw[i]) || (n.tags || []).some(t => t.includes(cat.kw[i]))));
  const pools = strict.flat().length >= 12 ? strict : raw;
  const seen = new Set();
  const out = [];
  const week = Date.now() - 7 * 86400e3;
  for (const n of pools.flat().sort((a, b) => b.ts - a.ts)) {
    if (!n.ts || n.ts < week) continue;
    if (cat.flash ? !isFlash(n.title) : isFlash(n.title)) continue;
    const k = keyOf(n.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  if (!out.length && catKey === 'all') return R.headlines; // 即時來源失敗 → 退回 AI 報告內建頭條
  return out.slice(0, 60);
}

export async function fetchStockNews(code) {
  const name = nameOf(code);
  const baked = (R.stocks[code] && R.stocks[code].news) || [];
  const live = await newsKeyword(name, 30).catch(() => []);
  const seen = new Set();
  const items = [];
  const week = Date.now() - 7 * 86400e3;
  for (const n of [...live, ...baked]) {
    if (!n || !n.ts || n.ts < week) continue;
    const inTitle = n.title.includes(name) || n.title.includes(code);
    const inBody = (n.summary || '').includes(name) || (n.tags || []).includes(name);
    const rel = inTitle ? 2 : inBody ? 1 : baked.includes(n) ? 1 : 0;
    if (!rel) continue;
    const k = keyOf(n.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    items.push({ ...n, rel, forum: n.source === 'CMoney 論壇' });
  }
  items.sort((a, b) => (a.forum - b.forum) || ((b.rel === 2) - (a.rel === 2)) || b.ts - a.ts);
  return items.slice(0, 14);
}
