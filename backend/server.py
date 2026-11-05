from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.agent_committee import MultiAgentStockCommittee
from backend.data_engine import TaiwanStockDataEngine
from run_daily_pipeline import generate_daily_intelligence_bundle, load_watchlist

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT_DIR / "docs"
DATA_DIR = ROOT_DIR / "data"

app = FastAPI(
    title="AlphaTW 台股領航 AI 多智能體投研指揮中心",
    version="2.0.0",
    description="融合 TradingAgents 多空辯論與台股三大法人/融資/當沖/熱門新聞雷達之旗艦級台股 AI Agent 系統",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = TaiwanStockDataEngine(cache_dir=DATA_DIR)
committee = MultiAgentStockCommittee(engine)


class WatchlistUpdate(BaseModel):
    watchlist: List[str]


@app.get("/api/report")
def get_latest_report(refresh: bool = False) -> JSONResponse:
    report_path = DOCS_DIR / "data" / "latest_report.json"
    if refresh or not report_path.exists():
        bundle = generate_daily_intelligence_bundle()
        return JSONResponse(content=bundle)
    data = json.loads(report_path.read_text(encoding="utf-8"))
    return JSONResponse(content=data)


@app.get("/api/analyze/{code}")
def analyze_single_stock(code: str) -> JSONResponse:
    code = code.strip()
    report_path = DOCS_DIR / "data" / "latest_report.json"
    if report_path.exists():
        bundle = json.loads(report_path.read_text(encoding="utf-8"))
        if code in bundle.get("all_debates", {}):
            debate = bundle["all_debates"][code]
            if not debate.get("news"):
                debate["news"] = engine.fetch_google_news_for_query(f"{code} {debate['name']}", limit=4)
            kline = bundle.get("klines", {}).get(code) or engine.fetch_stock_kline_history(
                code, market=debate.get("market", "TWSE"), days=45
            )
            return JSONResponse(content={"debate": debate, "kline": kline})

    # 若不在快取內，即時從全市場掃描該股
    snapshot = engine.build_full_market_intelligence(watchlist=[code])
    stock = snapshot["stocks"].get(code)
    if not stock:
        raise HTTPException(status_code=404, detail=f"找不到台股代號 {code} 之最新收盤資料")
    debate = committee.run_committee_debate(stock, fetch_live_news=True)
    kline = engine.fetch_stock_kline_history(code, market=stock["market"], days=45)
    return JSONResponse(content={"debate": debate, "kline": kline})


@app.post("/api/watchlist")
def update_watchlist(payload: WatchlistUpdate) -> JSONResponse:
    cleaned = [str(c).strip() for c in payload.watchlist if str(c).strip().isdigit() and len(str(c).strip()) == 4]
    if not cleaned:
        raise HTTPException(status_code=400, detail="請提供有效的 4 碼台股代號")
    watchlist_path = DATA_DIR / "watchlist.json"
    watchlist_path.write_text(json.dumps({"watchlist": cleaned}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    bundle = generate_daily_intelligence_bundle(custom_watchlist=cleaned)
    return JSONResponse(content=bundle)


@app.get("/")
def serve_index() -> FileResponse:
    return FileResponse(DOCS_DIR / "index.html")


app.mount("/data", StaticFiles(directory=str(DOCS_DIR / "data")), name="data")
