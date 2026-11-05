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


# 核心台股與熱門高股息/市值型 ETF 產業字典（並支援從證交所/櫃買即時行情動態擴充全市場 1,800+ 檔標的）
DEFAULT_SECTOR_MAP: Dict[str, Tuple[str, str, str]] = {
    "0050": ("元大台灣50", "TWSE", "市值型 ETF"),
    "0056": ("元大高股息", "TWSE", "高股息 ETF"),
    "00878": ("國泰永續高股息", "TWSE", "高股息 ETF"),
    "00919": ("群益台灣精選高息", "TWSE", "高股息 ETF"),
    "00929": ("復華台灣科技優息", "TWSE", "高股息 ETF"),
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
    "2603": ("長榮", "TWSE", "貨櫃與航空航運"),
    "2609": ("陽明", "TWSE", "貨櫃與航空航運"),
    "2615": ("萬海", "TWSE", "貨櫃與航空航運"),
    "2618": ("長榮航", "TWSE", "貨櫃與航空航運"),
    "2610": ("華航", "TWSE", "貨櫃與航空航運"),
    "1519": ("華城", "TWSE", "重電與綠能設備"),
    "1513": ("中興電", "TWSE", "重電與綠能設備"),
    "1503": ("士電", "TWSE", "重電與綠能設備"),
    "1504": ("東元", "TWSE", "重電與綠能設備"),
    "1605": ("華新", "TWSE", "塑化鋼鐵與傳產"),
    "1802": ("台玻", "TWSE", "塑化鋼鐵與傳產"),
    "1303": ("南亞", "TWSE", "塑化鋼鐵與傳產"),
    "2002": ("中鋼", "TWSE", "塑化鋼鐵與傳產"),
    "1101": ("台泥", "TWSE", "塑化鋼鐵與傳產"),
    "1216": ("統一", "TWSE", "內需消費與生技"),
    "5904": ("寶雅", "TPEx", "內需消費與生技"),
    "6446": ("藥華藥", "TWSE", "內需消費與生技"),
    "2881": ("富邦金", "TWSE", "金控與高息金融"),
    "2882": ("國泰金", "TWSE", "金控與高息金融"),
    "2891": ("中信金", "TWSE", "金控與高息金融"),
    "2886": ("兆豐金", "TWSE", "金控與高息金融"),
    "2892": ("第一金", "TWSE", "金控與高息金融"),
    "5880": ("合庫金", "TWSE", "金控與高息金融"),
    "2412": ("中華電", "TWSE", "電信防禦核心"),
    "3045": ("台灣大", "TWSE", "電信防禦核心"),
    "4904": ("遠傳", "TWSE", "電信防禦核心"),
    "7750": ("新代", "TWSE", "機器人與精密機械"),
    "2059": ("川湖", "TWSE", "AI 伺服器"),
    "3008": ("大立光", "TWSE", "光學與蘋概股"),
    "2327": ("國巨", "TWSE", "被動元件與電子零組件"),
    "3481": ("群創", "TWSE", "面板與先進封裝"),
    "2409": ("友達", "TWSE", "面板與先進封裝"),
}


class TaiwanStockDataEngine:
    """
    旗艦商用級台股全方位數據、技術指標矩陣與熱門股雷達引擎：
    1. 證交所 (TWSE) + 櫃買中心 (TPEx) 全市場 1,800+ 檔價量、三大法人（外資/投信/自營商拆解）、融資融券、當沖比。
    2. 完整量化技術指標：MA5 / MA10 / MA20 / MA60、RSI(14)、KD(9,3,3)、MACD(12,26,9)、布林通道(20,2)、ATR 停損帶。
    3. 產業資金流向熱力圖 (Sector Money Flow Heatmap) 與全市場人氣題材雷達。
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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
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

    @staticmethod
    def compute_technical_indicators(candles: List[Dict[str, Any]], current_close: float) -> Dict[str, Any]:
        """由歷史日 K 線計算完整技術指標矩陣：MA5/10/20/60、RSI(14)、KD(9,3,3)、MACD(12,26,9)、布林通道、20日高低支撐壓力。"""
        if not candles:
            return {
                "ma5": current_close,
                "ma10": current_close,
                "ma20": current_close,
                "ma60": current_close,
                "rsi14": 50.0,
                "k9": 50.0,
                "d9": 50.0,
                "kd_signal": "中性整理",
                "macd_hist": 0.0,
                "macd_signal": "中性",
                "bb_upper": round(current_close * 1.05, 2),
                "bb_lower": round(current_close * 0.95, 2),
                "bb_pct": 50.0,
                "support_20d": round(current_close * 0.95, 2),
                "resistance_20d": round(current_close * 1.05, 2),
            }

        closes = [float(c["close"]) for c in candles if c.get("close")]
        highs = [float(c["high"]) for c in candles if c.get("high")]
        lows = [float(c["low"]) for c in candles if c.get("low")]
        if not closes:
            closes = [current_close]

        def _sma(arr: List[float], n: int) -> float:
            sub = arr[-n:] if len(arr) >= n else arr
            return round(sum(sub) / len(sub), 2) if sub else current_close

        ma5 = _sma(closes, 5)
        ma10 = _sma(closes, 10)
        ma20 = _sma(closes, 20)
        ma60 = _sma(closes, 60)

        # RSI(14)
        gains: List[float] = []
        losses: List[float] = []
        for i in range(1, len(closes)):
            diff = closes[i] - closes[i - 1]
            gains.append(max(0.0, diff))
            losses.append(max(0.0, -diff))
        n_rsi = min(14, len(gains))
        if n_rsi > 0:
            avg_gain = sum(gains[-n_rsi:]) / n_rsi
            avg_loss = sum(losses[-n_rsi:]) / n_rsi
            if avg_loss == 0:
                rsi14 = 85.0
            else:
                rs = avg_gain / avg_loss
                rsi14 = round(100.0 - (100.0 / (1.0 + rs)), 1)
        else:
            rsi14 = 50.0

        # KD(9, 3, 3)
        k_val, d_val = 50.0, 50.0
        prev_k, prev_d = 50.0, 50.0
        for i in range(len(closes)):
            start_idx = max(0, i - 8)
            h9 = max(highs[start_idx : i + 1]) if highs else closes[i]
            l9 = min(lows[start_idx : i + 1]) if lows else closes[i]
            rsv = ((closes[i] - l9) / (h9 - l9) * 100.0) if (h9 - l9) > 1e-6 else 50.0
            prev_k, prev_d = k_val, d_val
            k_val = (2.0 / 3.0) * k_val + (1.0 / 3.0) * rsv
            d_val = (2.0 / 3.0) * d_val + (1.0 / 3.0) * k_val
        k9, d9 = round(k_val, 1), round(d_val, 1)
        if k9 > d9 and prev_k <= prev_d:
            kd_signal = "黃金交叉向上"
        elif k9 < d9 and prev_k >= prev_d:
            kd_signal = "死亡交叉向下"
        elif k9 >= 80:
            kd_signal = "高檔鈍化強勢"
        elif k9 <= 20:
            kd_signal = "低檔超賣區"
        else:
            kd_signal = "多方排列" if k9 >= d9 else "空方修正"

        # MACD(12, 26, 9)
        def _ema_series(arr: List[float], span: int) -> List[float]:
            alpha = 2.0 / (span + 1.0)
            out = [arr[0]]
            for x in arr[1:]:
                out.append(alpha * x + (1.0 - alpha) * out[-1])
            return out

        ema12 = _ema_series(closes, 12)
        ema26 = _ema_series(closes, 26)
        dif_series = [a - b for a, b in zip(ema12, ema26)]
        macd_dea = _ema_series(dif_series, 9)
        hist_series = [d - m for d, m in zip(dif_series, macd_dea)]
        macd_hist = round(hist_series[-1], 2)
        prev_hist = hist_series[-2] if len(hist_series) >= 2 else 0.0
        if macd_hist > 0 and prev_hist <= 0:
            macd_signal = "柱狀翻紅轉強"
        elif macd_hist > 0:
            macd_signal = "紅柱多頭延續"
        elif macd_hist < 0 and macd_hist > prev_hist:
            macd_signal = "綠柱收斂止跌"
        else:
            macd_signal = "綠柱空方調節"

        # 布林通道 (20, 2)
        sub20 = closes[-20:] if len(closes) >= 20 else closes
        mean20 = sum(sub20) / len(sub20)
        variance = sum((x - mean20) ** 2 for x in sub20) / max(1, len(sub20))
        std20 = math.sqrt(variance)
        bb_upper = round(mean20 + 2.0 * std20, 2)
        bb_lower = round(max(0.01, mean20 - 2.0 * std20), 2)
        bb_pct = round(((closes[-1] - bb_lower) / max(0.01, bb_upper - bb_lower)) * 100.0, 1)

        support_20d = round(min(lows[-20:]) if len(lows) >= 20 else min(lows), 2)
        resistance_20d = round(max(highs[-20:]) if len(highs) >= 20 else max(highs), 2)

        return {
            "ma5": ma5,
            "ma10": ma10,
            "ma20": ma20,
            "ma60": ma60,
            "rsi14": rsi14,
            "k9": k9,
            "d9": d9,
            "kd_signal": kd_signal,
            "macd_hist": macd_hist,
            "macd_signal": macd_signal,
            "bb_upper": bb_upper,
            "bb_lower": bb_lower,
            "bb_pct": bb_pct,
            "support_20d": support_20d,
            "resistance_20d": resistance_20d,
        }

    def _fetch_twse_day_snapshot(self, date_str: str) -> Dict[str, Dict[str, Any]]:
        """抓取指定日期證交所 MI_INDEX 全市場收盤行情（支援上市個股與熱門 ETF）。"""
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
                    if not (code.isdigit() and 4 <= len(code) <= 6):
                        continue
                    if len(code) != 4 and code not in DEFAULT_SECTOR_MAP:
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
                    if code.isdigit() and 4 <= len(code) <= 6:
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
        """從 Google News RSS 抓取台股近期最新新聞（強制過濾舊聞並依時間由新到舊排序）。"""
        from email.utils import parsedate_to_datetime

        now_dt = datetime.now()
        parsed_items: List[tuple[float, Dict[str, str]]] = []

        for time_window in ("when:7d", "when:30d"):
            encoded = urllib.parse.quote(f"{query} 台股 {time_window}")
            url = f"https://news.google.com/rss/search?q={encoded}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=5.0, context=self.ssl_ctx) as resp:
                    xml_bytes = resp.read()
                root = ET.fromstring(xml_bytes)
                for item in root.findall(".//item"):
                    title = (item.findtext("title") or "").strip()
                    link = (item.findtext("link") or "").strip()
                    pub_raw = (item.findtext("pubDate") or "").strip()
                    source_el = item.find("source")
                    source = source_el.text.strip() if source_el is not None and source_el.text else "財經快訊"
                    if not title:
                        continue
                    ts = now_dt.timestamp()
                    pub_str = now_dt.strftime("%Y-%m-%d")
                    if pub_raw:
                        try:
                            dt_obj = parsedate_to_datetime(pub_raw).replace(tzinfo=None)
                            # 嚴格排除超過 45 天或跨年度的過時舊聞（如 2025 年舊聞）
                            age_days = (now_dt - dt_obj).total_seconds() / 86400.0
                            if age_days > 45 or dt_obj.year < 2026:
                                continue
                            ts = dt_obj.timestamp()
                            pub_str = dt_obj.strftime("%Y-%m-%d %H:%M")
                        except Exception:
                            if "2025" in pub_raw or "2024" in pub_raw or "2023" in pub_raw:
                                continue
                    parsed_items.append(
                        (
                            ts,
                            {
                                "title": title,
                                "source": source,
                                "link": link,
                                "pub_date": pub_str,
                            },
                        )
                    )
                if len(parsed_items) >= 3:
                    break
            except Exception:
                pass

        # 依發布時間由最新到最舊排序並去重
        parsed_items.sort(key=lambda x: x[0], reverse=True)
        seen_titles = set()
        articles: List[Dict[str, str]] = []
        for _, art in parsed_items:
            if art["title"] not in seen_titles:
                seen_titles.add(art["title"])
                articles.append(art)
                if len(articles) >= limit:
                    break
        return articles

    def fetch_stock_kline_history(self, code: str, market: str = "TWSE", days: int = 60) -> List[Dict[str, Any]]:
        """抓取個股近 60 日真實 OHLCV K 線（供 TradingView 圖表與 RSI/KD/MACD/布林通道計算使用）。"""
        suffix = ".TW" if market == "TWSE" else ".TWO"
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{code}{suffix}?range=6mo&interval=1d"
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
        一鍵執行全市場盤後掃描、跨日均線與三大法人連買計算、產業資金流向熱力圖與熱門題材股自動捕捉。
        """
        weekdays = self._recent_weekdays(target_date, count=5)
        latest_date = weekdays[0]
        prev_dates = weekdays[1:4]

        with ThreadPoolExecutor(max_workers=12) as ex:
            f_tw_t0 = ex.submit(self._fetch_twse_day_snapshot, latest_date)
            f_tp_t0 = ex.submit(self._fetch_tpex_day_snapshot, latest_date)
            f_t86_t0 = ex.submit(self._fetch_twse_t86_breakdown, latest_date)
            f_tp_inst = ex.submit(self._fetch_tpex_inst_breakdown)
            f_margin_dt = ex.submit(self._fetch_margin_and_daytrade, latest_date)
            f_market_news = ex.submit(self.fetch_google_news_for_query, "台股 外資 投信 熱門股 AI", 10)

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

        user_watch = [
            str(c).strip()
            for c in (watchlist or ["2330", "2317", "2454", "6669", "3533", "1802", "2603", "2618", "2891", "2412", "0050", "00878"])
        ]
        top_turnover_codes = [
            item["code"]
            for item in sorted(all_t0.values(), key=lambda x: x["turnover_ntd"], reverse=True)[:50]
        ]
        # 確保高價股(>=200)、中低價股(50~200)、低價銅板股(<50) 皆優先納入「法人逆勢買超＋抗跌上漲」強勢股與人氣股
        high_price_bull = [
            item["code"]
            for item in sorted(
                [
                    x
                    for x in all_t0.values()
                    if x["close"] >= 200.0
                    and x["turnover_ntd"] >= 3e7
                    and (inst_t0.get(x["code"], {}).get("total_lots", 0.0) > 0 or x["change_pct"] >= 0.0)
                ],
                key=lambda x: (
                    inst_t0.get(x["code"], {}).get("total_lots", 0.0) > 0 and x["change_pct"] >= 0.0,
                    inst_t0.get(x["code"], {}).get("total_lots", 0.0) * x["close"],
                    x["change_pct"],
                ),
                reverse=True,
            )[:25]
        ]
        high_price_active = high_price_bull + [
            item["code"]
            for item in sorted(
                [x for x in all_t0.values() if x["close"] >= 200.0],
                key=lambda x: x["turnover_ntd"],
                reverse=True,
            )[:20]
        ]
        mid_price_active = [
            item["code"]
            for item in sorted(
                [
                    x
                    for x in all_t0.values()
                    if 50.0 <= x["close"] < 200.0 and x["turnover_ntd"] >= 3e7
                ],
                key=lambda x: (
                    inst_t0.get(x["code"], {}).get("total_lots", 0.0) > 50 and x["change_pct"] >= 0.0,
                    x["turnover_ntd"],
                ),
                reverse=True,
            )[:35]
        ]
        low_price_active = [
            item["code"]
            for item in sorted(
                [
                    x
                    for x in all_t0.values()
                    if 5.0 <= x["close"] < 50.0 and len(x["code"]) == 4 and x["turnover_ntd"] >= 2e7
                ],
                key=lambda x: (
                    inst_t0.get(x["code"], {}).get("total_lots", 0.0) > 100 and x["change_pct"] >= 0.0,
                    x["turnover_ntd"],
                ),
                reverse=True,
            )[:35]
        ]
        top_inst_buy_codes = [
            code
            for code, info in sorted(
                inst_t0.items(),
                key=lambda kv: kv[1].get("total_lots", 0.0) * all_t0.get(kv[0], {}).get("close", 0.0),
                reverse=True,
            )[:30]
            if code in all_t0
        ]
        top_inst_sell_codes = [
            code
            for code, info in sorted(
                inst_t0.items(),
                key=lambda kv: kv[1].get("total_lots", 0.0) * all_t0.get(kv[0], {}).get("close", 0.0),
            )[:30]
            if code in all_t0
        ]
        active_codes = list(
            dict.fromkeys(
                user_watch
                + list(DEFAULT_SECTOR_MAP.keys())
                + top_turnover_codes
                + high_price_active
                + mid_price_active
                + low_price_active
                + top_inst_buy_codes
                + top_inst_sell_codes
            )
        )

        stocks_enriched: Dict[str, Dict[str, Any]] = {}
        sector_Buckets: Dict[str, List[Dict[str, Any]]] = {}

        for code in active_codes:
            q = all_t0.get(code)
            if not q:
                continue
            close_p = q["close"]
            high_p = max(q["high"], close_p)
            low_p = min(q["low"], close_p)

            # 股價位階分級：高價股(>=200) / 中低價股(50~200) / 低價銅板股(<50)
            if close_p >= 200.0:
                price_tier = "HIGH_200_PLUS"
                price_tier_label = "💎 高價股 (200元以上)"
            elif close_p >= 50.0:
                price_tier = "MID_50_200"
                price_tier_label = "⚖️ 中低價股 (50~200元)"
            else:
                price_tier = "LOW_UNDER_50"
                price_tier_label = "🪙 低價銅板股 (50元以下)"
            lot_cost_wan = round(close_p * 0.1, 2)

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
            sector_label = sector_info[2] if sector_info else ("上市熱門題材" if q["market"] == "TWSE" else "上櫃熱門題材")

            # 多維度量化評分 (0 - 100 分)
            chip_score = 50.0
            if i0["foreign_lots"] > 0 and i0["trust_lots"] > 0:
                chip_score += 22.0
            elif i0["trust_lots"] > 50:
                chip_score += 16.0
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
                chip_score += 8.0
            elif margin_lots > 500 and i0["total_lots"] < 0:
                chip_score -= 12.0
            chip_score = max(10.0, min(98.0, chip_score))

            trend_score = 50.0
            if close_p >= ma_mid:
                trend_score += 18.0
            else:
                trend_score -= 12.0
            if close_p >= ma_short >= ma_mid:
                trend_score += 12.0
            if 0.3 <= q["change_pct"] <= 4.8:
                trend_score += 14.0
            elif q["change_pct"] > 6.5:
                trend_score += 4.0
            elif q["change_pct"] <= -3.5:
                trend_score -= 18.0
            if 1.15 <= vol_ratio <= 2.8 and q["change_pct"] > 0:
                trend_score += 8.0
            trend_score = max(10.0, min(98.0, trend_score))

            risk_score = 78.0
            if dt_ratio_pct > 45.0:
                risk_score -= 22.0
            elif dt_ratio_pct < 25.0:
                risk_score += 10.0
            if abs(ma_gap_pct) > 7.5:
                risk_score -= 15.0
            risk_score = max(15.0, min(96.0, risk_score))

            total_score = round(0.45 * chip_score + 0.35 * trend_score + 0.20 * risk_score, 1)

            # === 三大週期專屬評分 (短線 / 波段 / 長線) + 做空放空評分 ===
            # 1. ⚡ 短線衝刺分 (Short-Term 1~5日)：重當日量能爆發、強勢突破、法人單日急買
            short_term_score = 50.0
            if close_p >= ma_short and q["change_pct"] >= 0.8:
                short_term_score += 18.0
            if 1.2 <= vol_ratio <= 3.5 and q["change_pct"] > 0:
                short_term_score += 14.0
            if i0["total_lots"] > 200:
                short_term_score += 12.0
            if i0["foreign_lots"] > 0 and i0["trust_lots"] > 0:
                short_term_score += 8.0
            if q["change_pct"] < 0 or close_p < ma_short:
                short_term_score -= 16.0
            short_term_score = round(max(12.0, min(98.0, short_term_score)), 1)

            # 2. 🌊 波段認養分 (Swing 2~8週)：重 3 日法人連買、投信作帳、融資減少、均線初升段未過熱
            swing_score = total_score
            if trust_3d_lots > 50 or (i0["foreign_lots"] > 0 and i0["trust_lots"] > 0):
                swing_score += 8.0
            if -1.5 <= ma_gap_pct <= 4.5 and close_p >= ma_mid:
                swing_score += 6.0
            if margin_lots < 0 and i0["total_lots"] > 0:
                swing_score += 5.0
            swing_score = round(max(12.0, min(98.0, swing_score)), 1)

            # 3. 🌳 長線價值／存股分 (Long-Term 1季~1年以上)：重產業龍頭護城河、ETF/權值穩健度、低當沖、安全邊際
            long_term_score = 52.0
            if code in DEFAULT_SECTOR_MAP:
                long_term_score += 14.0
            if sector_label in {"市值型 ETF", "高股息 ETF", "電信防禦核心", "金控與高息金融", "晶圓代工 / AI 晶片", "AI 電源與散熱"}:
                long_term_score += 12.0
            if dt_ratio_pct < 26.0:
                long_term_score += 10.0
            if -3.5 <= ma_gap_pct <= 3.0:
                long_term_score += 8.0
            if inst_3d_val_yi >= 0 or i0["total_lots"] >= 0:
                long_term_score += 8.0
            else:
                long_term_score -= 10.0
            long_term_score = round(max(15.0, min(98.0, long_term_score)), 1)

            # 4. 🐻 做空／避險放空分 (Short-Selling Score)：捕捉「法人連賣倒貨＋散戶融資接刀＋均線破位蓋頭反壓」
            short_sell_score = 40.0
            if i0["total_lots"] < -300:
                short_sell_score += 18.0
            elif i0["total_lots"] < -50:
                short_sell_score += 10.0
            elif i0["total_lots"] > 300:
                short_sell_score -= 18.0

            if i0["foreign_lots"] < 0 and i0["trust_lots"] < 0:
                short_sell_score += 12.0
            if inst_3d_val_yi < -1.0:
                short_sell_score += 14.0
            elif inst_3d_val_yi < -0.2:
                short_sell_score += 7.0
            elif inst_3d_val_yi > 1.0:
                short_sell_score -= 15.0

            if close_p < ma_mid:
                short_sell_score += 12.0
            if close_p < ma_short <= ma_mid:
                short_sell_score += 8.0
            if margin_lots > 150 and i0["total_lots"] < 0:
                short_sell_score += 10.0
            if q["change_pct"] < -0.5:
                short_sell_score += 6.0
            elif q["change_pct"] >= 4.5:
                short_sell_score -= 20.0
            short_sell_score = round(max(10.0, min(96.0, short_sell_score)), 1)

            # 決定該股最適合的首選操作週期標籤
            if short_sell_score >= 70.0 and total_score < 48.0:
                best_horizon = "SHORT_SELL"
                best_horizon_label = "🐻 空方放空／避險"
            elif short_term_score >= swing_score and short_term_score >= long_term_score and q["change_pct"] >= 1.5:
                best_horizon = "SHORT_TERM"
                best_horizon_label = "⚡ 短線強勢衝刺 (1~5日)"
            elif long_term_score > swing_score and (
                sector_label in {"市值型 ETF", "高股息 ETF", "電信防禦核心", "金控與高息金融"} or dt_ratio_pct < 20.0
            ):
                best_horizon = "LONG_TERM"
                best_horizon_label = "🌳 長線存股價值 (季/年)"
            else:
                best_horizon = "SWING"
                best_horizon_label = "🌊 波段法人認養 (2~8週)"

            entry_low = round(max(low_p, min(close_p * 0.985, ma_short * 0.995)), 2)
            entry_high = round(min(close_p * 1.005, ma_mid * 1.035 if close_p > ma_mid else close_p), 2)
            if entry_low > entry_high:
                entry_low = round(close_p * 0.98, 2)
                entry_high = round(close_p, 2)
            stop_loss = round(min(low_p * 0.985, close_p - 1.8 * atr_est), 2)
            target_price = round(close_p + 2.8 * atr_est, 2)
            rr_ratio = round((target_price - close_p) / max(0.01, close_p - stop_loss), 2)

            # 做空（放空）專屬點位計算
            short_entry_low = round(close_p * 0.998, 2)
            short_entry_high = round(max(close_p * 1.018, ma_short * 1.005), 2)
            short_stop_loss = round(max(high_p * 1.015, close_p + 1.8 * atr_est, ma_mid * 1.015), 2)
            short_target_price = round(max(1.0, close_p - 2.8 * atr_est), 2)
            short_rr_ratio = round((close_p - short_target_price) / max(0.01, short_stop_loss - close_p), 2)

            # 凱利部位與分批建倉建議
            kelly_pct = round(max(5.0, min(20.0, (total_score - 45.0) * 0.35)), 1)

            item_dict = {
                **q,
                "sector": sector_label,
                "price_tier": price_tier,
                "price_tier_label": price_tier_label,
                "lot_cost_wan": lot_cost_wan,
                "best_horizon": best_horizon,
                "best_horizon_label": best_horizon_label,
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
                "short_term_score": short_term_score,
                "swing_score": swing_score,
                "long_term_score": long_term_score,
                "short_sell_score": short_sell_score,
                "entry_zone": [entry_low, entry_high],
                "stop_loss": stop_loss,
                "target_price": target_price,
                "risk_reward_ratio": rr_ratio,
                "short_entry_zone": [short_entry_low, short_entry_high],
                "short_stop_loss": short_stop_loss,
                "short_target_price": short_target_price,
                "short_rr_ratio": short_rr_ratio,
                "suggested_position_pct": kelly_pct,
            }
            stocks_enriched[code] = item_dict
            sector_Buckets.setdefault(sector_label, []).append(item_dict)

        ranked_all = sorted(stocks_enriched.values(), key=lambda x: x["total_score"], reverse=True)
        for idx, item in enumerate(ranked_all):
            item["rank"] = idx + 1

        # 產業資金流向熱力圖統計 (Sector Money Flow Heatmap)
        sector_heatmap: List[Dict[str, Any]] = []
        for sec_name, sec_items in sector_Buckets.items():
            if not sec_items:
                continue
            avg_chg = sum(x["change_pct"] for x in sec_items) / len(sec_items)
            total_inst_yi = sum(x["inst_3d_val_yi"] for x in sec_items)
            avg_sc = sum(x["total_score"] for x in sec_items) / len(sec_items)
            leader = max(sec_items, key=lambda x: x["total_score"])
            sector_heatmap.append(
                {
                    "sector": sec_name,
                    "stock_count": len(sec_items),
                    "avg_change_pct": round(avg_chg, 2),
                    "inst_flow_yi": round(total_inst_yi, 2),
                    "avg_score": round(avg_sc, 1),
                    "leader_code": leader["code"],
                    "leader_name": leader["name"],
                    "leader_change_pct": leader["change_pct"],
                }
            )
        sector_heatmap.sort(key=lambda x: (x["avg_score"], x["inst_flow_yi"]), reverse=True)

        # 1. AI 嚴選明日 Top 8 強勢推薦股
        top_picks = [
            s
            for s in ranked_all
            if s["inst_total_lots"] > 0 and -2.5 <= s["ma_gap_pct"] < 6.5 and s["change_pct"] >= -2.0
        ][:8]
        if len(top_picks) < 8:
            for s in ranked_all:
                if s not in top_picks and s["change_pct"] >= -2.5:
                    top_picks.append(s)
                if len(top_picks) >= 8:
                    break

        # 2. 三大週期專屬排行：短線衝刺 (1~5日) / 波段認養 (2~8週) / 長線價值 (季/年以上)
        short_term_picks = sorted(
            [s for s in ranked_all if s["change_pct"] >= 0.0 and s["close"] >= s["ma_short"]],
            key=lambda x: (x["short_term_score"], x["vol_ratio"], x["total_score"]),
            reverse=True,
        )[:12]
        swing_picks = sorted(
            [s for s in ranked_all if s["inst_total_lots"] >= 0 and s["ma_gap_pct"] <= 6.0 and s["change_pct"] >= -1.5],
            key=lambda x: (x["swing_score"], x["inst_3d_val_yi"], x["total_score"]),
            reverse=True,
        )[:12]
        long_term_picks = sorted(
            [s for s in ranked_all if s["change_pct"] >= -2.0],
            key=lambda x: (x["long_term_score"], x["risk_score"], x["total_score"]),
            reverse=True,
        )[:12]

        # 3. 三大股價位階專屬排行：高價股(>=200) / 中低價股(50~200) / 低價銅板股(<50)（嚴格優先取法人偏多與抗跌上漲標的）
        high_price_picks = sorted(
            [s for s in ranked_all if s["price_tier"] == "HIGH_200_PLUS"],
            key=lambda x: (x["change_pct"] >= -1.0 and x["inst_total_lots"] >= 0, x["total_score"]),
            reverse=True,
        )[:12]
        mid_price_picks = sorted(
            [s for s in ranked_all if s["price_tier"] == "MID_50_200"],
            key=lambda x: (x["change_pct"] >= -1.0 and x["inst_total_lots"] >= 0, x["total_score"]),
            reverse=True,
        )[:12]
        low_price_picks = sorted(
            [s for s in ranked_all if s["price_tier"] == "LOW_UNDER_50"],
            key=lambda x: (x["change_pct"] >= -1.0 and x["inst_total_lots"] >= 0, x["total_score"]),
            reverse=True,
        )[:12]

        # 4. 🐻 做空／避險放空專區 (Short-Selling Radar)：法人連賣＋技術破線＋散戶融資接刀
        short_sell_picks = sorted(
            ranked_all,
            key=lambda x: (x["short_sell_score"], -x["total_score"], -x["inst_3d_val_yi"]),
            reverse=True,
        )[:12]

        # 5. 土洋同買（外資+投信同步大買）熱門股 & 全市場人氣成交值王
        co_buy_leaders = sorted(
            [s for s in ranked_all if s["foreign_lots"] > 0 and s["trust_lots"] > 0],
            key=lambda x: x["inst_3d_val_yi"],
            reverse=True,
        )[:10]
        volume_hot = sorted(ranked_all, key=lambda x: x["turnover_yi"], reverse=True)[:10]
        warning_list = short_sell_picks[:8]

        # 6. 全市場 1,800+ 檔上市櫃與 ETF 完整速查字典（含價量、外資/投信/自營商買賣超、融資、當沖比，供前端 0 延遲秒開）
        market_directory = {}
        for code, item in all_t0.items():
            ic = inst_t0.get(code, {})
            vol_sh = item.get("volume_shares", 0.0)
            dt_p = round(min(85.0, (dt_shares_map.get(code, 0.0) / vol_sh * 100.0)) if vol_sh > 0 else 18.0, 1)
            market_directory[code] = [
                item["name"],
                item["market"],
                item["close"],
                item["change_pct"],
                round(float(ic.get("foreign_lots", 0.0)), 0),
                round(float(ic.get("trust_lots", 0.0)), 0),
                round(float(ic.get("dealer_lots", 0.0)), 0),
                round(float(margin_diff_map.get(code, 0.0)), 0),
                dt_p,
                item.get("open", item["close"]),
                item.get("high", item["close"]),
                item.get("low", item["close"]),
            ]

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
                "high_200_count": sum(1 for x in stocks_enriched.values() if x["price_tier"] == "HIGH_200_PLUS"),
                "mid_50_200_count": sum(1 for x in stocks_enriched.values() if x["price_tier"] == "MID_50_200"),
                "low_under_50_count": sum(1 for x in stocks_enriched.values() if x["price_tier"] == "LOW_UNDER_50"),
                "short_sell_alert_count": sum(1 for x in stocks_enriched.values() if x["short_sell_score"] >= 65.0),
                "regime": (
                    "多頭進攻盤（百花齊放，順勢抱強股）"
                    if avg_market_ret >= 0.6
                    else "震盪選股盤（重個股法人籌碼、拉回低接不追高）"
                    if avg_market_ret >= -0.8
                    else "空方修正洗盤（嚴控現金水位、可搭配做空專區避險）"
                ),
            },
            "sector_heatmap": sector_heatmap,
            "headline_news": headline_news,
            "top_picks": top_picks,
            "short_term_picks": short_term_picks,
            "swing_picks": swing_picks,
            "long_term_picks": long_term_picks,
            "high_price_picks": high_price_picks,
            "mid_price_picks": mid_price_picks,
            "low_price_picks": low_price_picks,
            "short_sell_picks": short_sell_picks,
            "co_buy_leaders": co_buy_leaders,
            "volume_hot": volume_hot,
            "warning_list": warning_list,
            "watchlist_codes": user_watch,
            "stocks": stocks_enriched,
            "market_directory": market_directory,
        }
