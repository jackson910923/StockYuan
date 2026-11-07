// StockYuan 永久保存層：自選股 / 設定 / 持倉
// 三層備援寫入（localStorage + IndexedDB[strict durability] + Cookie），開啟時取「最新的一份」並自動修復其他層。
// 解決舊版手機端自選股被重置的問題：
//   1. 舊版 Service Worker 無限累積快取 → 手機儲存空間壓力下整站資料被清除（含 localStorage）
//   2. Android WebView 的 localStorage 延遲寫入磁碟，App 立即被滑掉時會遺失
//   3. 以中文股名新增時被當成代號存入、重開後消失
import { bus } from './util.js';

const LS_KEY = 'sy.v6.state';
const LEGACY_WL = 'alphatw_watchlist';
const LEGACY_POS = 'alphatw_positions';
const IDB_NAME = 'stockyuan';
const IDB_STORE = 'kv';
const COOKIE = 'sy_wl';
const COOKIE_PATH = location.pathname.replace(/[^/]*$/, '') || '/';

const DEFAULT_SETTINGS = {
  theme: 'dark', // dark | light | system
  colors: 'tw', // tw: 紅漲綠跌 | intl: 綠漲紅跌
  easy: false, // 白話直覺模式
  autoRefresh: true,
  interval: 15, // 盤中自動更新秒數
  screenerTab: 'top',
  screenerTier: 'ALL',
  screenerSort: 'score',
  wlSort: 'custom',
  wlPill: 'pct', // pct | chg | vol
  chartRange: 'D',
  showPlanLines: true,
  newsCat: 'all',
};

const fresh = () => ({
  v: 6,
  savedAt: 0,
  wl: { codes: [], updatedAt: 0, touched: false },
  settings: { ...DEFAULT_SETTINGS },
  positions: {},
  recent: [],
});

let state = fresh();
let defaultCodes = [];
let persistRequested = false;

const CODE_RE = /^[0-9]{4,6}[A-Z]?$/;
export const isValidCode = c => CODE_RE.test(String(c || '').trim().toUpperCase());
const uniqCodes = arr => {
  const seen = new Set();
  const out = [];
  for (const c of arr || []) {
    const code = String(c || '').trim().toUpperCase();
    if (isValidCode(code) && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
};

function normalize(s) {
  const base = fresh();
  if (!s || typeof s !== 'object') return base;
  const wl = s.wl || {};
  return {
    v: 6,
    savedAt: Number(s.savedAt) || 0,
    wl: { codes: uniqCodes(wl.codes), updatedAt: Number(wl.updatedAt) || 0, touched: Boolean(wl.touched) },
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    positions: s.positions && typeof s.positions === 'object' ? s.positions : {},
    recent: uniqCodes(s.recent).slice(0, 12),
  };
}

/* ---------- localStorage ---------- */
function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}
function readLegacy() {
  try {
    const wlRaw = localStorage.getItem(LEGACY_WL);
    const posRaw = localStorage.getItem(LEGACY_POS);
    if (!wlRaw && !posRaw) return null;
    const s = fresh();
    const codes = wlRaw ? JSON.parse(wlRaw) : null;
    if (Array.isArray(codes)) s.wl = { codes: uniqCodes(codes), updatedAt: 1, touched: true };
    const pos = posRaw ? JSON.parse(posRaw) : null;
    if (pos && typeof pos === 'object') s.positions = pos;
    s.savedAt = 1;
    return s;
  } catch (e) {
    return null;
  }
}

/* ---------- IndexedDB ---------- */
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('no-idb'));
    const timer = setTimeout(() => reject(new Error('idb-timeout')), 2500);
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { clearTimeout(timer); return reject(e); }
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
    req.onblocked = () => { clearTimeout(timer); reject(new Error('idb-blocked')); };
  }).catch(e => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}
async function readIDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get('state');
    req.onsuccess = () => resolve(req.result ? normalize(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}
async function writeIDB(obj) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(IDB_STORE, 'readwrite', { durability: 'strict' });
    } catch (e) {
      tx = db.transaction(IDB_STORE, 'readwrite');
    }
    tx.objectStore(IDB_STORE).put(JSON.parse(JSON.stringify(obj)), 'state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ---------- Cookie（只存自選股代號，作為最後一道備援） ---------- */
function writeCookie(wl) {
  if (!wl.touched) return;
  const val = `${wl.updatedAt.toString(36)}~${wl.codes.join('.')}`;
  if (val.length > 3600) return;
  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(val)}; max-age=${400 * 86400}; path=${COOKIE_PATH}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch (e) { /* ignore */ }
}
function readCookie() {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
    if (!m) return null;
    const [ts, codes] = decodeURIComponent(m[1]).split('~');
    return { wl: { codes: uniqCodes((codes || '').split('.')), updatedAt: parseInt(ts, 36) || 0, touched: true } };
  } catch (e) {
    return null;
  }
}

/* ---------- 寫入 ---------- */
function persist() {
  state.savedAt = Date.now();
  const json = JSON.stringify(state);
  try {
    localStorage.setItem(LS_KEY, json);
    if (state.wl.touched) localStorage.setItem(LEGACY_WL, JSON.stringify(state.wl.codes)); // 舊版相容
  } catch (e) { /* 配額或隱私模式 */ }
  writeCookie(state.wl);
  writeIDB(state).catch(() => {});
}
function requestPersistentStorage() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    navigator.storage?.persisted?.().then(p => { if (!p) navigator.storage.persist?.(); }).catch(() => {});
  } catch (e) { /* ignore */ }
}

/* ---------- 初始化：取最新的一份並修復其他層 ---------- */
async function init() {
  const cands = [];
  const ls = readLS();
  if (ls) cands.push(ls);
  try {
    const idb = await readIDB();
    if (idb) cands.push(idb);
  } catch (e) { /* IDB 不可用（部分隱私模式） */ }
  const legacy = ls ? null : readLegacy();
  if (legacy) cands.push(legacy);

  let base = fresh();
  for (const c of cands) if (c.savedAt >= base.savedAt) base = c;

  // 自選股另外取 updatedAt 最新者（Cookie 也參與）
  const ck = readCookie();
  const baseWl = base.wl;
  let wl = baseWl;
  for (const c of [...cands, ck].filter(Boolean)) {
    if (c.wl && c.wl.touched && c.wl.updatedAt > (wl.touched ? wl.updatedAt : -1)) wl = c.wl;
  }
  base.wl = { ...wl, codes: uniqCodes(wl.codes) };
  state = normalize(base);

  // 任何一層缺漏或不一致（例如 localStorage 被清除但 IndexedDB / Cookie 還在）→ 立即回寫修復
  const layersDiffer = cands.length > 0 && (!ls || !cands.every(c => c.savedAt === state.savedAt));
  if (layersDiffer || legacy || wl !== baseWl) persist();

  window.addEventListener('storage', e => {
    if (e.key !== LS_KEY || !e.newValue) return;
    try {
      const s = normalize(JSON.parse(e.newValue));
      if (s.savedAt > state.savedAt) {
        state = s;
        bus.emit('watchlist');
        bus.emit('settings');
      }
    } catch (err) { /* ignore */ }
  });
  // 背景化/關閉前再寫一次，提高 WebView 落盤機會
  const flush = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  return state;
}

export const ready = init();

/* ---------- 自選股 API ---------- */
export function setDefaultWatchlist(codes) { defaultCodes = uniqCodes(codes); }
export function watchCodes() { return state.wl.touched ? state.wl.codes : defaultCodes; }
export function isWatched(code) { return watchCodes().includes(String(code).toUpperCase()); }
export function watchTouched() { return state.wl.touched; }
function mutateWL(fn) {
  if (!state.wl.touched) state.wl = { codes: [...defaultCodes], updatedAt: 0, touched: true };
  fn(state.wl.codes);
  state.wl.codes = uniqCodes(state.wl.codes);
  state.wl.updatedAt = Date.now();
  persist();
  requestPersistentStorage();
  bus.emit('watchlist');
}
export function addWatch(code) {
  code = String(code || '').trim().toUpperCase();
  if (!isValidCode(code)) return false;
  if (isWatched(code)) return true;
  mutateWL(list => list.unshift(code));
  return true;
}
export function removeWatch(code) {
  code = String(code || '').trim().toUpperCase();
  mutateWL(list => {
    const i = list.indexOf(code);
    if (i >= 0) list.splice(i, 1);
  });
}
export function toggleWatch(code) {
  if (isWatched(code)) {
    removeWatch(code);
    return false;
  }
  addWatch(code);
  return true;
}
/** 復原用：把代號插回原本的位置 */
export function insertWatch(code, index) {
  code = String(code || '').trim().toUpperCase();
  if (!isValidCode(code)) return;
  mutateWL(list => {
    const i = list.indexOf(code);
    if (i >= 0) list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, index)), 0, code);
  });
}
export function moveWatch(code, toIndex) {
  mutateWL(list => {
    const from = list.indexOf(code);
    if (from < 0) return;
    list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, code);
  });
}
export function setWatchCodes(codes, mode = 'replace') {
  const incoming = uniqCodes(codes);
  mutateWL(list => {
    if (mode === 'merge') {
      const merged = uniqCodes([...list, ...incoming]);
      list.splice(0, list.length, ...merged);
    } else {
      list.splice(0, list.length, ...incoming);
    }
  });
}
export function shareLink() {
  const base = `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
  return `${base}#/import?wl=${watchCodes().join('.')}`;
}
export const parseCodes = str => uniqCodes(String(str || '').split(/[.,\s|]+/));

/* ---------- 設定 ---------- */
export const getSetting = k => state.settings[k];
export function setSetting(k, v) {
  if (state.settings[k] === v) return;
  state.settings[k] = v;
  persist();
  bus.emit('settings', k);
}

/* ---------- 持倉試算記憶 ---------- */
export const getPosition = code => state.positions[code] || null;
export function setPosition(code, pos) {
  if (pos) state.positions[code] = pos;
  else delete state.positions[code];
  persist();
}

/* ---------- 最近搜尋 ---------- */
export const recentCodes = () => state.recent;
export function addRecent(code) {
  state.recent = uniqCodes([code, ...state.recent]).slice(0, 12);
  persist();
}
export function clearRecent() {
  state.recent = [];
  persist();
}

export function storageSummary() {
  return { savedAt: state.savedAt, wlUpdatedAt: state.wl.updatedAt, touched: state.wl.touched, count: watchCodes().length };
}
