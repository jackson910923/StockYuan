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
        klines_map[code] = kline
        debates_map[code] = committee.run_committee_debate(st, candles=kline, fetch_live_news=True)

    with ThreadPoolExecutor(max_workers=16) as ex:
        list(ex.map(_process_code, featured_codes[:80]))

    for code, st in stocks_map.items():
        if code not in debates_map:
            debates_map[code] = committee.run_committee_debate(st, candles=None, fetch_live_news=False)

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
        "as_of_date": snapshot["as_of_date"],
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
        "all_debates": debates_map,
        "klines": klines_map,
        "market_directory": snapshot.get("market_directory", {}),
    }
    report_bundle["family_briefing_text"] = DailyBriefingNotifier.build_family_line_message(report_bundle)

    for out_path in [
        root_dir / "data" / "latest_report.json",
        root_dir / "docs" / "data" / "latest_report.json",
    ]:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report_bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    md_path = root_dir / "docs" / "daily_briefing.md"
    md_path.write_text(report_bundle["family_briefing_text"] + "\n", encoding="utf-8")

    push_status = DailyBriefingNotifier.push_notifications(report_bundle)
    report_bundle["push_status"] = push_status
    return report_bundle


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="AlphaTW 4.0 台股領航 AI 多智能體每日結算與選股引擎")
    parser.add_argument("--date", type=str, default=None, help="指定交易日 YYYY-MM-DD（選填）")
    args = parser.parse_args()

    bundle = generate_daily_intelligence_bundle(target_date=args.date)
    print(f"[AlphaTW 4.0] 盤後結算與多維度報告已生成！交易日: {bundle['as_of_date']} | 分析標的: {len(bundle['all_debates'])} 檔")
    print(f"  ⚡ 短線首選: {bundle['short_term_debates'][0]['code']} {bundle['short_term_debates'][0]['name']}")
    print(f"  🌊 波段首選: {bundle['swing_debates'][0]['code']} {bundle['swing_debates'][0]['name']}")
    print(f"  🌳 長線首選: {bundle['long_term_debates'][0]['code']} {bundle['long_term_debates'][0]['name']}")
    print(f"  💎 高價首選(>=200): {bundle['high_price_debates'][0]['code']} {bundle['high_price_debates'][0]['name']} ({bundle['high_price_debates'][0]['close']}元)")
    print(f"  ⚖️ 中低價首選(50~200): {bundle['mid_price_debates'][0]['code']} {bundle['mid_price_debates'][0]['name']} ({bundle['mid_price_debates'][0]['close']}元)")
    print(f"  🪙 銅板首選(<50): {bundle['low_price_debates'][0]['code']} {bundle['low_price_debates'][0]['name']} ({bundle['low_price_debates'][0]['close']}元)")
    print(f"  🐻 做空專區首選: {bundle['short_sell_debates'][0]['code']} {bundle['short_sell_debates'][0]['name']} (空方分={bundle['short_sell_debates'][0]['short_sell_score']})")


if __name__ == "__main__":
    main()
