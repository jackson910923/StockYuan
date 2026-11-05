from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Dict, List


class MultiAgentStockCommittee:
    """
    融合 TradingAgents（多空辯論 Bull vs. Bear）與 ai-hedge-fund（大師圓桌投票）之台股旗艦多智能體引擎。
    同時產出：
    1. 【專業交易員模式 (Pro Trader View)】：籌碼/技術/新聞三維證據鏈、多空激辯紀錄、精準進出場區間與期望風報比。
    2. 【老爸專屬白話模式 (Dad's Friendly View)】：紅綠燈號、零術語大白話講解、明確「幾元以下買、跌破幾元停損」。
    """

    def __init__(self, data_engine: Any) -> None:
        self.data_engine = data_engine

    @staticmethod
    def _classify_action(stock: Dict[str, Any]) -> Dict[str, str]:
        score = float(stock.get("total_score", 50.0))
        inst_lots = float(stock.get("inst_total_lots", 0.0))
        ma_gap = float(stock.get("ma_gap_pct", 0.0))
        ret = float(stock.get("change_pct", 0.0))

        if score >= 74.0 and inst_lots > 0 and ma_gap <= 5.5:
            return {
                "signal": "STRONG_BUY",
                "badge": "🟢 強烈推薦買進（法人認養＋未追高）",
                "dad_light": "GREEN",
                "dad_action": "可以逢低分批買進",
            }
        if score >= 64.0 and inst_lots >= 0:
            if ma_gap > 5.5 or ret >= 6.0:
                return {
                    "signal": "HOLD_WAIT_DIP",
                    "badge": "🟡 強勢續抱／拉回再買（短線勿追高）",
                    "dad_light": "YELLOW",
                    "dad_action": "有股票續抱，空手等拉回再買",
                }
            return {
                "signal": "ACCUMULATE",
                "badge": "🟢 偏多布局（沿均線分批低接）",
                "dad_light": "GREEN",
                "dad_action": "趨勢穩健，可小量分批布局",
            }
        if score >= 48.0:
            return {
                "signal": "NEUTRAL_HOLD",
                "badge": "⚪ 區間整理觀望（守穩停損續抱）",
                "dad_light": "YELLOW",
                "dad_action": "先觀望不加碼，守住停損價即可",
            }
        return {
            "signal": "REDUCE_AVOID",
            "badge": "🔴 警戒減碼／避開（法人調節破線）",
            "dad_light": "RED",
            "dad_action": "外資投信在賣，建議逢反彈減碼或先避開",
        }

    def run_committee_debate(self, stock: Dict[str, Any], fetch_live_news: bool = True) -> Dict[str, Any]:
        """針對單一台股標的執行 6 大 Agent 深度會診與多空辯論。"""
        code = stock["code"]
        name = stock["name"]
        close_p = stock["close"]
        ret_pct = stock["change_pct"]
        ma_short = stock["ma_short"]
        ma_mid = stock["ma_mid"]
        ma_gap = stock["ma_gap_pct"]
        f_lots = stock["foreign_lots"]
        t_lots = stock["trust_lots"]
        d_lots = stock["dealer_lots"]
        inst_lots = stock["inst_total_lots"]
        f_3d = stock["foreign_3d_lots"]
        t_3d = stock["trust_3d_lots"]
        inst_3d_yi = stock["inst_3d_val_yi"]
        margin_lots = stock["margin_diff_lots"]
        dt_pct = stock["day_trade_pct"]
        entry_low, entry_high = stock["entry_zone"]
        stop_loss = stock["stop_loss"]
        target_p = stock["target_price"]
        rr_ratio = stock["risk_reward_ratio"]

        verdict = self._classify_action(stock)

        # 個股即時新聞抓取
        news_items: List[Dict[str, str]] = []
        if fetch_live_news:
            news_items = self.data_engine.fetch_google_news_for_query(f"{code} {name}", limit=4)

        # 1. 籌碼追蹤官 (Smart Money Chip Agent)
        if f_lots > 0 and t_lots > 0:
            chip_headline = f"外資與投信今日同步買超（外資 {f_lots:+.0f} 張、投信 {t_lots:+.0f} 張），形成高勝率『土洋同買』共振。"
        elif t_lots > 30:
            chip_headline = f"投信法人今日買超 {t_lots:+.0f} 張（近 3 日累計 {t_3d:+.0f} 張），具備內資投信作帳認養支撐。"
        elif f_lots > 200:
            chip_headline = f"外資今日主導買超 {f_lots:+.0f} 張（近 3 日加權淨流入 {inst_3d_yi:+.2f} 億元），大型機構資金偏多。"
        elif inst_lots < -200:
            chip_headline = f"三大法人今日合計調節 {inst_lots:+.0f} 張（外資 {f_lots:+.0f} 張、投信 {t_lots:+.0f} 張），機構籌碼短線偏空。"
        else:
            chip_headline = f"三大法人今日合計 {inst_lots:+.0f} 張（外資 {f_lots:+.0f} 張、投信 {t_lots:+.0f} 張），籌碼處於換手整理階段。"

        margin_note = (
            f"融資減少 {abs(margin_lots):.0f} 張（散戶浮額清洗乾淨，籌碼流向大戶）"
            if margin_lots < -30
            else f"融資增加 {margin_lots:+.0f} 張（留意散戶短線跟風）"
            if margin_lots > 100
            else f"融資變動 {margin_lots:+.0f} 張（散戶籌碼平穩）"
        )

        # 2. 量化技術分析官 (Quant Technical Agent)
        trend_state = (
            f"股價收 {close_p} 元（{ret_pct:+.2f}%），穩站短期均線（{ma_short} 元）與多日均線（{ma_mid} 元）之上，多頭排列確立。"
            if close_p >= ma_mid
            else f"股價收 {close_p} 元（{ret_pct:+.2f}%），目前位於多日均線（{ma_mid} 元）下方（乖離 {ma_gap:+.2f}%），需等待站回 {ma_short} 元確認止穩。"
        )

        # 3. 多空辯論室 (Bullish vs. Bearish Debate)
        bull_points: List[str] = []
        bear_points: List[str] = []

        if inst_lots > 0:
            bull_points.append(f"三大法人單日淨買超 {inst_lots:+.0f} 張、近 3 日加權買超金額 {inst_3d_yi:+.2f} 億元，主力資金明確站在買方。")
        if close_p >= ma_mid:
            bull_points.append(f"收盤價 {close_p} 元站穩多日均線 {ma_mid} 元之上，量能倍數 {stock['vol_ratio']}x 具攻擊力道。")
        if margin_lots <= 0:
            bull_points.append(f"散戶融資未見失控（{margin_lots:+.0f} 張）且當沖佔比 {dt_pct:.1f}%，籌碼安定度高。")
        if not bull_points:
            bull_points.append(f"短線急跌後乖離達 {ma_gap:+.2f}%，若在 {stop_loss} 元附近縮量止穩具備跌深技術反彈契機。")

        if ma_gap > 5.0 or ret_pct > 5.5:
            bear_points.append(f"短線正乖離達 {ma_gap:+.2f}%（單日漲幅 {ret_pct:+.2f}%），直接追高容易遭遇隔日沖獲利了結賣壓，宜等拉回 {entry_high} 元以下承接。")
        if dt_pct > 38.0:
            bear_points.append(f"當沖成交佔比達 {dt_pct:.1f}%，盤中短線客進出頻繁，尾盤易出現震盪。")
        if inst_lots < 0:
            bear_points.append(f"外資（{f_lots:+.0f} 張）與投信（{t_lots:+.0f} 張）尚未全面轉買，反彈遇到均線 {ma_mid} 元會有解套賣壓。")
        if not bear_points:
            bear_points.append(f"若國際科技股或台指期夜盤震盪，需嚴守 {stop_loss} 元作為波段防守底線。")

        # 4. 三大台股大師流派圓桌投票 (Master Personas)
        personas = [
            {
                "name": "外資權值趨勢派",
                "vote": "看多買進" if (f_lots > 0 and close_p >= ma_mid) else ("中性續抱" if f_3d >= 0 else "保守調節"),
                "reason": f"外資單日 {f_lots:+.0f} 張、3 日累計 {f_3d:+.0f} 張，近 3 日機構資金流向 {inst_3d_yi:+.2f} 億。",
            },
            {
                "name": "投信作帳成長派",
                "vote": "強烈看多" if t_lots > 30 else ("偏多觀察" if t_3d >= 0 else "暫不介入"),
                "reason": f"投信單日 {t_lots:+.0f} 張、3 日累計 {t_3d:+.0f} 張，重點觀察投信是否連續認養。",
            },
            {
                "name": "安全邊際防追高派",
                "vote": "安全可買" if (ma_gap <= 4.0 and dt_pct <= 38.0 and stock["total_score"] >= 60) else "等拉回再買",
                "reason": f"均線乖離率 {ma_gap:+.2f}%、當沖佔比 {dt_pct:.1f}%、期望風報比 1 : {rr_ratio}。",
            },
        ]

        # 5. 老爸專屬大白話翻譯卡 (Dad's Plain-Language Card)
        dad_summary = (
            f"【{name}（{code}）】今天收盤 {close_p} 元（漲跌 {ret_pct:+.2f}%）。"
            f"{'外資跟投信法人今天都在買進，籌碼很穩！' if (f_lots > 0 and t_lots > 0) else ('法人今天站在買方護盤。' if inst_lots > 0 else '要注意今天外資或投信有在賣股票。')}"
            f"如果您想買，建議等股價在 {entry_low} ～ {entry_high} 元之間再分批買，不要追高；"
            f"手上如果已經有這檔股票，只要沒跌破 {stop_loss} 元都可以安心抱著，波段目標先看 {target_p} 元附近。"
        )

        return {
            "code": code,
            "name": name,
            "sector": stock["sector"],
            "market": stock["market"],
            "close": close_p,
            "change": stock["change"],
            "change_pct": ret_pct,
            "total_score": stock["total_score"],
            "chip_score": stock["chip_score"],
            "trend_score": stock["trend_score"],
            "risk_score": stock["risk_score"],
            "verdict": verdict,
            "price_plan": {
                "entry_low": entry_low,
                "entry_high": entry_high,
                "stop_loss": stop_loss,
                "target_price": target_p,
                "risk_reward_ratio": rr_ratio,
            },
            "agents": {
                "chip_agent": f"{chip_headline} 此外，{margin_note}。",
                "technical_agent": f"{trend_state} 建議低接區間 {entry_low}～{entry_high} 元，跌破 {stop_loss} 元停損，上檔目標價 {target_p} 元（風報比 1:{rr_ratio}）。",
                "bull_researcher": bull_points,
                "bear_researcher": bear_points,
                "personas": personas,
                "dad_advisor": dad_summary,
            },
            "news": news_items,
            "metrics": {
                "foreign_lots": f_lots,
                "trust_lots": t_lots,
                "dealer_lots": d_lots,
                "inst_total_lots": inst_lots,
                "inst_3d_val_yi": inst_3d_yi,
                "margin_diff_lots": margin_lots,
                "day_trade_pct": dt_pct,
                "turnover_yi": stock["turnover_yi"],
                "ma_short": ma_short,
                "ma_mid": ma_mid,
                "ma_gap_pct": ma_gap,
            },
        }
