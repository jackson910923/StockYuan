# <img src="docs/assets/memes/1.png" width="44" height="44" style="border-radius:10px;vertical-align:middle;" /> StockYuan — 台股全方位 AI 多智能體投研與交易策略 APP

> **💻 電腦／手機線上看盤與 APP 安裝首頁**：**[https://jackson910923.github.io/StockYuan/](https://jackson910923.github.io/StockYuan/)**  
> **🤖 Android 原生 `.apk` 安裝包直連下載**：**[點此直接下載 StockYuan.apk](https://jackson910923.github.io/StockYuan/StockYuan.apk)**

---

## 📱 手機掃描 QR Code 立即安裝 StockYuan APP

您可以直接用手機相機掃描下方任一 **QR Code**（或進入網頁右上角點擊 **「📱 手機 APP 掃碼下載」**）：

| 🌟 iPhone (iOS) & Android 雙平台通用秒裝版 (PWA APP) | 🤖 Android 手機專屬原生安裝包 (`StockYuan.apk`) |
| :---: | :---: |
| ![PWA App QR Code](https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=https%3A%2F%2Fjackson910923.github.io%2FStockYuan%2F%3Fv%3D46) | ![Android APK QR Code](https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=https%3A%2F%2Fjackson910923.github.io%2FStockYuan%2FStockYuan.apk%3Fv%3D46) |
| **iPhone**：Safari 掃碼 ➔ 點底部「分享 📤」➔「**加入主畫面**」<br>**Android**：Chrome 掃碼 ➔ 點擊「**📲 一鍵安裝 APP 到桌面**」 | **Android 專用**：掃碼直接下載由 GitHub Actions 雲端自動編譯打包的 `StockYuan.apk` 原生安裝檔 |

---

## 🌟 StockYuan 核心特色

**StockYuan** 深度融合 GitHub 開源界四大頂尖量化 AI 專案（**[TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)**、**[virattt/ai-hedge-fund](https://github.com/virattt/ai-hedge-fund)**、**[ZhuLinsen/daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis)**、**[carsonchou/tw-stock-radar](https://github.com/carsonchou/tw-stock-radar)**），專為**台灣股市（上市 TWSE / 上櫃 TPEx / 熱門台股 ETF）**打造：

1. **🏆 今日八大分類最推薦 Top 3 榮譽榜看板 (`#podiumSection`)**
   - 一眼掌握：**🔥 目前做多綜合最推薦 Top 3**、**⚡ 短線衝刺 (1~5日) Top 3**、**🌊 波段操作 (2~8週) Top 3**、**🌳 長線存股 (季/年) Top 3**、**💎 高價股 (≥200元) Top 3**、**⚖️ 中低價股 (50~200元) Top 3**、**🪙 低價銅板股 (<50元) Top 3**、**🐻 做空／避險放空專區 Top 3**。
   - 支援「⚡ 一鍵同步全榜 Top 3 最新盤中報價」。

2. **極致即時雙引擎：瀏覽器直連即時報價 + GitHub Actions 每日 5 次全自動更新**
   - **前端 1,800+ 檔全市場中文股名／代號即時聯想搜尋 (`fetchLiveStockInBrowser`)**：輸入任意代號或中文股名（如 `2330`、`台積電`、`世芯`、`0050`），自動跳出下拉選單並即時抓取最新報價與 60 日 K 線。
   - **後端全市場籌碼與主流資金熱力圖 (`backend/data_engine.py`)**：直接串接台灣證交所 (TWSE) 與櫃買中心 (TPEx) 官方公開 API，涵蓋**外資、投信、自營商 3 日加權買賣超**、**融資融券增減**、**當沖佔比**、**熱門產業資金流向熱力圖 (`Sector Money Flow Heatmap`)** 與 **Google News 台股即時新聞情緒**。

3. **TradingAgents 級多空交叉辯論 × 六大機構流派圓桌投票 (`backend/agent_committee.py`)**
   - 內建 **外資權值趨勢派、投信作帳成長派、歐奈爾 CANSLIM 突破派、巴菲特護城河價值派、反市場散戶風控派、凱利部位與停損風控長** 六大流派圓桌投票，以及 **🐂 看多研究員 vs. 🐻 看空風險與放空理由官** 正反交叉辯論。

4. **雙模式無縫切換：「專業量化終端」×「白話直覺模式」 (`docs/index.html`)**
   - **專業量化模式 (Pro View)**：TradingView Lightweight Charts 互動 K 線圖（自動標示低接買點／反彈空點線、鐵律停損／防軋空回補線、目標獲利線）、技術指標矩陣列 (`RSI / KD / MACD / 布林 %B / 支撐壓力`)。
   - **白話直覺模式 (Easy View)**：一鍵切換大字體、口語化直覺介面，清楚標示操作方向、進場區間與停損防守線。
   - **🧮 專屬持倉損益與停損／回補試算器**：支援做多持股與做空融券/期貨雙向試算，並自動記憶每檔標的的成交均價與張數。

5. **100% 免費、24 小時不間斷雲端供應 (`.github/workflows/daily_tw_stock_agent.yml`)**
   - 結合 **GitHub Actions**（每個交易日 08:30、11:30、14:15、16:40、21:15 自動執行 5 次）與 **GitHub Pages**，完全免租伺服器、免付費，手機 APP 與電腦網頁 24 小時自動同步最新數據。
