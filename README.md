# AlphaTW 3.0 — 台股領航 AI 投研指揮中心 (Commercial-Grade Multi-Agent Taiwan Stock Desk)

**AlphaTW 3.0** 是深度借鑑並融合 GitHub 開源界四大頂尖量化 AI 專案：
- **[TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)**（多智能體多空交叉辯論與風控決策框架）
- **[virattt/ai-hedge-fund](https://github.com/virattt/ai-hedge-fund)**（六大投資大師與機構流派圓桌投票）
- **[ZhuLinsen/daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis)**（GitHub Actions 零成本全天候自動排程與報告推播）
- **[carsonchou/tw-stock-radar](https://github.com/carsonchou/tw-stock-radar)**（台股三大法人、融資融券、當沖與族群資金流向雷達）

專為**台灣股市（上市 TWSE / 上櫃 TPEx / 熱門台股 ETF）**量身打造的旗艦級零成本 24/7 AI 投研與交易策略輔助系統。

---

## 🌟 五大商用旗艦級核心亮點

1. **極致即時雙引擎：瀏覽器直連即時報價 + GitHub Actions 每日 5 次全自動更新**
   - **前端零伺服器即時查詢 (`fetchLiveStockInBrowser`)**：即使部署在純靜態的 GitHub Pages，使用者在網頁輸入**任意 4~6 碼台股或 ETF 代號**（如 `2330`、`0050`、`00878`、`3231`）或點擊「⚡ 即時報價刷新」，瀏覽器會直接抓取最新盤中/收盤報價與 60 日 K 線並當場重算技術指標與買賣價位。
   - **後端全市場籌碼與主流資金熱力圖 (`backend/data_engine.py`)**：直接串接台灣證交所 (TWSE) 與櫃買中心 (TPEx) 官方公開 API，涵蓋**外資、投信、自營商 3 日加權買賣超**、**融資融券增減**、**當沖佔比**、**熱門產業資金流向熱力圖 (`Sector Money Flow Heatmap`)** 與 **Google News 台股即時新聞情緒**。

2. **完整專業量化技術指標矩陣 (`compute_technical_indicators`)**
   - 自動計算 60 日歷史 K 線之 **`MA5 / MA10 / MA20 / MA60`**、**`RSI(14)` 強弱指標**、**`KD(9,3,3)` 隨機指標（含黃金交叉／死亡交叉偵測）**、**`MACD(12,26,9)` 柱狀體動能**、**`Bollinger Bands(20,2)` 布林通道位置 (`%B`)**、**20 日區間支撐／壓力位** 與 **ATR 波動動態停損帶**。

3. **TradingAgents 級多空交叉辯論 × 六大機構流派圓桌投票 (`backend/agent_committee.py`)**
   - **6 大機構與大師流派圓桌投票**：
     1. **外資權值趨勢派**（追蹤外資連續買超與均線多頭排列）
     2. **投信作帳成長派**（捕捉投信季底認養、土洋同買與動能突破）
     3. **歐奈爾 CANSLIM 突破派**（檢視 RSI、MACD 與布林通道突破動能）
     4. **巴菲特護城河價值派**（檢視季線乖離率、安全邊際與布林位階）
     5. **反市場散戶風控派**（監控融資暴增、散戶退場與隔日沖當沖熱度）
     6. **凱利部位與停損風控長**（動態計算期望風報比 R/R 與建議單筆資金配置 `%`）
   - **🐂 看多研究員 vs. 🐻 看空風險挑戰官**：強制列舉正反雙方證據交叉辯論，杜絕盲目追高殺低。

4. **雙模式無縫切換：「專業量化終端」×「白話直覺模式」 (`docs/index.html`)**
   - **專業量化模式 (Pro View)**：TradingView Lightweight Charts 互動 K 線圖（自動標示低接買點綠線、鐵律停損紅線、波段目標金線）、技術指標矩陣列、六大流派投票明細。
   - **白話直覺模式 (Easy View)**：一鍵切換大字體、口語化直覺介面（🟢 適合逢低布局 / 🟡 續抱觀察不追高 / 🔴 走勢轉弱宜減碼），讓家人親友也能一眼看懂操作方向、買進區間與停損防守線。
   - **內建「🧮 專屬持股成本健檢與停損試算器」**：輸入自己的買進成本與張數，即時算出目前帳面損益、距離停損／目標價空間與具體操作建議。

5. **100% 免費、24 小時不間斷雲端供應 (`.github/workflows/daily_tw_stock_agent.yml`)**
   - 結合 **GitHub Actions**（每個交易日 08:30、11:30、14:15、16:40、21:15 自動執行 5 次，且隨時可一鍵手動觸發）與 **GitHub Pages**，完全免租伺服器、免付費，手機與電腦 24 小時隨時點開即用。

---

## 🚀 快速部署至 GitHub（零成本 24/7 全自動運行）

1. 將本專案 Push 到您的 GitHub Repository。
2. 進入 GitHub Repo 的 **Settings ➔ Pages**：
   - **Source** 選擇 `Deploy from a branch`。
   - **Branch** 選擇 `main`，資料夾選擇 **`/docs`**，按下 **Save**。
   - 約 1 分鐘後即可透過 `https://<您的GitHub帳號>.github.io/<專案名稱>/` 隨時隨地開啟使用（手機瀏覽器可「加入主畫面」當作原生 App 使用）。
3. （選填）如需開啟 **Gemini / OpenAI / DeepSeek 深度語意摘要** 或 **Telegram / Discord 自動推播**，可於 GitHub Repo 的 **Settings ➔ Secrets and variables ➔ Actions** 新增對應金鑰（未設定時系統亦內建完整量化規則決策引擎，100% 獨立運作）。
