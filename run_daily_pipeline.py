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
    default_list = ["2330", "2317", "2454", "6669", "3533", "1802", "2603", "2618", "2891", "2412"]
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

    # 收集需要執行 6-Agent 多空辯論與 K 線抓取的核心標的
    featured_codes: List[str] = []
    for c in watchlist:
        if c in stocks_map and c not in featured_codes:
            featured_codes.append(c)
    for group in ["top_picks", "co_buy_leaders", "volume_hot", "warning_list"]:
        for item in snapshot.get(group, []):
            c = item["code"]
            if c not in featured_codes:
                featured_codes.append(c)

    # 併發執行個股新聞抓取、6-Agent 多空辯論與 K 線歷史資料
    debates_map: Dict[str, Dict[str, Any]] = {}
    klines_map: Dict[str, List[Dict[str, Any]]] = {}

    def _process_code(code: str) -> None:
        st = stocks_map[code]
        debates_map[code] = committee.run_committee_debate(st, fetch_live_news=True)
        klines_map[code] = engine.fetch_stock_kline_history(code, market=st["market"], days=45)

    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(_process_code, featured_codes[:28]))

    # 對其餘未抓新聞的標的亦生成完整量化辯論結構（不發額外 RSS 請求以保持極速）
    for code, st in stocks_map.items():
        if code not in debates_map:
            debates_map[code] = committee.run_committee_debate(st, fetch_live_news=False)

    watchlist_debates = [debates_map[c] for c in watchlist if c in debates_map]
    top_picks_debates = [debates_map[item["code"]] for item in snapshot["top_picks"] if item["code"] in debates_map]
    co_buy_debates = [debates_map[item["code"]] for item in snapshot["co_buy_leaders"] if item["code"] in debates_map]
    volume_hot_debates = [debates_map[item["code"]] for item in snapshot["volume_hot"] if item["code"] in debates_map]
    warning_debates = [debates_map[item["code"]] for item in snapshot["warning_list"] if item["code"] in debates_map]

    report_bundle = {
        "as_of_date": snapshot["as_of_date"],
        "generated_at": snapshot["generated_at"],
        "market_summary": snapshot["market_summary"],
        "headline_news": snapshot["headline_news"],
        "watchlist_codes": watchlist,
        "watchlist_debates": watchlist_debates,
        "top_picks_debates": top_picks_debates,
        "co_buy_debates": co_buy_debates,
        "volume_hot_debates": volume_hot_debates,
        "warning_debates": warning_debates,
        "all_debates": debates_map,
        "klines": klines_map,
    }
    report_bundle["dad_briefing_text"] = DailyBriefingNotifier.build_dad_line_message(report_bundle)

    # 同步寫入 data/ 與 docs/data/（支援 GitHub Pages 靜態無伺服器直接開啟！）
    for out_path in [
        root_dir / "data" / "latest_report.json",
        root_dir / "docs" / "data" / "latest_report.json",
    ]:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report_bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    md_path = root_dir / "docs" / "daily_briefing.md"
    md_path.write_text(report_bundle["dad_briefing_text"] + "\n", encoding="utf-8")

    push_status = DailyBriefingNotifier.push_notifications(report_bundle)
    report_bundle["push_status"] = push_status
    return report_bundle


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="AlphaTW 台股領航 AI 多智能體每日結算與選股引擎")
    parser.add_argument("--date", type=str, default=None, help="指定交易日 YYYY-MM-DD（選填）")
    args = parser.parse_args()

    bundle = generate_daily_intelligence_bundle(target_date=args.date)
    print(f"[AlphaTW] 盤後結算與多空辯論報告已生成！交易日: {bundle['as_of_date']}")
    print(f"[AlphaTW] 共深度分析 {len(bundle['all_debates'])} 檔上市櫃個股，Top 3 推薦：")
    for p in bundle["top_picks_debates"][:3]:
        print(
            f"  - {p['code']} {p['name']} ({p['close']}元, {p['change_pct']:+.2f}%): "
            f"總分={p['total_score']} | {p['verdict']['badge']} | 買點={p['price_plan']['entry_low']}~{p['price_plan']['entry_high']}"
        )


if __name__ == "__main__":
    main()
