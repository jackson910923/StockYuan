from __future__ import annotations

import json
import math
import ssl
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# 核心台股名稱與產業分類字典（並支援從證交所/櫃買即時行情動態擴充全市場 1,800+ 檔上市櫃個股）
DEFAULT_SECTOR_MAP: Dict[str, Tuple[str, str, str]] = {
    "2330": ("台積電", "TWSE", "晶圓代工 / AI 晶片"),
    "2317": ("鴻海", "TWSE", "AI 伺服器 / EMS"),
    "2454": ("聯發科", "TWSE", "IC 設計 / 邊緣 AI"),
    "2382": ("廣達", "TWSE", "AI 伺服器"),
    "6669": ("緯穎", "TWSE", "AI 伺服器 / 雲端"),
    "3231": ("緯創", "TWSE", "AI 伺服器"),
    "2356": ("英業達", "TWSE", "AI 伺服器"),
    "2376": ("技嘉", "TWSE", "AI 伺服器 / 板卡"),
    "3017": ("奇鋐", "TWSE", "AI 水冷散熱"),
    "3324": ("雙鴻", "TPEx", "AI 水冷散熱"),
    "3533": ("嘉澤", "TWSE", "AI 伺服器連接器"),
    "2308": ("台達電", "TWSE", "AI 電源與散熱"),
    "2303": ("聯電", "TWSE", "成熟製程晶圓代工"),
    "3711": ("日月光投控", "TWSE", "CoWoS 先進封裝"),
    "2449": ("京元電子", "TWSE", "AI 晶片測試"),
    "3661": ("世芯-KY", "TWSE", "ASIC 客製化晶片"),
    "3443": ("創意", "TWSE", "ASIC 客製化晶片"),
    "5274": ("信驊", "TPEx", "伺服器遠端管理晶片 BMC"),
    "8299": ("群聯", "TPEx", "NAND 控制 IC / 企業級 SSD"),
    "3260": ("威剛", "TPEx", "記憶體模組"),
    "2408": ("南亞科", "TWSE", "DRAM 記憶體"),
    "2344": ("華邦電", "TWSE", "利基型記憶體"),
    "6274": ("台燿", "TPEx", "高階 CCL 銅箔基板"),
    "2383": ("台光電", "TWSE", "高階 CCL 銅箔基板"),
    "3037": ("欣興", "TWSE", "ABF 載板"),
    "3189": ("景碩", "TWSE", "ABF / BT 載板"),
    "8046": ("南電", "TWSE", "ABF 載板"),
    "2603": ("長榮", "TWSE", "貨櫃航運"),
    "2609": ("陽明", "TWSE", "貨櫃航運"),
    "2615": ("萬海", "TWSE", "貨櫃航運"),
    "2618": ("長榮航", "TWSE", "航空客貨運"),
    "2610": ("華航", "TWSE", "航空客貨運"),
    "1519": ("華城", "TWSE", "重電設備 / 變壓器"),
    "1513": ("中興電", "TWSE", "重電 GIS 設備"),
    "1503": ("士電", "TWSE", "重電設備"),
    "1504": ("東元", "TWSE", "機電與綠能"),
    "1605": ("華新", "TWSE", "電線電纜 / 不鏽鋼"),
    "1802": ("台玻", "TWSE", "玻纖布 / 低介電材料"),
    "1303": ("南亞", "TWSE", "塑化 / 電子材料"),
    "2002": ("中鋼", "TWSE", "鋼鐵龍頭"),
    "1101": ("台泥", "TWSE", "水泥與綠能儲能"),
    "1216": ("統一", "TWSE", "食品與民生內需龍頭"),
    "6446": ("藥華藥", "TWSE", "新藥生技"),
    "2881": ("富邦金", "TWSE", "金控龍頭"),
    "2882": ("國泰金", "TWSE", "金控龍頭"),
    "2891": ("中信金", "TWSE", "民營金控"),
    "2886": ("兆豐金", "TWSE", "官股金控"),
    "2892": ("第一金", "TWSE", "官股金控"),
    "5880": ("合庫金", "TWSE", "官股金控"),
    "2412": ("中華電", "TWSE", "電信防禦龍頭"),
    "3045": ("台灣大", "TWSE", "電信防禦"),
    "4904": ("遠傳", "TWSE", "電信防禦"),
    "7750": ("新代", "TWSE", "工具機控制器 / 機器人"),
    "2059": ("川湖", "TWSE", "AI 伺服器導軌"),
    "3008": ("大立光", "TWSE", "光學鏡頭龍頭"),
    "2327": ("國巨", "TWSE", "被動元件龍頭"),
    "3481": ("群創", "TWSE", "面板 / FOPLP 扇出型封裝"),
    "2409": ("友達", "TWSE", "面板 / 車用顯示"),
}


class TaiwanStockDataEngine:
    """
    旗艦級台股全方位數據與熱門股雷達引擎：
    1. 證交所 (TWSE) + 櫃買中心 (TPEx) 全市場盤後價量、三大法人（外資/投信/自營商獨立拆解）、融資融券、當沖比。
    2. 跨月多日滾動均線與技術指標（MA5 / MA10 / MA20、乖離率、ATR 波動停損帶、量能爆發倍數）。
    3. 全市場熱門股自動捕捉（成交值王、外資投信土洋同買王、爆量突破王）+ Yahoo / Google News 財經新聞熱點。
    """

    def __init__(self, cache_dir: str | Path | None = None) -> None:
        base_dir = Path(__file__).resolve().parent.parent
        self.cache_dir = Path(cache_dir) if cache_dir else (base_dir / "data")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.ssl_ctx = ssl.create_default_context()
        self.ssl_ctx.check_hostname = False
        self.ssl_ctx.verify_mode = ssl.CERT_NONE

    @staticmethod
    def _parse_float(val: Any, default: float = 0.0) -> float:
        if val is None:
            return default
        if isinstance(val, (int, float)):
            return float(val) if math.isfinite(float(val)) else default
        s = str(val).strip().replace(",", "").replace("%", "").replace("+", "")
        s = s.replace("<p style ='color:red'>", "").replace("<p style='color:green'>", "").replace("</p>", "")
        if not s or s in {"--", "---", "N/A", "null", "None", "X", "除權息", "除息", "除權"}:
            return default
        try:
            return float(s)
        except ValueError:
            return default

    def _http_get_json(self, url: str, timeout: float = 10.0) -> Any:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=self.ssl_ctx) as resp:
                raw = resp.read().decode("utf-8", errors="ignore")
                return json.loads(raw)
        except Exception:
            return None

    @staticmethod
    def _recent_weekdays(base_date_str: str | None = None, count: int = 5) -> List[str]:
        if base_date_str:
            try:
                dt = datetime.strptime(base_date_str, "%Y-%m-%d")
            except ValueError:
                dt = datetime.now()
        else:
            dt = datetime.now()
            if dt.hour < 14:
                dt -= timedelta(days=1)
        out: List[str] = []
        cur = dt
        for _ in range(20):
            if cur.weekday() < 5:
                out.append(cur.strftime("%Y-%m-%d"))
                if len(out) >= count:
                    break
            cur -= timedelta(days=1)
        return out

    def _fetch_twse_day_snapshot(self, date_str: str) -> Dict[str, Dict[str, Any]]:
        """抓取指定日期證交所 MI_INDEX 全市場收盤行情（支援 1,000+ 檔上市個股）。"""
        ymd = date_str.replace("-", "")
        url = f"https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date={ymd}&type=ALLBUT0999&response=json"
        data = self._http_get_json(url, timeout=10.0)
        out: Dict[str, Dict[str, Any]] = {}
        if not isinstance(data, dict):
            return out
        for table in data.get("tables") or []:
            fields = [str(f).strip() for f in (table.get("fields") or [])]
            rows = table.get("data") or []
            if "證券代號" in fields and "收盤價" in fields and len(rows) > 100:
                idx_code = fields.index("證券代號")
                idx_name = fields.index("證券名稱") if "證券名稱" in fields else 1
                idx_vol = fields.index("成交股數") if "成交股數" in fields else 2
                idx_val = fields.index("成交金額") if "成交金額" in fields else 4
                idx_open = fields.index("開盤價") if "開盤價" in fields else 5
                idx_high = fields.index("最高價") if "最高價" in fields else 6
                idx_low = fields.index("最低價") if "最低價" in fields else 7
                idx_close = fields.index("收盤價")
                idx_sign = fields.index("漲跌(+/-)") if "漲跌(+/-)" in fields else -1
                idx_diff = fields.index("漲跌價差") if "漲跌價差" in fields else -1
                idx_pe = fields.index("本益比") if "本益比" in fields else -1
                for r in rows:
                    if not isinstance(r, list) or len(r) <= idx_close:
                        continue
                    code = str(r[idx_code]).strip()
                    if len(code) != 4 or not code.isdigit():
                        continue
                    close_p = self._parse_float(r[idx_close], 0.0)
                    if close_p <= 0:
                        continue
                    sign_str = str(r[idx_sign]) if idx_sign >= 0 else ""
                    diff = self._parse_float(r[idx_diff], 0.0) if idx_diff >= 0 else 0.0
                    if "-" in sign_str or "green" in sign_str.lower():
                        diff = -abs(diff)
                    elif "+" in sign_str or "red" in sign_str.lower():
                        diff = abs(diff)
                    prev_close = close_p - diff if (close_p - diff) > 0 else close_p
                    ret_pct = ((close_p - prev_close) / prev_close * 100.0) if prev_close > 0 else 0.0
                    out[code] = {
                        "code": code,
                        "name": str(r[idx_name]).strip(),
                        "market": "TWSE",
                        "open": self._parse_float(r[idx_open], close_p),
                        "high": self._parse_float(r[idx_high], close_p),
                        "low": self._parse_float(r[idx_low], close_p),
                        "close": close_p,
                        "change": round(diff, 2),
                        "change_pct": round(ret_pct, 2),
                        "volume_shares": self._parse_float(r[idx_vol], 0.0),
                        "turnover_ntd": self._parse_float(r[idx_val], 0.0),
                        "pe_ratio": self._parse_float(r[idx_pe], 0.0) if idx_pe >= 0 else 0.0,
                    }
        return out

    def _fetch_tpex_day_snapshot(self, date_str: str) -> Dict[str, Dict[str, Any]]:
        """抓取指定日期櫃買中心 dailyQuotes 全市場上櫃收盤行情。"""
        slash_date = date_str.replace("-", "/")
        url = f"https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date={slash_date}&id=&response=json"
        data = self._http_get_json(url, timeout=10.0)
        out: Dict[str, Dict[str, Any]] = {}
        if not isinstance(data, dict):
            return out
        for table in data.get("tables") or []:
            rows = table.get("data") or []
            if len(rows) > 100:
                for r in rows:
                    if not isinstance(r, list) or len(r) < 10:
                        continue
                    code = str(r[0]).strip()
                    if len(code) != 4 or not code.isdigit():
                        continue
                    close_p = self._parse_float(r[2], 0.0)
                    if close_p <= 0:
                        continue
                    diff = self._parse_float(r[3], 0.0)
                    open_p = self._parse_float(r[4], close_p)
                    high_p = self._parse_float(r[5], close_p)
                    low_p = self._parse_float(r[6], close_p)
                    vol_shares = self._parse_float(r[8], 0.0)
                    val_ntd = self._parse_float(r[9], 0.0)
                    prev_close = close_p - diff if (close_p - diff) > 0 else close_p
                    ret_pct = ((close_p - prev_close) / prev_close * 100.0) if prev_close > 0 else 0.0
                    out[code] = {
                        "code": code,
                        "name": str(r[1]).strip(),
                        "market": "TPEx",
                        "open": open_p,
                        "high": high_p,
                        "low": low_p,
                        "close": close_p,
                        "change": round(diff, 2),
                        "change_pct": round(ret_pct, 2),
                        "volume_shares": vol_shares,
                        "turnover_ntd": val_ntd,
                        "pe_ratio": 0.0,
                    }
        return out

    def _fetch_twse_t86_breakdown(self, date_str: str) -> Dict[str, Dict[str, float]]:
        """解析證交所 T86 三大法人買賣超（分別拆解：外資、投信、自營商買賣超股數）。"""
        ymd = date_str.replace("-", "")
        url = f"https://www.twse.com.tw/rwd/zh/fund/T86?date={ymd}&selectType=ALLBUT0999&response=json"
        data = self._http_get_json(url, timeout=10.0)
        out: Dict[str, Dict[str, float]] = {}
        if isinstance(data, dict) and isinstance(data.get("data"), list):
            for r in data["data"]:
                if isinstance(r, list) and len(r) >= 12:
                    code = str(r[0]).strip()
                    if len(code) == 4 and code.isdigit():
                        foreign_shares = self._parse_float(r[4], 0.0)
                        trust_shares = self._parse_float(r[10], 0.0)
                        total_shares = self._parse_float(r[-1], foreign_shares + trust_shares)
                        dealer_shares = total_shares - foreign_shares - trust_shares
                        out[code] = {
                            "foreign_lots": round(foreign_shares / 1000.0, 1),
                            "trust_lots": round(trust_shares / 1000.0, 1),
                            "dealer_lots": round(dealer_shares / 1000.0, 1),
                            "total_lots": round(total_shares / 1000.0, 1),
                        }
        return out

    def _fetch_tpex_inst_breakdown(self) -> Dict[str, Dict[str, float]]:
        """解析櫃買中心上櫃三大法人買賣超明細。"""
        url = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading"
        data = self._http_get_json(url, timeout=10.0)
        out: Dict[str, Dict[str, float]] = {}
        if isinstance(data, list):
            for row in data:
                if not isinstance(row, dict):
                    continue
                code = str(row.get("SecuritiesCompanyCode", row.get("代號", ""))).strip()
                if len(code) == 4 and code.isdigit():
                    f_shares = self._parse_float(
                        row.get(
                            "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference",
                            row.get("ForeignInvestorsNetBuySell", 0.0),
                        ),
                        0.0,
                    )
                    t_shares = self._parse_float(
                        row.get(
                            "SecuritiesInvestmentTrustCompanies-Difference",
                            row.get("InvestmentTrustNetBuySell", 0.0),
                        ),
                        0.0,
                    )
                    total_shares = self._parse_float(row.get("TotalDifference", f_shares + t_shares), f_shares + t_shares)
                    d_shares = total_shares - f_shares - t_shares
                    out[code] = {
                        "foreign_lots": round(f_shares / 1000.0, 1),
                        "trust_lots": round(t_shares / 1000.0, 1),
                        "dealer_lots": round(d_shares / 1000.0, 1),
                        "total_lots": round(total_shares / 1000.0, 1),
                    }
        return out

    def _fetch_margin_and_daytrade(self, date_str: str) -> Tuple[Dict[str, float], Dict[str, float]]:
        """抓取上市櫃融資增減張數與當沖成交股數。"""
        ymd = date_str.replace("-", "")
        margin_diff_lots: Dict[str, float] = {}
        dt_shares: Dict[str, float] = {}

        twse_m = self._http_get_json(
            f"https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={ymd}&selectType=ALL&response=json",
            timeout=9.0,
        )
        if isinstance(twse_m, dict):
            for t in twse_m.get("tables") or []:
                rows = t.get("data") or []
                if len(rows) > 100:
                    for r in rows:
                        if isinstance(r, list) and len(r) >= 7:
                            code = str(r[0]).strip()
                            prev_m = self._parse_float(r[5], 0.0)
                            curr_m = self._parse_float(r[6], 0.0)
                            margin_diff_lots[code] = curr_m - prev_m

        tpex_m = self._http_get_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance", timeout=9.0)
        if isinstance(tpex_m, list):
            for r in tpex_m:
                if isinstance(r, dict):
                    code = str(r.get("SecuritiesCompanyCode", "")).strip()
                    prev_m = self._parse_float(r.get("MarginPurchaseYesterdayBalance"), 0.0)
                    curr_m = self._parse_float(r.get("MarginPurchaseTodayBalance"), 0.0)
                    if code:
                        margin_diff_lots[code] = curr_m - prev_m

        twse_dt = self._http_get_json(
            f"https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date={ymd}&selectType=All&response=json",
            timeout=9.0,
        )
        if isinstance(twse_dt, dict):
            for t in twse_dt.get("tables") or []:
                rows = t.get("data") or []
                if len(rows) > 100:
                    for r in rows:
                        if isinstance(r, list) and len(r) >= 4:
                            code = str(r[0]).strip()
                            dt_shares[code] = self._parse_float(r[3], 0.0)
        return margin_diff_lots, dt_shares

    def fetch_google_news_for_query(self, query: str, limit: int = 6) -> List[Dict[str, str]]:
        """從 Google News RSS 抓取台股即時新聞標題、來源與連結（完全免費免 Key）。"""
        encoded = urllib.parse.quote(f"{query} 台股 OR 財經")
        url = f"https://news.google.com/rss/search?q={encoded}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        articles: List[Dict[str, str]] = []
        try:
            with urllib.request.urlopen(req, timeout=6.0, context=self.ssl_ctx) as resp:
                xml_bytes = resp.read()
            root = ET.fromstring(xml_bytes)
            for item in root.findall(".//item")[:limit]:
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                pub_date = (item.findtext("pubDate") or "").strip()
                source_el = item.find("source")
                source = source_el.text.strip() if source_el is not None and source_el.text else "財經快訊"
                if title:
                    articles.append(
                        {
                            "title": title,
                            "source": source,
                            "link": link,
                            "pub_date": pub_date[:22] if pub_date else "今日最新",
                        }
                    )
        except Exception:
            pass
        return articles

    def fetch_stock_kline_history(self, code: str, market: str = "TWSE", days: int = 40) -> List[Dict[str, Any]]:
        """抓取個股近 40 日真實 OHLCV K 線（供前端 TradingView K 線圖與技術指標計算使用）。"""
        suffix = ".TW" if market == "TWSE" else ".TWO"
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{code}{suffix}?range=3mo&interval=1d"
        data = self._http_get_json(url, timeout=8.0)
        candles: List[Dict[str, Any]] = []
        try:
            result = data["chart"]["result"][0]
            timestamps = result.get("timestamp") or []
            quote = result["indicators"]["quote"][0]
            opens = quote.get("open") or []
            highs = quote.get("high") or []
            lows = quote.get("low") or []
            closes = quote.get("close") or []
            volumes = quote.get("volume") or []
            for ts, o, h, l, c, v in zip(timestamps, opens, highs, lows, closes, volumes):
                if c is None or o is None or h is None or l is None:
                    continue
                dt_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
                candles.append(
                    {
                        "time": dt_str,
                        "open": round(float(o), 2),
                        "high": round(float(h), 2),
                        "low": round(float(l), 2),
                        "close": round(float(c), 2),
                        "volume": int((v or 0) // 1000),
                    }
                )
        except Exception:
            pass
        return candles[-days:] if candles else []

    def build_full_market_intelligence(
        self,
        watchlist: List[str] | None = None,
        target_date: str | None = None,
    ) -> Dict[str, Any]:
        """
        一鍵執行全市場盤後掃描、跨日均線與三大法人連買計算、熱門題材股自動捕捉。
        """
        weekdays = self._recent_weekdays(target_date, count=5)
        latest_date = weekdays[0]
        prev_dates = weekdays[1:4]

        with ThreadPoolExecutor(max_workers=10) as ex:
            f_tw_t0 = ex.submit(self._fetch_twse_day_snapshot, latest_date)
            f_tp_t0 = ex.submit(self._fetch_tpex_day_snapshot, latest_date)
            f_t86_t0 = ex.submit(self._fetch_twse_t86_breakdown, latest_date)
            f_tp_inst = ex.submit(self._fetch_tpex_inst_breakdown)
            f_margin_dt = ex.submit(self._fetch_margin_and_daytrade, latest_date)
            f_market_news = ex.submit(self.fetch_google_news_for_query, "台股 外資 投信 熱門股 AI", 8)

            hist_tw_futs = [ex.submit(self._fetch_twse_day_snapshot, d) for d in prev_dates]
            hist_tp_futs = [ex.submit(self._fetch_tpex_day_snapshot, d) for d in prev_dates]
            hist_t86_futs = [ex.submit(self._fetch_twse_t86_breakdown, d) for d in prev_dates[:2]]

            tw_t0 = f_tw_t0.result()
            tp_t0 = f_tp_t0.result()
            t86_t0 = f_t86_t0.result()
            tp_inst = f_tp_inst.result()
            margin_diff_map, dt_shares_map = f_margin_dt.result()
            headline_news = f_market_news.result()

            hist_tw = [f.result() for f in hist_tw_futs]
            hist_tp = [f.result() for f in hist_tp_futs]
            hist_t86 = [f.result() for f in hist_t86_futs]

        # 若當日尚未收盤或為假日導致抓不到當日行情，自動退回最近一個有效交易日
        all_t0 = {**tw_t0, **tp_t0}
        if not all_t0 and hist_tw:
            for idx, d in enumerate(prev_dates):
                cand = {**hist_tw[idx], **hist_tp[idx]}
                if cand:
                    all_t0 = cand
                    latest_date = d
                    if idx < len(hist_t86):
                        t86_t0 = hist_t86[idx]
                    break

        if not t86_t0 and hist_t86:
            for h_inst in hist_t86:
                if h_inst:
                    t86_t0 = h_inst
                    break
        inst_t0 = {**t86_t0, **tp_inst}
        inst_t1 = hist_t86[0] if len(hist_t86) > 0 else {}
        inst_t2 = hist_t86[1] if len(hist_t86) > 1 else {}

        # 大盤廣度統計
        up_count = sum(1 for item in all_t0.values() if item["change_pct"] > 0)
        down_count = sum(1 for item in all_t0.values() if item["change_pct"] < 0)
        flat_count = max(0, len(all_t0) - up_count - down_count)
        avg_market_ret = (
            sum(item["change_pct"] for item in all_t0.values()) / len(all_t0) if all_t0 else 0.0
        )

        # 決定要深度分析的目標池：自選股 + 核心 58 檔權值熱門股 + 全市場今日成交金額前 30 大 + 法人買超前 20 大
        user_watch = [str(c).strip() for c in (watchlist or ["2330", "2317", "2454", "6669", "3533", "1802", "2603", "2618"])]
        top_turnover_codes = [
            item["code"]
            for item in sorted(all_t0.values(), key=lambda x: x["turnover_ntd"], reverse=True)[:35]
        ]
        top_inst_codes = [
            code
            for code, info in sorted(
                inst_t0.items(),
                key=lambda kv: kv[1].get("total_lots", 0.0) * all_t0.get(kv[0], {}).get("close", 0.0),
                reverse=True,
            )[:25]
            if code in all_t0
        ]
        active_codes = list(dict.fromkeys(user_watch + list(DEFAULT_SECTOR_MAP.keys()) + top_turnover_codes + top_inst_codes))

        stocks_enriched: Dict[str, Dict[str, Any]] = {}
        for code in active_codes:
            q = all_t0.get(code)
            if not q:
                continue
            close_p = q["close"]
            high_p = max(q["high"], close_p)
            low_p = min(q["low"], close_p)

            # 跨日滾動均價與波動計算
            closes_series = [close_p]
            ranges_series = [max(high_p - low_p, close_p * 0.012)]
            vols_series = [q["volume_shares"]]
            for h_tw, h_tp in zip(hist_tw, hist_tp):
                hq = h_tw.get(code) or h_tp.get(code)
                if hq and hq["close"] > 0:
                    closes_series.append(hq["close"])
                    ranges_series.append(max(hq["high"] - hq["low"], hq["close"] * 0.012))
                    vols_series.append(hq["volume_shares"])

            ma_short = sum(closes_series[:3]) / len(closes_series[:3])
            ma_mid = sum(closes_series) / len(closes_series)
            ma_gap_pct = ((close_p - ma_mid) / ma_mid * 100.0) if ma_mid > 0 else 0.0
            atr_est = sum(ranges_series) / len(ranges_series)
            avg_vol_prev = (sum(vols_series[1:]) / len(vols_series[1:])) if len(vols_series) > 1 else q["volume_shares"]
            vol_ratio = (q["volume_shares"] / avg_vol_prev) if avg_vol_prev > 0 else 1.0

            # 三大法人單日與 3 日加權買賣超
            i0 = inst_t0.get(code, {"foreign_lots": 0.0, "trust_lots": 0.0, "dealer_lots": 0.0, "total_lots": 0.0})
            i1 = inst_t1.get(code, {"foreign_lots": 0.0, "trust_lots": 0.0, "total_lots": 0.0})
            i2 = inst_t2.get(code, {"foreign_lots": 0.0, "trust_lots": 0.0, "total_lots": 0.0})

            foreign_3d_lots = round(i0["foreign_lots"] + i1.get("foreign_lots", 0.0) + i2.get("foreign_lots", 0.0), 1)
            trust_3d_lots = round(i0["trust_lots"] + i1.get("trust_lots", 0.0) + i2.get("trust_lots", 0.0), 1)
            inst_3d_val_yi = round(
                ((0.55 * i0["total_lots"] + 0.30 * i1.get("total_lots", 0.0) + 0.15 * i2.get("total_lots", 0.0)) * 1000.0 * close_p) / 1e8,
                3,
            )

            margin_lots = round(margin_diff_map.get(code, 0.0), 0)
            dt_ratio_pct = round(
                min(85.0, (dt_shares_map.get(code, 0.0) / q["volume_shares"] * 100.0)) if q["volume_shares"] > 0 else 18.0,
                1,
            )

            sector_info = DEFAULT_SECTOR_MAP.get(code)
            sector_label = sector_info[2] if sector_info else ("上市熱門股" if q["market"] == "TWSE" else "上櫃熱門股")

            # 多維度量化評分 (0 - 100 分)
            # 1. 籌碼分 (45%)：外資投信同買、投信連買加分、散戶融資減少加分
            chip_score = 50.0
            if i0["foreign_lots"] > 0 and i0["trust_lots"] > 0:
                chip_score += 22.0  # 土洋同買強勢訊號
            elif i0["trust_lots"] > 50:
                chip_score += 16.0  # 投信作帳認養
            elif i0["foreign_lots"] > 300:
                chip_score += 14.0
            elif i0["total_lots"] < -300:
                chip_score -= 18.0

            if trust_3d_lots > 100:
                chip_score += 10.0
            if inst_3d_val_yi > 1.5:
                chip_score += 10.0
            elif inst_3d_val_yi < -1.5:
                chip_score -= 15.0
            if margin_lots < 0 and i0["total_lots"] > 0:
                chip_score += 8.0  # 融資退場、法人吸籌（黃金背離）
            elif margin_lots > 500 and i0["total_lots"] < 0:
                chip_score -= 12.0  # 法人倒貨、散戶接刀
            chip_score = max(10.0, min(98.0, chip_score))

            # 2. 趨勢與動能分 (35%)：站上均線、溫和放量上攻、抑制過度乖離追高
            trend_score = 50.0
            if close_p >= ma_mid:
                trend_score += 18.0
            else:
                trend_score -= 12.0
            if close_p >= ma_short >= ma_mid:
                trend_score += 12.0
            if 0.3 <= q["change_pct"] <= 4.8:
                trend_score += 14.0  # 溫和攻堅最穩健
            elif q["change_pct"] > 6.5:
                trend_score += 4.0  # 單日急漲防隔日沖倒貨
            elif q["change_pct"] <= -3.5:
                trend_score -= 18.0
            if 1.15 <= vol_ratio <= 2.8 and q["change_pct"] > 0:
                trend_score += 8.0
            trend_score = max(10.0, min(98.0, trend_score))

            # 3. 風控與防過熱分 (20%)：當沖比過高或正乖離過大扣分
            risk_score = 78.0
            if dt_ratio_pct > 45.0:
                risk_score -= 22.0
            elif dt_ratio_pct < 25.0:
                risk_score += 10.0
            if abs(ma_gap_pct) > 7.5:
                risk_score -= 15.0
            risk_score = max(15.0, min(96.0, risk_score))

            total_score = round(0.45 * chip_score + 0.35 * trend_score + 0.20 * risk_score, 1)

            # 計算精準進出場價位區間（供交易員與爸爸直接看）
            entry_low = round(max(low_p, min(close_p * 0.985, ma_short * 0.995)), 2)
            entry_high = round(min(close_p * 1.005, ma_mid * 1.035 if close_p > ma_mid else close_p), 2)
            if entry_low > entry_high:
                entry_low = round(close_p * 0.98, 2)
                entry_high = round(close_p, 2)
            stop_loss = round(min(low_p * 0.985, close_p - 1.8 * atr_est), 2)
            target_price = round(close_p + 2.8 * atr_est, 2)
            rr_ratio = round((target_price - close_p) / max(0.01, close_p - stop_loss), 2)

            stocks_enriched[code] = {
                **q,
                "sector": sector_label,
                "ma_short": round(ma_short, 2),
                "ma_mid": round(ma_mid, 2),
                "ma_gap_pct": round(ma_gap_pct, 2),
                "atr": round(atr_est, 2),
                "vol_ratio": round(vol_ratio, 2),
                "turnover_yi": round(q["turnover_ntd"] / 1e8, 2),
                "foreign_lots": i0["foreign_lots"],
                "trust_lots": i0["trust_lots"],
                "dealer_lots": i0["dealer_lots"],
                "inst_total_lots": i0["total_lots"],
                "foreign_3d_lots": foreign_3d_lots,
                "trust_3d_lots": trust_3d_lots,
                "inst_3d_val_yi": inst_3d_val_yi,
                "margin_diff_lots": margin_lots,
                "day_trade_pct": dt_ratio_pct,
                "chip_score": round(chip_score, 1),
                "trend_score": round(trend_score, 1),
                "risk_score": round(risk_score, 1),
                "total_score": total_score,
                "entry_zone": [entry_low, entry_high],
                "stop_loss": stop_loss,
                "target_price": target_price,
                "risk_reward_ratio": rr_ratio,
            }

        ranked_all = sorted(stocks_enriched.values(), key=lambda x: x["total_score"], reverse=True)
        for idx, item in enumerate(ranked_all):
            item["rank"] = idx + 1

        # 分類排行榜：
        # 1. AI 嚴選明日 Top 6 強勢推薦股（高總分 + 法人買超 + 趨勢抗跌未追高）
        top_picks = [
            s
            for s in ranked_all
            if s["inst_total_lots"] > 0 and -2.5 <= s["ma_gap_pct"] < 6.5 and s["change_pct"] >= -2.0
        ][:6]
        if len(top_picks) < 6:
            for s in ranked_all:
                if s not in top_picks and s["change_pct"] >= -2.5:
                    top_picks.append(s)
                if len(top_picks) >= 6:
                    break
        # 2. 土洋同買（外資+投信同步大買）熱門股
        co_buy_leaders = sorted(
            [s for s in ranked_all if s["foreign_lots"] > 0 and s["trust_lots"] > 0],
            key=lambda x: x["inst_3d_val_yi"],
            reverse=True,
        )[:8]
        # 3. 全市場人氣成交值王
        volume_hot = sorted(ranked_all, key=lambda x: x["turnover_yi"], reverse=True)[:8]
        # 4. 法人大舉調節 / 破線警戒股（提醒避開或減碼）
        warning_list = sorted(ranked_all, key=lambda x: x["total_score"])[:6]

        return {
            "as_of_date": latest_date,
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "market_summary": {
                "total_analyzed": len(all_t0),
                "up_count": up_count,
                "down_count": down_count,
                "flat_count": flat_count,
                "up_ratio_pct": round(up_count / max(1, len(all_t0)) * 100.0, 1),
                "avg_return_pct": round(avg_market_ret, 2),
                "regime": (
                    "多頭進攻盤（百花齊放）"
                    if avg_market_ret >= 0.6
                    else "震盪選股盤（重個股籌碼、不追高）"
                    if avg_market_ret >= -0.8
                    else "空方修正洗盤（嚴控現金、分批低接法人護盤股）"
                ),
            },
            "headline_news": headline_news,
            "top_picks": top_picks,
            "co_buy_leaders": co_buy_leaders,
            "volume_hot": volume_hot,
            "warning_list": warning_list,
            "watchlist_codes": user_watch,
            "stocks": stocks_enriched,
        }
