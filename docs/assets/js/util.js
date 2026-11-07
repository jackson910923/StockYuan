// StockYuan 共用工具：DOM、安全輸出（防 XSS）、台北時間、數字格式、事件匯流排

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- 安全 HTML 模板：所有插值預設跳脫，raw() 才原樣輸出 ---------- */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = s => (s instanceof Safe ? s : new Safe(String(s ?? '')));
const out = v => {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(out).join('');
  return esc(v);
};
export function html(strings, ...vals) {
  let s = strings[0];
  for (let i = 0; i < vals.length; i++) s += out(vals[i]) + strings[i + 1];
  return new Safe(s);
}
export const setHTML = (el, tpl) => { if (el) el.innerHTML = String(tpl); };

/* ---------- 事件匯流排 ---------- */
const handlers = new Map();
export const bus = {
  on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt)?.delete(fn);
  },
  emit(evt, payload) {
    (handlers.get(evt) || []).forEach(fn => {
      try { fn(payload); } catch (e) { console.error(`[bus:${evt}]`, e); }
    });
  },
};

/* ---------- 台北時間（UTC+8，無日光節約） ---------- */
const OFF = 8 * 3600e3;
const p2 = n => String(n).padStart(2, '0');
export function tpe(ms = Date.now()) {
  const d = new Date(ms + OFF);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
}
export const tpeDate = (ms = Date.now()) => { const t = tpe(ms); return `${t.y}-${p2(t.mo)}-${p2(t.d)}`; };
export const tpeTime = (ms = Date.now(), withSec = false) => { const t = tpe(ms); return `${p2(t.h)}:${p2(t.mi)}${withSec ? ':' + p2(t.s) : ''}`; };
export const tpeMD = ms => { const t = tpe(ms); return `${t.mo}/${t.d}`; };
export const mdOf = dateStr => { const m = String(dateStr || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${+m[1]}/${+m[2]}` : String(dateStr || ''); };
const WEEK = '日一二三四五六';
export const weekdayOf = dateStr => { const ms = parseTpe(dateStr); return Number.isFinite(ms) ? WEEK[tpe(ms).dow] : ''; };

/** 'YYYY-MM-DD HH:MM' 或 'YYYY-MM-DD' 視為台北時間 → epoch ms */
export function parseTpe(str) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - OFF;
}

export function relTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const diff = now - ms;
  if (diff < 60e3) return '剛剛';
  const m = Math.floor(diff / 60e3);
  if (m < 60) return `${m} 分鐘前`;
  if (tpeDate(ms) === tpeDate(now)) return `${Math.floor(m / 60)} 小時前`;
  if (tpeDate(ms) === tpeDate(now - 86400e3)) return `昨天 ${tpeTime(ms)}`;
  return `${tpeMD(ms)} ${tpeTime(ms)}`;
}

/** 台股交易時段（不含國定假日；假日由即時報價時間戳另外判斷） */
export function marketPhase(now = Date.now()) {
  const t = tpe(now);
  const mins = t.h * 60 + t.mi;
  if (t.dow === 0 || t.dow === 6) return { key: 'closed', label: '休市', live: false };
  if (mins < 510) return { key: 'pre', label: '盤前', live: false };
  if (mins < 540) return { key: 'pre', label: '試撮', live: true };
  if (mins <= 810) return { key: 'open', label: '盤中', live: true };
  if (mins <= 870) return { key: 'after', label: '盤後', live: true };
  return { key: 'closed', label: '收盤', live: false };
}

/* ---------- 數字格式 ---------- */
export const isNum = v => typeof v === 'number' && Number.isFinite(v);
export const num = v => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const decimalsFor = ref => { const a = Math.abs(ref); return a >= 500 ? 0 : a >= 50 ? 1 : 2; };
export function fmtPrice(v, ref = v) {
  if (!isNum(v)) return '--';
  const min = decimalsFor(isNum(ref) ? ref : v);
  return v.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: Math.max(min, 2) });
}
export function fmtChg(v, ref) {
  if (!isNum(v)) return '--';
  const s = fmtPrice(Math.abs(v), isNum(ref) ? ref : v);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
}
export function fmtPct(v, digits = 2) {
  if (!isNum(v)) return '--';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits) + '%';
}
export function fmtInt(v) {
  if (!isNum(v)) return '--';
  return Math.round(v).toLocaleString('en-US');
}
/** 張數（帶正負號）：≥1 萬以「萬」表示 */
export function fmtLots(v, signed = true) {
  if (!isNum(v)) return '--';
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : '';
  const a = Math.abs(v);
  return sign + (a >= 10000 ? (a / 10000).toFixed(a >= 100000 ? 1 : 2) + '萬' : Math.round(a).toLocaleString('en-US'));
}
export function fmtVol(lots) {
  if (!isNum(lots)) return '--';
  return fmtLots(lots, false) + '張';
}
export function fmtYi(v, signed = true) {
  if (!isNum(v)) return '--';
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : '';
  return sign + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 }) + '億';
}
export function fmtAmount(ntd) {
  if (!isNum(ntd)) return '--';
  if (ntd >= 1e12) return (ntd / 1e12).toFixed(2) + '兆';
  if (ntd >= 1e8) return (ntd / 1e8).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '億';
  return (ntd / 1e4).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '萬';
}
export const dirOf = v => (isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') : 'flat');
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const cleanName = n => String(n || '').replace(/\*+$/, '').trim();

/* ---------- 雜項 ---------- */
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export async function fetchJSON(url, { timeout = 8000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}
/** 簡易記憶體快取 + 同鍵請求合併 */
export function memo(ttlMs) {
  const cache = new Map();
  const inflight = new Map();
  return async (key, loader) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.val;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const val = await loader();
        cache.set(key, { at: Date.now(), val });
        return val;
      } catch (e) {
        if (hit) return hit.val; // 失敗時沿用舊資料
        throw e;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };
}
export const isTouch = () => matchMedia('(hover: none)').matches;
export const isDesktop = () => matchMedia('(min-width: 1024px)').matches;
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function decodeEntities(s) {
  if (!s || !/&[#a-z0-9]+;/i.test(s)) return s || '';
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }
}
