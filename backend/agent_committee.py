from __future__ import annotations

from typing import Any, Dict, List


class MultiAgentStockCommittee:
    """
    融合 TradingAgents（多空辯論 Bull vs. Bear）與 ai-hedge-fund（6 大師流派圓桌投票）之台股旗艦多智能體引擎。
    全面支援：
    1. 【三大操作週期專屬策略】：⚡ 短線衝刺 (1~5日) / 🌊 波段操作 (2~8週) / 🌳 長線價值存股 (1季以上)
    2. 【三大股價位階資金配置】：💎 高價股 (≥200元) / ⚖️ 中低價股 (50~200元) / 🪙 低價銅板股 (<50元)
    3. 【🐻 做空／避險放空專區】：反彈布空區間、防軋空鐵律回補停損價、下跌目標回補價與軋空風險檢測
    4. 【雙模式切換】：專業量化終端 (Pro View) × 白話直覺模式 (Easy View)
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
                "easy_light": "GREEN",
                "easy_action": "可以逢低分批買進",
            }
        if score >= 64.0 and inst_lots >= 0:
            if ma_gap > 5.5 or ret >= 6.0:
                return {
                    "signal": "HOLD_WAIT_DIP",
                    "badge": "🟡 強勢續抱／拉回再買（短線勿追高）",
                    "easy_light": "YELLOW",
                    "easy_action": "有持股可續抱，空手等拉回再買",
                }
            return {
                "signal": "ACCUMULATE",
                "badge": "🟢 偏多布局（沿均線分批低接）",
                "easy_light": "GREEN",
                "easy_action": "趨勢穩健，可小量分批布局",
            }
        if score >= 48.0:
            return {
                "signal": "NEUTRAL_HOLD",
                "badge": "⚪ 區間整理觀望（守穩停損續抱）",
                "easy_light": "YELLOW",
                "easy_action": "先觀望不急著加碼，守住停損價即可",
            }
        return {
            "signal": "REDUCE_AVOID",
            "badge": "🔴 警戒減碼／偏空轉弱（法人調節破線）",
            "easy_light": "RED",
            "easy_action": "大戶法人在賣，建議逢反彈減碼或轉入做空觀察",
        }

    def run_committee_debate(
        self,
        stock: Dict[str, Any],
        candles: List[Dict[str, Any]] | None = None,
        fetch_live_news: bool = True,
    ) -> Dict[str, Any]:
        """針對單一台股標的執行 6 大 Agent 深度會診、三週期策略、價位分級與做空專區運算。"""
        code = stock["code"]
        name = stock["name"]
        close_p = float(stock["close"])
        ret_pct = float(stock["change_pct"])
        ma_short = float(stock["ma_short"])
        ma_mid = float(stock["ma_mid"])
        ma_gap = float(stock["ma_gap_pct"])
        atr_val = float(stock.get("atr", max(close_p * 0.018, 0.5)))
        f_lots = float(stock["foreign_lots"])
        t_lots = float(stock["trust_lots"])
        d_lots = float(stock["dealer_lots"])
        inst_lots = float(stock["inst_total_lots"])
        f_3d = float(stock["foreign_3d_lots"])
        t_3d = float(stock["trust_3d_lots"])
        inst_3d_yi = float(stock["inst_3d_val_yi"])
        margin_lots = float(stock["margin_diff_lots"])
        dt_pct = float(stock["day_trade_pct"])
        entry_low, entry_high = stock["entry_zone"]
        stop_loss = float(stock["stop_loss"])
        target_p = float(stock["target_price"])
        rr_ratio = float(stock["risk_reward_ratio"])
        pos_pct = float(stock.get("suggested_position_pct", 10.0))

        price_tier = stock.get("price_tier", "HIGH_200_PLUS" if close_p >= 200 else ("MID_50_200" if close_p >= 50 else "LOW_UNDER_50"))
        price_tier_label = stock.get(
            "price_tier_label",
            "💎 高價股 (200元以上)" if close_p >= 200 else ("⚖️ 中低價股 (50~200元)" if close_p >= 50 else "🪙 低價銅板股 (50元以下)"),
        )
        lot_cost_wan = round(close_p * 0.1, 2)

        short_term_score = float(stock.get("short_term_score", stock["total_score"]))
        swing_score = float(stock.get("swing_score", stock["total_score"]))
        long_term_score = float(stock.get("long_term_score", stock["total_score"]))
        short_sell_score = float(stock.get("short_sell_score", round(100.0 - float(stock["total_score"]), 1)))
        best_horizon = stock.get("best_horizon", "SWING")
        best_horizon_label = stock.get("best_horizon_label", "🌊 波段法人認養 (2~8週)")

        tech = self.data_engine.compute_technical_indicators(candles or [], close_p)
        verdict = self._classify_action(stock)

        news_items: List[Dict[str, str]] = []
        if fetch_live_news:
            news_items = self.data_engine.fetch_yahoo_stock_news(code, name=name, limit=8)

        # === 三大週期專屬交易策略 (Short-Term / Swing / Long-Term) ===
        align = self.data_engine.align_to_twse_tick
        st_entry_low = align(max(close_p * 0.99, ma_short * 0.995), mode="floor")
        st_entry_high = align(close_p * 1.005, mode="ceil")
        if st_entry_low > st_entry_high:
            st_entry_low = align(close_p * 0.988, mode="floor")
        st_stop = align(max(close_p * 0.965, close_p - 1.25 * atr_val), mode="floor")
        st_target = align(close_p + 2.0 * atr_val, mode="ceil")

        lt_entry_low = align(min(close_p * 0.95, tech["ma60"] * 0.985 if tech["ma60"] > 0 else close_p * 0.95), mode="floor")
        lt_entry_high = align(min(close_p * 0.995, tech["ma20"] * 1.01 if tech["ma20"] > 0 else close_p), mode="ceil")
        if lt_entry_low > lt_entry_high:
            lt_entry_low = align(close_p * 0.95, mode="floor")
            lt_entry_high = align(close_p, mode="round")
        lt_stop = align(min(close_p * 0.88, tech["ma60"] * 0.94 if tech["ma60"] > 0 else close_p * 0.88), mode="floor")
        lt_target = align(close_p * 1.22, mode="ceil")

        horizon_plans = {
            "short_term": {
                "label": "⚡ 短線衝刺 (1~5日)",
                "score": short_term_score,
                "suitability": "🔥 極佳（爆量動能突破）" if short_term_score >= 75 else ("🟢 適合（短多守穩）" if short_term_score >= 62 else "⚪ 普通（動能偏溫）"),
                "entry_low": st_entry_low,
                "entry_high": st_entry_high,
                "stop_loss": st_stop,
                "target_price": st_target,
                "holding_period": "1 ～ 5 個交易日（快進快出）",
                "strategy_note": (
                    f"鎖定當日量比 {stock['vol_ratio']}x 與 KD({tech['k9']}/{tech['d9']}) {tech['kd_signal']}動能；"
                    f"於 {st_entry_low}~{st_entry_high} 元切入，跌破 5MA / {st_stop} 元立即停損，短線看 {st_target} 元。"
                ),
            },
            "swing": {
                "label": "🌊 波段操作 (2~8週)",
                "score": swing_score,
                "suitability": "🔥 極佳（法人連買認養）" if swing_score >= 75 else ("🟢 適合（趨勢偏多）" if swing_score >= 62 else "⚪ 觀望（等待籌碼轉正）"),
                "entry_low": entry_low,
                "entry_high": entry_high,
                "stop_loss": stop_loss,
                "target_price": target_p,
                "holding_period": "2 ～ 8 週（順勢抱波段）",
                "strategy_note": (
                    f"依據三大法人近 3 日流向 ({inst_3d_yi:+.2f} 億) 與 20MA ({tech['ma20']} 元) 趨勢；"
                    f"於 {entry_low}~{entry_high} 元分兩批布局，收盤跌破 {stop_loss} 元停損，波段目標 {target_p} 元。"
                ),
            },
            "long_term": {
                "label": "🌳 長線存股／價值 (1季以上)",
                "score": long_term_score,
                "suitability": "🔥 極佳（核心護城河／高息穩健）" if long_term_score >= 74 else ("🟢 適合（逢低分批配置）" if long_term_score >= 60 else "🟡 波動較大（宜做波段）"),
                "entry_low": lt_entry_low,
                "entry_high": lt_entry_high,
                "stop_loss": lt_stop,
                "target_price": lt_target,
                "holding_period": "1 季 ～ 1 年以上（分批長線累積）",
                "strategy_note": (
                    f"參考 60 日季線 ({tech['ma60']} 元) 安全邊際，當沖比 {dt_pct:.1f}%；"
                    f"建議於 {lt_entry_low}~{lt_entry_high} 元價值區間逢跌分批買進，長線目標看 {lt_target} 元。"
                ),
            },
        }

        # === 🐻 做空／避險放空專屬策略 (Short-Selling Strategy Card) ===
        short_entry_low, short_entry_high = stock.get(
            "short_entry_zone",
            [round(close_p * 0.998, 2), round(max(close_p * 1.018, ma_short * 1.005), 2)],
        )
        short_stop_loss = float(stock.get("short_stop_loss", round(max(close_p + 1.8 * atr_val, ma_mid * 1.015), 2)))
        short_target_p = float(stock.get("short_target_price", round(max(1.0, close_p - 2.8 * atr_val), 2)))
        short_rr = float(stock.get("short_rr_ratio", round((close_p - short_target_p) / max(0.01, short_stop_loss - close_p), 2)))

        if inst_lots > 300 and close_p > ma_mid and ret_pct > 2.0:
            squeeze_risk = "🔴 高軋空風險（法人大買且站上均線，切勿逆勢硬空）"
        elif dt_pct > 42.0 or ret_pct > 1.5:
            squeeze_risk = "🟡 中度軋空／震盪風險（當沖熱絡，務必等反彈壓力區再空並嚴守回補價）"
        else:
            squeeze_risk = "🟢 低軋空風險（法人賣超且受制均線反壓，空方結構明確）"

        if short_sell_score >= 68.0:
            short_badge = "🟣 強烈放空／避險標的（法人連賣破線）"
        elif short_sell_score >= 56.0:
            short_badge = "🟠 偏空操作／逢反彈布空（籌碼轉弱）"
        else:
            short_badge = "⚪ 多方佔優・不建議放空（僅供避險參考）"

        short_reasons: List[str] = []
        if inst_lots < 0:
            short_reasons.append(f"【法人棄養倒貨】三大法人今日賣超 {inst_lots:+.0f} 張（外資 {f_lots:+.0f}、投信 {t_lots:+.0f}），近 3 日合計流向 {inst_3d_yi:+.2f} 億元。")
        if close_p < ma_mid:
            short_reasons.append(f"【均線蓋頭反壓】收盤 {close_p} 元跌破多日均線 ({ma_mid} 元，乖離 {ma_gap:+.2f}%)，上檔套牢賣壓沉重。")
        if margin_lots > 0 and inst_lots < 0:
            short_reasons.append(f"【散戶融資接刀】法人賣超同時融資卻增加 {margin_lots:+.0f} 張，籌碼凌亂易引發多殺多。")
        if not short_reasons:
            short_reasons.append(f"【短線乖離或壓力測試】若反彈無法帶量突破 20 日壓力位 {tech['resistance_20d']} 元，才考慮短空避險。")

        easy_short_advisor = (
            f"【🐻 做空／避險視角：{name}（{code}）】"
            f"{'目前外資或投信大戶正在明顯倒貨賣出，而且股價跌破均線支撐，屬於標準的弱勢空頭股！' if short_sell_score >= 60 else '目前這檔多方支撐還算穩，不建議隨便去放空它喔！'}"
            f"如果您想做空（融券或股票期貨避險），千萬別在急跌最低點追空，建議等盤中反彈到 {short_entry_low} ～ {short_entry_high} 元附近無力時再布空；"
            f"一旦股價帶量站回 {short_stop_loss} 元以上，代表主力可能軋空，請務必立刻回補停損！下跌回補獲利目標先看 {short_target_p} 元。"
        )

        short_sell_plan = {
            "score": short_sell_score,
            "badge": short_badge,
            "entry_low": short_entry_low,
            "entry_high": short_entry_high,
            "stop_loss": short_stop_loss,
            "target_price": short_target_p,
            "risk_reward_ratio": short_rr,
            "squeeze_risk": squeeze_risk,
            "reasons": short_reasons,
            "easy_short_advisor": easy_short_advisor,
        }

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
            f"融資減少 {abs(margin_lots):.0f} 張（散戶浮額沉澱乾淨，籌碼流向大戶）"
            if margin_lots < -30
            else f"融資增加 {margin_lots:+.0f} 張（留意散戶短線跟風）"
            if margin_lots > 100
            else f"融資變動 {margin_lots:+.0f} 張（散戶籌碼安定）"
        )

        # 2. 量化技術分析官 (Quant Technical Agent)
        trend_state = (
            f"收盤 {close_p} 元站穩 5MA({tech['ma5']}) 與 20MA({tech['ma20']})，KD({tech['k9']}/{tech['d9']}) 呈{tech['kd_signal']}、MACD 呈{tech['macd_signal']}、RSI(14) 為 {tech['rsi14']}。"
            if close_p >= ma_mid
            else f"收盤 {close_p} 元位於多日均線({ma_mid})下方（乖離 {ma_gap:+.2f}%），KD({tech['k9']}/{tech['d9']}) 呈{tech['kd_signal']}、RSI(14) 為 {tech['rsi14']}，近 20 日支撐在 {tech['support_20d']} 元。"
        )

        # 3. 多空辯論室 (Bullish vs. Bearish Debate)
        bull_points: List[str] = []
        bear_points: List[str] = []

        if inst_lots > 0:
            bull_points.append(f"【主力籌碼偏多】三大法人單日淨買超 {inst_lots:+.0f} 張、近 3 日加權買超 {inst_3d_yi:+.2f} 億元，機構資金明確站在買方。")
        if close_p >= ma_mid or tech["macd_hist"] > 0:
            bull_points.append(f"【技術趨勢支撐】股價守穩均線結構之上，MACD {tech['macd_signal']}、KD {tech['kd_signal']}，量能倍數 {stock['vol_ratio']}x。")
        if margin_lots <= 0:
            bull_points.append(f"【籌碼歸宿健康】融資變動 {margin_lots:+.0f} 張、當沖比 {dt_pct:.1f}%，散戶浮額未見失控。")
        if not bull_points:
            bull_points.append(f"【跌深乖離收斂】RSI(14) 來到 {tech['rsi14']}、接近布林下軌 {tech['bb_lower']} 元與 20 日支撐 {tech['support_20d']} 元，具短線技術反彈契機。")

        if ma_gap > 5.0 or ret_pct > 5.5 or tech["rsi14"] >= 75:
            bear_points.append(f"【短線追高風險】均線正乖離達 {ma_gap:+.2f}%、RSI(14) {tech['rsi14']}，直接追價易遇隔日沖獲利調節，宜等拉回 {entry_high} 元以下分批承接。")
        if dt_pct > 38.0:
            bear_points.append(f"【當沖籌碼干擾】當沖成交佔比達 {dt_pct:.1f}%，盤中短線客進出頻繁，尾盤易有波動。")
        if inst_lots < 0:
            bear_points.append(f"【法人調節壓力】外資（{f_lots:+.0f} 張）與投信（{t_lots:+.0f} 張）尚未全面轉買，上檔壓力先看 {tech['resistance_20d']} 元。")
        if not bear_points:
            bear_points.append(f"【系統波動防護】若國際盤或台指期夜盤拉回，需嚴格以 {stop_loss} 元作為波段防守底線。")

        # 4. 六大投資大師與機構流派圓桌投票 (6 Master Personas)
        pe_val = stock.get("pe_ratio", 0.0)
        personas = [
            {
                "name": "外資權值趨勢派",
                "vote": "看多買進" if (f_lots > 0 and close_p >= ma_mid) else ("中性續抱" if f_3d >= 0 else "保守調節"),
                "reason": f"外資單日 {f_lots:+.0f} 張、3 日累計 {f_3d:+.0f} 張，近 3 日法人淨流向 {inst_3d_yi:+.2f} 億。",
            },
            {
                "name": "投信作帳成長派",
                "vote": "強烈看多" if t_lots > 30 else ("偏多觀察" if t_3d >= 0 else "暫不介入"),
                "reason": f"投信單日 {t_lots:+.0f} 張、3 日累計 {t_3d:+.0f} 張，鎖定季底作帳連續買超動能。",
            },
            {
                "name": "歐奈爾 CANSLIM 突破派",
                "vote": "強勢突破" if (close_p >= tech["ma20"] and stock["vol_ratio"] >= 1.15 and ret_pct > 0) else ("守穩均線" if close_p >= ma_mid else "等待帶量站回"),
                "reason": f"量能倍數 {stock['vol_ratio']}x，KD {tech['kd_signal']}，20 日區間高點壓力 {tech['resistance_20d']} 元。",
            },
            {
                "name": "巴菲特護城河價值派",
                "vote": "價值穩健" if (0 < pe_val <= 22 or stock["sector"] in {"金控與高息金融", "電信防禦核心", "市值型 ETF", "高股息 ETF"}) else "成長溢價評估",
                "reason": f"本益比 {pe_val if pe_val > 0 else '依產業成長定價'}，距離 60 日季線 ({tech['ma60']} 元) 檢視中長線安全邊際。",
            },
            {
                "name": "反市場散戶風控派",
                "vote": "籌碼乾淨" if (margin_lots <= 50 and dt_pct <= 36.0) else "散戶過熱警戒",
                "reason": f"融資增減 {margin_lots:+.0f} 張、當沖比 {dt_pct:.1f}%、布林通道位置 {tech['bb_pct']}%。",
            },
            {
                "name": "凱利部位與停損風控長",
                "vote": f"建議配置 {pos_pct}%",
                "reason": f"風報比 1 : {rr_ratio}；第 1 批於 {entry_high} 元內、第 2 批於 {entry_low} 元附近低接，跌破 {stop_loss} 元停損。",
            },
        ]

        # 5. 口語化白話投資解讀 (Easy Conversational Guide — 直覺好懂版)
        lot_tip = (
            f"（屬於200元以上高價股，買一整張約需 {lot_cost_wan} 萬元，資金較小時也很適合用『盤中零股』分批買）"
            if price_tier == "HIGH_200_PLUS"
            else f"（屬於50~200元中堅主流股，買一張約需 {lot_cost_wan} 萬元）"
            if price_tier == "MID_50_200"
            else f"（屬於50元以下銅板親民股，買一整張只要約 {lot_cost_wan} 萬元，入手門檻很輕鬆）"
        )
        easy_summary = (
            f"【{name}（{code}）】今天收在 {close_p} 元（漲跌 {ret_pct:+.2f}%）{lot_tip}。"
            f"{'外資跟投信大戶今天同時在買進，籌碼非常穩健！' if (f_lots > 0 and t_lots > 0) else ('法人大戶今天站在買方支撐股價。' if inst_lots > 0 else '要注意今天外資或投信大戶有在調節賣出。')}"
            f"這檔目前最推薦用「{best_horizon_label}」的方式操作：想買進的話，建議等股價在 {entry_low} ～ {entry_high} 元之間分批承接；"
            f"只要收盤沒跌破 {stop_loss} 元都可以安心持有，目標先看 {target_p} 元附近。"
        )

        return {
            "code": code,
            "name": name,
            "sector": stock["sector"],
            "market": stock["market"],
            "close": close_p,
            "change": stock["change"],
            "change_pct": ret_pct,
            "prev_close": round(close_p - float(stock["change"]), 2),
            "price_tier": price_tier,
            "price_tier_label": price_tier_label,
            "lot_cost_wan": lot_cost_wan,
            "best_horizon": best_horizon,
            "best_horizon_label": best_horizon_label,
            "total_score": stock["total_score"],
            "short_term_score": short_term_score,
            "swing_score": swing_score,
            "long_term_score": long_term_score,
            "short_sell_score": short_sell_score,
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
                "suggested_position_pct": pos_pct,
            },
            "horizon_plans": horizon_plans,
            "short_sell_plan": short_sell_plan,
            "technicals": tech,
            "agents": {
                "chip_agent": f"{chip_headline} 此外，{margin_note}。",
                "technical_agent": f"{trend_state} 建議低接區間 {entry_low}～{entry_high} 元，跌破 {stop_loss} 元停損，上檔目標價 {target_p} 元（風報比 1:{rr_ratio}）。",
                "bull_researcher": bull_points,
                "bear_researcher": bear_points,
                "personas": personas,
                "easy_advisor": easy_summary,
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
                "vol_ratio": stock.get("vol_ratio", 1.0),
                "ma_short": ma_short,
                "ma_mid": ma_mid,
                "ma_gap_pct": ma_gap,
                "pe_ratio": pe_val,
            },
        }
