from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Dict


class DailyBriefingNotifier:
    """
    每日盤後結算與白話投資日報推播器：
    支援 Telegram Bot、Discord Webhook，以及產出可一鍵分享至 LINE 群組的精華日報。
    """

    @staticmethod
    def build_family_line_message(report: Dict[str, Any]) -> str:
        as_of = report.get("as_of_date", "")
        ms = report.get("market_summary", {})
        picks = report.get("top_picks_debates", [])[:4]
        watch_debates = report.get("watchlist_debates", [])[:6]
        sectors = report.get("sector_heatmap", [])[:3]

        lines = [
            f"📈 【AlphaTW 台股 AI 投研日報｜{as_of} 最新總結】",
            f"━━━━━━━━━━━━━━",
            f"📊 市場狀態：{ms.get('regime', '震盪選股')}",
            f"• 上漲：{ms.get('up_count', 0)} 家｜下跌：{ms.get('down_count', 0)} 家（全場平均 {ms.get('avg_return_pct', 0):+.2f}%）",
        ]

        if sectors:
            sec_str = "、".join(f"{s['sector']}({s['leader_name']})" for s in sectors)
            lines.append(f"🔥 資金最強族群：{sec_str}")

        lines.extend(["", "🎯 【AI 嚴選法人認養強勢股】"])
        for idx, p in enumerate(picks, 1):
            plan = p["price_plan"]
            tech = p.get("technicals", {})
            lines.append(
                f"{idx}. {p['name']} ({p['code']}) 收 {p['close']}元 ({p['change_pct']:+.2f}%)\n"
                f"   • 總評：{p['total_score']}分｜{p['verdict']['easy_action']}\n"
                f"   • 籌碼：外資 {p['metrics']['foreign_lots']:+.0f}張 / 投信 {p['metrics']['trust_lots']:+.0f}張｜KD {tech.get('kd_signal', '')}\n"
                f"   • 建議買點：{plan['entry_low']}～{plan['entry_high']}元｜停損：{plan['stop_loss']}元｜目標：{plan['target_price']}元"
            )

        if watch_debates:
            lines.append("")
            lines.append("📋 【核心關注與自選持股健檢】")
            for w in watch_debates:
                light_icon = (
                    "🟢"
                    if w["verdict"]["easy_light"] == "GREEN"
                    else ("🟡" if w["verdict"]["easy_light"] == "YELLOW" else "🔴")
                )
                plan = w["price_plan"]
                lines.append(
                    f"{light_icon} {w['name']}({w['code']}) {w['close']}元 ({w['change_pct']:+.2f}%) ➔ {w['verdict']['easy_action']}（防守價 {plan['stop_loss']}元）"
                )

        lines.append("\n💡 紀律提醒：買綠不買紅、沿均線分批低接不追高！")
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
