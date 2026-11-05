from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Dict, List


class DailyBriefingNotifier:
    """
    每日盤後結算與白話投資日報推播器：
    支援 Telegram Bot、Discord Webhook，以及產出可一鍵分享至 LINE 群組的精華日報（完整列出各分類 Top 3）。
    """

    @staticmethod
    def _format_top3_lines(title: str, items: List[Dict[str, Any]], is_short: bool = False) -> List[str]:
        medals = ["🥇", "🥈", "🥉"]
        out = [f"\n{title}"]
        for idx, p in enumerate(items[:3]):
            medal = medals[idx] if idx < 3 else f"{idx+1}."
            if is_short:
                sp = p.get("short_sell_plan", {})
                out.append(
                    f"{medal} {p['name']}({p['code']}) 收{p['close']}元({p['change_pct']:+.2f}%)｜空方{sp.get('score', 0)}分\n"
                    f"   👉 反彈空點：{sp.get('entry_low')}~{sp.get('entry_high')}元｜回補停損：{sp.get('stop_loss')}元｜下看：{sp.get('target_price')}元"
                )
            else:
                plan = p["price_plan"]
                out.append(
                    f"{medal} {p['name']}({p['code']}) 收{p['close']}元({p['change_pct']:+.2f}%)｜總分{p['total_score']}分\n"
                    f"   👉 買點：{plan['entry_low']}~{plan['entry_high']}元｜停損：{plan['stop_loss']}元｜目標：{plan['target_price']}元"
                )
        return out

    @staticmethod
    def build_family_line_message(report: Dict[str, Any]) -> str:
        as_of = report.get("as_of_date", "")
        ms = report.get("market_summary", {})
        sectors = report.get("sector_heatmap", [])[:3]

        lines = [
            f"📈 【StockYuan 台股領航 AI 投研日報｜{as_of} 最新總結】",
            f"━━━━━━━━━━━━━━",
            f"📊 市場格局：{ms.get('regime', '震盪選股')}",
            f"• 上漲：{ms.get('up_count', 0)} 家｜下跌：{ms.get('down_count', 0)} 家（平均 {ms.get('avg_return_pct', 0):+.2f}%）",
        ]

        if sectors:
            sec_str = "、".join(f"{s['sector']}({s['leader_name']})" for s in sectors)
            lines.append(f"🔥 資金最強族群：{sec_str}")

        lines.extend(
            DailyBriefingNotifier._format_top3_lines(
                "🏆 【目前做多綜合最推薦 Top 3】", report.get("top_picks_debates", [])
            )
        )
        lines.extend(
            DailyBriefingNotifier._format_top3_lines(
                "⚡ 【短線衝刺 (1~5日) 最推薦 Top 3】", report.get("short_term_debates", [])
            )
        )
        lines.extend(
            DailyBriefingNotifier._format_top3_lines(
                "🌊 【波段認養 (2~8週) 最推薦 Top 3】", report.get("swing_debates", [])
            )
        )
        lines.extend(
            DailyBriefingNotifier._format_top3_lines(
                "🌳 【長線價值存股 (季/年) 最推薦 Top 3】", report.get("long_term_debates", [])
            )
        )
        lines.extend(
            DailyBriefingNotifier._format_top3_lines(
                "💎 【高價股 (200元以上) 最推薦 Top 3】", report.get("high_price_debates", [])
            )
        )
        lines.extend(
            DailyBriefingNotifier._format_top3_lines(
                "⚖️ 【中低價股 (50~200元) 最推薦 Top 3】", report.get("mid_price_debates", [])
            )
        )
        lines.extend(
            DailyBriefingNotifier._format_top3_lines(
                "🪙 【低價銅板股 (50元以下) 最推薦 Top 3】", report.get("low_price_debates", [])
            )
        )
        lines.extend(
            DailyBriefingNotifier._format_top3_lines(
                "🐻 【做空／避險放空專區 Top 3】", report.get("short_sell_debates", []), is_short=True
            )
        )

        lines.append("\n💡 紀律提醒：做多買綠不買紅、做空等反彈不追殺，嚴守停損／回補防守線！")
        return "\n".join(lines)

    @classmethod
    def push_notifications(cls, report: Dict[str, Any]) -> Dict[str, str]:
        msg = cls.build_family_line_message(report)
        results: Dict[str, str] = {}

        tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        tg_chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        if tg_token and tg_chat_id:
            try:
                url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
                payload = json.dumps({"chat_id": tg_chat_id, "text": msg}).encode("utf-8")
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=8.0)
                results["telegram"] = "sent"
            except Exception as e:
                results["telegram"] = f"error: {e}"

        discord_url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
        if discord_url:
            try:
                payload = json.dumps({"content": msg}).encode("utf-8")
                req = urllib.request.Request(
                    discord_url,
                    data=payload,
                    headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
                )
                urllib.request.urlopen(req, timeout=8.0)
                results["discord"] = "sent"
            except Exception as e:
                results["discord"] = f"error: {e}"

        return results
