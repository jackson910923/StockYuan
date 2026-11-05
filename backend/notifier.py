from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any, Dict, List


class DailyBriefingNotifier:
    """
    每日盤後結算與老爸專屬白話日報推播器：
    支援 Telegram Bot、LINE Messaging API / Webhook、Discord Webhook，以及產出 Markdown 日報。
    """

    @staticmethod
    def build_dad_line_message(report: Dict[str, Any]) -> str:
        as_of = report.get("as_of_date", "")
        ms = report.get("market_summary", {})
        picks = report.get("top_picks_debates", [])[:3]
        watch_debates = report.get("watchlist_debates", [])[:5]

        lines = [
            f"📈 【台股 AI 領航日報｜{as_of} 盤後總結】",
            f"━━━━━━━━━━━━━━",
            f"📊 大盤狀態：{ms.get('regime', '震盪選股')}",
            f"• 上漲：{ms.get('up_count', 0)} 家｜下跌：{ms.get('down_count', 0)} 家（平均 {ms.get('avg_return_pct', 0):+.2f}%）",
            "",
            "🎯 【明日 AI 嚴選 3 檔法人認養強勢股】",
        ]
        for idx, p in enumerate(picks, 1):
            plan = p["price_plan"]
            lines.append(
                f"{idx}. {p['name']} ({p['code']}) 收 {p['close']}元 ({p['change_pct']:+.2f}%)\n"
                f"   • 評分：{p['total_score']}分｜{p['verdict']['dad_action']}\n"
                f"   • 法人：外資 {p['metrics']['foreign_lots']:+.0f}張 / 投信 {p['metrics']['trust_lots']:+.0f}張\n"
                f"   • 建議買點：{plan['entry_low']}～{plan['entry_high']}元｜停損：{plan['stop_loss']}元｜目標：{plan['target_price']}元"
            )

        if watch_debates:
            lines.append("")
            lines.append("👨‍🦳 【老爸與自選持股每日健檢】")
            for w in watch_debates:
                light_icon = "🟢" if w["verdict"]["dad_light"] == "GREEN" else ("🟡" if w["verdict"]["dad_light"] == "YELLOW" else "🔴")
                plan = w["price_plan"]
                lines.append(
                    f"{light_icon} {w['name']}({w['code']}) {w['close']}元 ({w['change_pct']:+.2f}%) ➔ {w['verdict']['dad_action']}（守 {plan['stop_loss']}元）"
                )

        lines.append("\n💡 提醒：買綠不買紅、分批低接不追高！")
        return "\n".join(lines)

    @classmethod
    def push_notifications(cls, report: Dict[str, Any]) -> Dict[str, str]:
        msg = cls.build_dad_line_message(report)
        results: Dict[str, str] = {}

        # 1. Telegram Bot 推播
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

        # 2. Discord Webhook 推播
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
