from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List

from backend.agent_committee import MultiAgentStockCommittee
from backend.data_engine import TaiwanStockDataEngine
from backend.notifier import DailyBriefingNotifier

# 策略歷史檔：逐「交易日」保存每檔 AI 評分與價位規劃，作為隔日「昨日策略今日實盤」驗證的唯一依據。
# 同一交易日多次執行（每日 5 次排程）只會覆寫當日紀錄，不會再把當日分數誤當成「昨日」。
HISTORY_KEEP_DAYS = 30
PICK_GROUPS = {
    "top": "top_picks",
    "short_term": "short_term_picks",
    "swing": "swing_picks",
    "long_term": "long_term_picks",
    "short_sell": "short_sell_picks",
}
REPORT_LIST_KEYS = {
    "top": "top_picks_debates",
    "short_term": "short_term_debates",
    "swing": "swing_debates",
    "long_term": "long_term_debates",
    "short_sell": "short_sell_debates",
}
SNAPSHOT_KEYS = (
    "total_score",
    "short_sell_score",
    "close",
    "entry_low",
    "entry_high",
    "stop_loss",
    "target_price",
    "short_entry_low",
    "short_entry_high",
    "short_target",
    "short_stop_loss",
)


def load_watchlist(path: Path) -> List[str]:
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [str(x).strip() for x in data if str(x).strip()]
            if isinstance(data, dict) and isinstance(data.get("watchlist"), list):
                return [str(x).strip() for x in data["watchlist"] if str(x).strip()]
        except Exception:
            pass
    default_list = ["2330", "2317", "2454", "6669", "3533", "1802", "2603", "2618", "2891", "2412", "0050", "00878"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"watchlist": default_list}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return default_list


def _plan_snapshot(item: Dict[str, Any]) -> Dict[str, Any]:
    pp = item.get("price_plan") or {}
    sp = item.get("short_sell_plan") or {}
    return {
        "name": item.get("name"),
        "total_score": item.get("total_score"),
        "short_sell_score": item.get("short_sell_score"),
        "close": item.get("close"),
        "entry_low": pp.get("entry_low"),
        "entry_high": pp.get("entry_high"),
        "stop_loss": pp.get("stop_loss"),
        "target_price": pp.get("target_price"),
        "short_entry_low": sp.get("entry_low"),
        "short_entry_high": sp.get("entry_high"),
        "short_target": sp.get("target_price"),
        "short_stop_loss": sp.get("stop_loss"),
    }


def _codes_of(items: Any) -> List[str]:
    out: List[str] = []
    for x in items or []:
        code = x if isinstance(x, str) else (x or {}).get("code")
        if code:
            out.append(str(code))
    return out


def load_history(path: Path) -> Dict[str, Any]:
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("days"), dict):
                return data
        except Exception:
            pass
    return {"version": 1, "days": {}}


def seed_history_from_report(history: Dict[str, Any], prev_json: Dict[str, Any], current_as_of: str) -> None:
    """相容舊版（只保留一份 latest_report.json）：首次啟用歷史檔時由上一份報告回填前一交易日。"""
    days = history["days"]
    prev_as_of = prev_json.get("as_of_date")
    debates = prev_json.get("all_debates") or {}
    if prev_as_of and prev_as_of < current_as_of and prev_as_of not in days:
        days[prev_as_of] = {
            "plans": {c: _plan_snapshot(d) for c, d in debates.items()},
            "picks": {g: _codes_of(prev_json.get(k))[:10] for g, k in REPORT_LIST_KEYS.items()},
            "market_avg_pct": (prev_json.get("market_summary") or {}).get("avg_return_pct"),
        }
    elif prev_as_of == current_as_of:
        # 同日重跑：上一份報告內若有「真正前一交易日」的 yesterday_eval，回填該日價位規劃
        for c, d in debates.items():
            ye = d.get("yesterday_eval") or {}
            ye_date = ye.get("as_of_date")
            if ye.get("has_data") and ye_date and ye_date < current_as_of:
                day = days.setdefault(ye_date, {"plans": {}, "picks": {}})
                day["plans"].setdefault(c, {"name": d.get("name"), **{k: ye.get(k) for k in SNAPSHOT_KEYS}})


def build_track_record(prev_day: str, prev_entry: Dict[str, Any], as_of: str, stocks_map: Dict[str, Any], market_avg_pct: Any) -> Dict[str, Any]:
    """前一交易日各分類 AI Top 3 → 今日收盤的真實報酬（昨收→今收），做空組以下跌為勝。"""
    plans = prev_entry.get("plans") or {}
    groups: Dict[str, Any] = {}
    for g, codes in (prev_entry.get("picks") or {}).items():
        rows = []
        for c in codes[:3]:
            snap = plans.get(c) or {}
            now = stocks_map.get(c) or {}
            base = float(snap.get("close") or 0)
            cur = float(now.get("close") or 0)
            if base <= 0 or cur <= 0:
                continue
            ret = (cur - base) / base * 100.0
            is_short = g == "short_sell"
            eff = -ret if is_short else ret
            target = snap.get("short_target") if is_short else snap.get("target_price")
            stop = snap.get("short_stop_loss") if is_short else snap.get("stop_loss")
            rows.append(
                {
                    "code": c,
                    "name": now.get("name") or snap.get("name") or c,
                    "base": base,
                    "close": cur,
                    "ret_pct": round(ret, 2),
                    "win": eff > 0,
                    "hit_target": bool(target) and ((cur <= float(target)) if is_short else (cur >= float(target))),
                    "hit_stop": bool(stop) and ((cur >= float(stop)) if is_short else (cur <= float(stop))),
                }
            )
        if rows:
            effs = [(-r["ret_pct"] if g == "short_sell" else r["ret_pct"]) for r in rows]
            groups[g] = {
                "avg_ret_pct": round(sum(effs) / len(effs), 2),
                "wins": sum(1 for r in rows if r["win"]),
                "count": len(rows),
                "items": rows,
            }
    return {"from_date": prev_day, "to_date": as_of, "market_avg_pct": market_avg_pct, "groups": groups}


def generate_daily_intelligence_bundle(
    target_date: str | None = None,
    custom_watchlist: List[str] | None = None,
) -> Dict[str, Any]:
    root_dir = Path(__file__).resolve().parent
    watchlist_path = root_dir / "data" / "watchlist.json"
    watchlist = custom_watchlist or load_watchlist(watchlist_path)

    engine = TaiwanStockDataEngine(cache_dir=root_dir / "data")
    committee = MultiAgentStockCommittee(engine)

    snapshot = engine.build_full_market_intelligence(watchlist=watchlist, target_date=target_date)
    stocks_map = snapshot["stocks"]
    as_of = snapshot["as_of_date"]

    featured_codes: List[str] = []
    for c in watchlist:
        if c in stocks_map and c not in featured_codes:
            featured_codes.append(c)
    for group in [
        "top_picks",
        "short_term_picks",
        "swing_picks",
        "long_term_picks",
        "high_price_picks",
        "mid_price_picks",
        "low_price_picks",
        "short_sell_picks",
        "co_buy_leaders",
        "volume_hot",
    ]:
        for item in snapshot.get(group, [])[:6]:
            c = item["code"]
            if c not in featured_codes:
                featured_codes.append(c)

    debates_map: Dict[str, Dict[str, Any]] = {}
    klines_map: Dict[str, List[Dict[str, Any]]] = {}

    def _process_code(code: str) -> None:
        st = stocks_map[code]
        kline = engine.fetch_stock_kline_history(code, market=st["market"], days=60)
        # Yahoo 日 K 常缺當日 K 棒：以證交所/櫃買官方當日 OHLC 補上（技術指標才不會落後一天）
        if st.get("close"):
            close_p = round(float(st["close"]), 2)
            bar = {
                "time": as_of,
                "open": round(float(st.get("open") or close_p), 2),
                "high": round(float(st.get("high") or close_p), 2),
                "low": round(float(st.get("low") or close_p), 2),
                "close": close_p,
                "volume": int(float(st.get("volume_shares") or 0) // 1000),
            }
            if not kline or kline[-1]["time"] < as_of:
                kline = (kline + [bar])[-60:]
            elif kline[-1]["time"] == as_of:
                kline[-1] = bar
        klines_map[code] = kline
        debates_map[code] = committee.run_committee_debate(st, candles=kline, fetch_live_news=True)

    with ThreadPoolExecutor(max_workers=16) as ex:
        list(ex.map(_process_code, featured_codes[:80]))

    for code, st in stocks_map.items():
        if code not in debates_map:
            debates_map[code] = committee.run_committee_debate(st, candles=None, fetch_live_news=False)

    # 🔗 昨日 AI 評分與策略：改由「逐交易日」策略歷史檔取得，杜絕同日重跑把今日分數誤當昨日
    history_path = root_dir / "data" / "strategy_history.json"
    history = load_history(history_path)
    prev_report_file = root_dir / "data" / "latest_report.json"
    if prev_report_file.exists():
        try:
            seed_history_from_report(history, json.loads(prev_report_file.read_text(encoding="utf-8")), as_of)
        except Exception:
            pass

    prev_days = sorted(d for d in history["days"] if d < as_of)
    prev_day = prev_days[-1] if prev_days else None
    prev_entry = history["days"].get(prev_day) or {} if prev_day else {}
    prev_plans = prev_entry.get("plans") or {}

    for c_code, d_item in debates_map.items():
        snap = prev_plans.get(c_code)
        if snap and snap.get("close"):
            d_item["yesterday_eval"] = {"has_data": True, "as_of_date": prev_day, **{k: snap.get(k) for k in SNAPSHOT_KEYS}}
        else:
            d_item["yesterday_eval"] = {
                "has_data": False,
                "as_of_date": prev_day or "",
                "note": "今日新納入追蹤",
                "prev_close": d_item.get("prev_close"),
            }

    market_avg = (snapshot.get("market_summary") or {}).get("avg_return_pct")
    # 今日收盤價：以全市場字典為底（涵蓋所有上市櫃），再以完整個股資料覆蓋
    close_map: Dict[str, Any] = {
        c: {"name": v[0], "close": v[2]} for c, v in (snapshot.get("market_directory") or {}).items() if isinstance(v, list) and len(v) > 2
    }
    close_map.update(stocks_map)
    track_record = build_track_record(prev_day, prev_entry, as_of, close_map, market_avg) if prev_day else None
    if track_record and track_record["groups"]:
        prev_entry["result"] = {
            g: {k: v for k, v in r.items() if k != "items"} for g, r in track_record["groups"].items()
        }
        prev_entry["result_date"] = as_of

    history["days"][as_of] = {
        "plans": {c: _plan_snapshot(d) for c, d in debates_map.items()},
        "picks": {g: [x["code"] for x in snapshot.get(key, [])[:10]] for g, key in PICK_GROUPS.items()},
        "market_avg_pct": market_avg,
    }
    for old in sorted(history["days"])[:-HISTORY_KEEP_DAYS]:
        history["days"].pop(old, None)
    history_path.write_text(json.dumps(history, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    # 近期 AI 選股實績（每個交易日：前一日 Top 3 → 隔日收盤）
    track_history = []
    for d in sorted(history["days"]):
        res = history["days"][d].get("result")
        if res:
            track_history.append({"from_date": d, "to_date": history["days"][d].get("result_date"), "groups": res})

    def _map_debates(key: str) -> List[Dict[str, Any]]:
        return [debates_map[item["code"]] for item in snapshot.get(key, []) if item["code"] in debates_map]

    watchlist_debates = [debates_map[c] for c in watchlist if c in debates_map]
    top_picks_debates = _map_debates("top_picks")
    short_term_debates = _map_debates("short_term_picks")
    swing_debates = _map_debates("swing_picks")
    long_term_debates = _map_debates("long_term_picks")
    high_price_debates = _map_debates("high_price_picks")
    mid_price_debates = _map_debates("mid_price_picks")
    low_price_debates = _map_debates("low_price_picks")
    short_sell_debates = _map_debates("short_sell_picks")
    co_buy_debates = _map_debates("co_buy_leaders")
    volume_hot_debates = _map_debates("volume_hot")
    warning_debates = short_sell_debates[:8]

    report_bundle = {
        "schema_version": 2,
        "as_of_date": as_of,
        "generated_at": snapshot["generated_at"],
        "market_summary": snapshot["market_summary"],
        "sector_heatmap": snapshot["sector_heatmap"],
        "headline_news": snapshot["headline_news"],
        "watchlist_codes": watchlist,
        "watchlist_debates": watchlist_debates,
        "top_picks_debates": top_picks_debates,
        "short_term_debates": short_term_debates,
        "swing_debates": swing_debates,
        "long_term_debates": long_term_debates,
        "high_price_debates": high_price_debates,
        "mid_price_debates": mid_price_debates,
        "low_price_debates": low_price_debates,
        "short_sell_debates": short_sell_debates,
        "co_buy_debates": co_buy_debates,
        "volume_hot_debates": volume_hot_debates,
        "warning_debates": warning_debates,
        "track_record": track_record,
        "track_history": track_history[-20:],
        "all_debates": debates_map,
        "klines": klines_map,
        "market_directory": snapshot.get("market_directory", {}),
    }
    report_bundle["family_briefing_text"] = DailyBriefingNotifier.build_family_line_message(report_bundle)

    # 輸出瘦身：各分類清單只存代號（完整內容皆在 all_debates），並採緊湊 JSON，
    # 讓手機 APP 每次開啟下載量由 ~3.8MB 降至 ~1.3MB（GitHub Pages 另有 gzip 壓縮）。
    slim_bundle = dict(report_bundle)
    for key, val in report_bundle.items():
        if key.endswith("_debates") and isinstance(val, list):
            slim_bundle[key] = _codes_of(val)

    for out_path in [
        root_dir / "data" / "latest_report.json",
        root_dir / "docs" / "data" / "latest_report.json",
    ]:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(slim_bundle, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    md_path = root_dir / "docs" / "daily_briefing.md"
    md_path.write_text(report_bundle["family_briefing_text"] + "\n", encoding="utf-8")

    push_status = DailyBriefingNotifier.push_notifications(report_bundle)
    report_bundle["push_status"] = push_status
    return report_bundle


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="StockYuan 台股 AI 多智能體每日結算與選股引擎")
    parser.add_argument("--date", type=str, default=None, help="指定交易日 YYYY-MM-DD（選填）")
    args = parser.parse_args()

    bundle = generate_daily_intelligence_bundle(target_date=args.date)
    print(f"[StockYuan] 盤後結算與多維度報告已生成！交易日: {bundle['as_of_date']} | 分析標的: {len(bundle['all_debates'])} 檔")
    print(f"  ⚡ 短線首選: {bundle['short_term_debates'][0]['code']} {bundle['short_term_debates'][0]['name']}")
    print(f"  🌊 波段首選: {bundle['swing_debates'][0]['code']} {bundle['swing_debates'][0]['name']}")
    print(f"  🌳 長線首選: {bundle['long_term_debates'][0]['code']} {bundle['long_term_debates'][0]['name']}")
    print(f"  💎 高價首選(>=200): {bundle['high_price_debates'][0]['code']} {bundle['high_price_debates'][0]['name']} ({bundle['high_price_debates'][0]['close']}元)")
    print(f"  ⚖️ 中低價首選(50~200): {bundle['mid_price_debates'][0]['code']} {bundle['mid_price_debates'][0]['name']} ({bundle['mid_price_debates'][0]['close']}元)")
    print(f"  🪙 銅板首選(<50): {bundle['low_price_debates'][0]['code']} {bundle['low_price_debates'][0]['name']} ({bundle['low_price_debates'][0]['close']}元)")
    print(f"  🐻 做空專區首選: {bundle['short_sell_debates'][0]['code']} {bundle['short_sell_debates'][0]['name']} (空方分={bundle['short_sell_debates'][0]['short_sell_score']})")
    tr = bundle.get("track_record") or {}
    for g, r in (tr.get("groups") or {}).items():
        print(f"  📊 實績 {tr.get('from_date')}→{tr.get('to_date')} [{g}] 平均 {r['avg_ret_pct']:+.2f}% 勝 {r['wins']}/{r['count']}")


if __name__ == "__main__":
    main()
