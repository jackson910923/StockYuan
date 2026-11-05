from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Dict


class DailyBriefingNotifier:
    """
    每日盤後結算與白話投資日報推播器：
    支援 Telegram Bot、Discord Webhook，以及產出可一鍵分享至 LINE 群組的精華日報（含短線/波段/長線、高/中低/低價股與做空專區）。
    """

    @staticmethod
    def build_family_line_message(report: Dict[str, Any]) -> str:
        as_of = report.get("as_of_date", "")
        ms = report.get("market_summary", {})
        st_picks = report.get("short_term_debates", [])[:2]
        sw_picks = report.get("swing_debates", [])[:2]
        lt_picks = report.get("long_term_debates", [])[:2]
        hi_picks = report.get("high_price_debates", [])[:2]
        mid_picks = report.get("mid_price_debates", [])[:2]
        low_picks = report.get("low_price_debates", [])[:2]
        short_picks = report.get("short_sell_debates", [])[:2]
        sectors = report.get("sector_heatmap", [])[:3]

        lines = [
            f"📈 【AlphaTW 4.0 台股 AI 投研日報｜{as_of} 最新總結】",
            f"━━━━━━━━━━━━━━",
            f"📊 市場狀態：{ms.get('regime', '震盪選股')}",
            f"• 上漲：{ms.get('up_count', 0)} 家｜下跌：{ms.get('down_count', 0)} 家（平均 {ms.get('avg_return_pct', 0):+.2f}%）",
        ]

        if sectors:
            sec_str = "、".join(f"{s['sector']}({s['leader_name']})" for s in sectors)
            lines.append(f"🔥 資金最強族群：{sec_str}")

        lines.extend(["", "⏱️ 【一、三大週期精選建議（短線／波段／長線）】"])
        for label, group in [
            ("⚡ 短線衝刺(1~5日)", st_picks),
            ("🌊 波段認養(2~8週)", sw_picks),
            ("🌳 長線價值(季/年)", lt_picks),
        ]:
            if group:
                p = group[0]
                plan = p["price_plan"]
                lines.append(
                    f"• {label}：{p['name']}({p['code']}) 收{p['close']}元({p['change_pct']:+.2f}%) "
                    f"➔ 買點 {plan['entry_low']}~{plan['entry_high']}元｜停損 {plan['stop_loss']}元｜目標 {plan['target_price']}元"
                )

        lines.extend(["", "💰 【二、高／中低／低價股分級首選】"])
        for tier_label, group in [
            ("💎 高價股(≥200元)", hi_picks),
            ("⚖️ 中低價(50~200元)", mid_picks),
            ("🪙 低價銅板(<50元)", low_picks),
        ]:
            if group:
                items_str = "、".join(
                    f"{p['name']}({p['code']} {p['close']}元/買點{p['price_plan']['entry_low']}~{p['price_plan']['entry_high']})"
                    for p in group
                )
                lines.append(f"• {tier_label}：{items_str}")

        if short_picks:
            lines.extend(["", "🐻 【三、做空／避險放空警戒專區】"])
            for sp in short_picks:
                splan = sp.get("short_sell_plan", {})
                lines.append(
                    f"• 🟣 {sp['name']}({sp['code']}) 收{sp['close']}元({sp['change_pct']:+.2f}%)｜空方評分 {splan.get('score', 0)}分\n"
                    f"  反彈空點：{splan.get('entry_low')}~{splan.get('entry_high')}元｜防軋空回補：{splan.get('stop_loss')}元｜下看目標：{splan.get('target_price')}元"
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
