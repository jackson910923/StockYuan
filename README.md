# <img src="docs/assets/memes/1.png" width="44" height="44" style="border-radius:10px;vertical-align:middle;" /> StockYuan — 台股 AI 多智能體投研 App

> **💻 電腦／手機線上使用**：**[https://jackson910923.github.io/StockYuan/](https://jackson910923.github.io/StockYuan/)**
> **🤖 Android APK**：**[StockYuan.apk](https://jackson910923.github.io/StockYuan/StockYuan.apk)**　**🍎 iPhone**：Safari 開啟 → 分享 → 加入主畫面

| iPhone / Android 通用（PWA） | Android APK |
| :---: | :---: |
| ![PWA App QR Code](https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=https%3A%2F%2Fjackson910923.github.io%2FStockYuan%2F) | ![Android APK QR Code](https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=https%3A%2F%2Fjackson910923.github.io%2FStockYuan%2FStockYuan.apk) |

---

## 功能

| 分頁 | 內容 |
| --- | --- |
| **市場** | 加權／櫃買即時指數與分時走勢、AI 市場格局與漲跌家數、**AI 昨日精選今日實績**（前一日各分類 Top 3 的隔日真實報酬）、八大分類 Top 3（綜合／短線／波段／長線／高價／中價／銅板／做空）、產業資金熱力圖、即時焦點新聞 |
| **自選** | 盤中即時報價（鉅亨網）、AI 燈號與分數、近 30 日迷你走勢、持倉損益、拖曳排序、漲幅/AI 分數排序、**跨裝置同步連結** |
| **選股** | AI 會診股依各週期分數排行、土洋同買、成交熱門、**全市場 1,975 檔排行**（漲幅／跌幅／外資・投信買賣超），可與高／中／銅板價位交叉篩選 |
| **新聞** | 鉅亨網即時新聞（焦點／台股／法人／科技／國際／營收速報）每 2 分鐘自動更新、新消息提示、新聞自動標註相關個股；另有 AI 報告媒體精選 |
| **個股** | 即時報價與今日區間、**分時／日 K／週 K**（MA5/20/60＋AI 買區、停損、目標線）、AI 六大 Agent 評分、短線／波段／長線／做空四種劇本、**昨日策略今日驗證**、三大法人籌碼、即時技術指標、多空辯論、六大流派投票、持倉試算、個股新聞 |
| **更多** | 深色／淺色主題、紅漲綠跌／綠漲紅跌、**白話直覺模式**（大字、精簡專業指標）、盤中自動更新頻率、LINE 投研日報一鍵複製、安裝 App |

快捷鍵（電腦）：`Ctrl/⌘ + K` 或 `/` 開啟搜尋。

## 架構

```
GitHub Actions（交易日 5 次）──> run_daily_pipeline.py ──> docs/data/latest_report.json（AI 報告）
                                    │                      data/strategy_history.json（逐日策略存檔）
                                    └─ backend/            （證交所／櫃買／三大法人／融資券／新聞 → 六大 Agent 會診）

瀏覽器 / PWA / APK ──> docs/index.html + docs/assets/js/*.js（ES Modules，無建置步驟）
                        ├─ 即時報價、分時、日 K、新聞：鉅亨網 API（原生 CORS，直接在瀏覽器抓）
                        ├─ 日 K 備援：FinMind
                        └─ docs/sw.js：只快取 App 殼層與一份 AI 報告（不快取第三方 API）
```

| 檔案 | 說明 |
| --- | --- |
| `docs/assets/js/store.js` | 自選股／設定／持倉永久保存：localStorage + IndexedDB + Cookie 三重備份，自動修復、相容舊版 `alphatw_*` 資料 |
| `docs/assets/js/api.js` | AI 報告載入與更新偵測、即時報價輪詢（依台股交易時段）、分時／日 K、即時新聞 |
| `docs/assets/js/views.js` / `stock.js` | 各分頁與個股頁 |
| `docs/assets/js/charts.js` | Lightweight Charts（已內建於 `docs/vendor/`）與前端技術指標 |
| `docs/assets/app.css` | 設計系統（深淺主題、漲跌配色、手機／平板／桌機版面） |

## 本機開發

```bash
python -m http.server 8765 --directory docs   # 開啟 http://localhost:8765
python run_daily_pipeline.py                  # 重新產生 AI 報告（會覆寫 data/ 與 docs/data/）
```

## 免責聲明

本專案內容由程式依公開資料自動產生，僅供研究參考，不構成任何投資建議。投資有風險，請自行審慎評估並嚴設停損。
