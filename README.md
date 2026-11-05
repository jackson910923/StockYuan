# AlphaTW 台股領航 AI 投研指揮中心 (Multi-Agent Taiwan Stock Trading Desk)

**AlphaTW** 是融合開源界最頂尖的 **[TradingAgents](https://github.com/TauricResearch/TradingAgents)**（多智能體多空辯論框架）、**[ai-hedge-fund](https://github.com/virattt/ai-hedge-fund)**（投資大師圓桌投票）與 **[daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis)**（GitHub Actions 零成本每日自動推播）理念，並深度針對**台灣股市（上市 TWSE / 上櫃 TPEx）獨特籌碼結構**量身打造的旗艦級個人與家庭 AI 投研系統。

---

## 🌟 四大核心亮點

1. **台股原生全方位籌碼與熱門題材雷達 (`backend/data_engine.py`)**
   - 直接串接**台灣證交所 (TWSE)** 與**櫃買中心 (TPEx)** 官方公開數據：
     - 每日全市場收盤價量與跨月多日滾動均線（`MA5 / MA10 / MA20`、乖離率、ATR 波動停損帶）。
     - **三大法人獨立拆解**：外資、投信、自營商單日與近 3 日加權買賣超，自動抓出「**土洋同買（外資+投信同步搶進）**」與「**投信作帳認養股**」。
     - **散戶籌碼與隔日沖警戒**：融資融券增減張數（捕捉「融資退場、法人吸籌」黃金背離）与當沖成交佔比。
     - **即時財經新聞與題材聚合**：自動抓取 Google News 台股財經頭條與個股即時新聞。

2. **TradingAgents 級 6-Agent 多空辯論與大師圓桌 (`backend/agent_committee.py`)**
   - 🕵️‍♂️ **籌碼追蹤官 (Smart Money Chip Agent)**：剖析外資、投信、融資與當沖籌碼結構。
   - 📈 **量化技術官 (Quant Technical Agent)**：計算精準「**建議低接買點區間**」、「**鐵律停損價**」、「**波段目標價**」與期望風報比。
   - 🐂 **看多研究員 (Bullish Case)** vs. 🐻 **看空風險挑戰官 (Bearish Counter-Evidence)**：正反雙方強制交叉辯論，徹底杜絕單一 AI 無腦看多或追高殺低。
   - 🏛️ **三大台股機構流派圓桌投票 (Master Personas)**：外資權值趨勢派、投信作帳成長派、安全邊際防追高派。

3. **雙代同堂 UI：「專業投研終端」×「老爸專屬大字白話模式」 (`docs/index.html`)**
   - **您自己看（專業模式）**：深色 Bloomberg / TradingView 風格看盤介面，內建 **TradingView Lightweight Charts 互動 K 線圖**（自動畫出買點上限綠線、鐵律停損紅線、波段目標金線）。
   - **給爸爸看（老爸大字白話模式）**：一鍵切換超大字體、零專業術語的**紅綠燈建議卡（🟢 可逢低買 / 🟡 續抱不追高 / 🔴 法人在賣宜減碼）**，並支援**「📲 一鍵複製老爸 LINE 日報」**！

4. **GitHub Actions + GitHub Pages 零伺服器成本全自動運行 (`.github/workflows/daily_tw_stock_agent.yml`)**
   - 推上 GitHub 後，每個交易日收盤後（16:35）自動抓取最新盤後籌碼、更新互動網頁數據並推播至 Telegram / Discord。
   - 開啟 GitHub Pages（指向 `docs/` 資料夾）後，您與爸爸在手機把網址加入主畫面，就像原生 App 一樣每天點開即看！

---

## 🚀 快速啟動指南

### 方式 A：本地立即執行與更新今日盤後數據
```bash
# 1. 執行每日盤後全市場掃描與 AI 多空辯論報告生成
python run_daily_pipeline.py

# 2. 啟動本地互動網頁伺服器 (或直接點開 docs/index.html)
python -m http.server 8080 --directory docs
# 瀏覽器打開 http://localhost:8080
```

### 方式 B：放到您的 GitHub 全自動跑（免開電腦、手機直接看）
1. 將本專案 Push 到您的 GitHub Repository。
2. 進入 GitHub Repo 的 **Settings ➔ Pages**：
   - **Branch** 選擇 `main`（或 `master`），資料夾選擇 **`/docs`**，按下 **Save**。
   - 1 分鐘後就會獲得專屬網址（例如 `https://<您的帳號>.github.io/<專案名>/`），把這個網址傳給爸爸加到手機桌面即可！
3. （選填）若要開啟每日自動 Telegram / Discord 推播，到 **Settings ➔ Secrets and variables ➔ Actions** 新增：
   - `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_CHAT_ID`（或 `DISCORD_WEBHOOK_URL`）。
