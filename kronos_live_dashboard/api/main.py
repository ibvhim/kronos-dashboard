import sys
import os
import uvicorn
import yfinance as yf
import pandas as pd
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone
import numpy as np
import logging
import json
import time

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_obj = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "message": record.getMessage(),
        }
        if hasattr(record, "structured_data"):
            log_obj.update(record.structured_data)
        if record.exc_info:
            log_obj["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(log_obj)

logger = logging.getLogger("kronos_api")
logger.setLevel(logging.INFO)
ch = logging.StreamHandler()
ch.setFormatter(JSONFormatter())
if not logger.handlers:
    logger.addHandler(ch)

try:
    from api.baselines import generate_baselines
except ImportError:
    try:
        from baselines import generate_baselines
    except ImportError as e:
        print("Baselines import failed:", e)

try:
    from api.regime import detect_regime
except ImportError:
    try:
        from regime import detect_regime
    except ImportError as e:
        print("Regime import failed:", e)

# Import Replay and Backtest logic
try:
    from api.replay import run_replay_forecast, ReplayRequest
    from api.backtest import run_mini_backtest, BacktestRequest
except ImportError:
    try:
        from replay import run_replay_forecast, ReplayRequest
        from backtest import run_mini_backtest, BacktestRequest
    except ImportError as e:
        print("Replay/backtest import failed:", e)

# Append the Kronos directory to sys.path so we can import models without modifying the original source
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'Kronos')))

try:
    from model import Kronos, KronosTokenizer, KronosPredictor
    MODEL_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Kronos model cannot be imported: {e}")
    MODEL_AVAILABLE = False

app = FastAPI(title="Kronos Live Dashboard API")

# Cross-Origin support
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global store for lazy-loaded models & tokenizer
# Format: {"tokenizer": ..., "models": {"kronos-small": KronosPredictor(...), ...}}
GLOBAL_STATE = {
    "tokenizers": {},
    "predictors": {},
    "metrics_store": {},
    "forecast_store": {}
}

AVAILABLE_MODELS = {
    'kronos-mini': {
        'model_id': 'NeoQuasar/Kronos-mini',
        'context_length': 2048,
    },
    'kronos-small': {
        'model_id': 'NeoQuasar/Kronos-small',
        'context_length': 512,
    },
    'kronos-base': {
        'model_id': 'NeoQuasar/Kronos-base',
        'context_length': 512,
    }
}

class LoadModelRequest(BaseModel):
    model_name: str
    device: str = "cpu"

class PredictRequest(BaseModel):
    model_name: str
    tickers: List[str]
    lookback: int = 400
    pred_len: int = 120
    temperature: float = 1.0
    top_p: float = 0.9
    sample_count: int = 1
    aggregation_method: str = "mean"
    return_paths: bool = False
    return_quantiles: bool = True
    quantiles: List[float] = [0.1, 0.25, 0.5, 0.75, 0.9]
    run_label: Optional[str] = None
    store_forecast: bool = False
    return_baselines: bool = False

@app.get("/api/models")
async def get_models():
    """Return available models and whether Kronos is imported successfully."""
    return {
        "model_available": MODEL_AVAILABLE,
        "models": list(AVAILABLE_MODELS.keys())
    }

@app.get("/api/tickers")
async def get_tickers():
    """Return curated lists of popular stocks and crypto tickers available via yfinance."""
    return {
        "stocks": {
            "Tech": [
                {"symbol": "AAPL", "name": "Apple"},
                {"symbol": "MSFT", "name": "Microsoft"},
                {"symbol": "GOOGL", "name": "Alphabet (Google)"},
                {"symbol": "AMZN", "name": "Amazon"},
                {"symbol": "META", "name": "Meta Platforms"},
                {"symbol": "NVDA", "name": "NVIDIA"},
                {"symbol": "TSLA", "name": "Tesla"},
                {"symbol": "AMD", "name": "AMD"},
                {"symbol": "INTC", "name": "Intel"},
                {"symbol": "CRM", "name": "Salesforce"},
                {"symbol": "ORCL", "name": "Oracle"},
                {"symbol": "ADBE", "name": "Adobe"},
                {"symbol": "CSCO", "name": "Cisco"},
                {"symbol": "NFLX", "name": "Netflix"},
                {"symbol": "AVGO", "name": "Broadcom"},
                {"symbol": "QCOM", "name": "Qualcomm"},
                {"symbol": "IBM", "name": "IBM"},
                {"symbol": "NOW", "name": "ServiceNow"},
                {"symbol": "UBER", "name": "Uber"},
                {"symbol": "SHOP", "name": "Shopify"},
                {"symbol": "SQ", "name": "Block (Square)"},
                {"symbol": "PLTR", "name": "Palantir"},
                {"symbol": "SNAP", "name": "Snap"},
                {"symbol": "PINS", "name": "Pinterest"},
                {"symbol": "SPOT", "name": "Spotify"},
            ],
            "Finance": [
                {"symbol": "JPM", "name": "JPMorgan Chase"},
                {"symbol": "BAC", "name": "Bank of America"},
                {"symbol": "WFC", "name": "Wells Fargo"},
                {"symbol": "GS", "name": "Goldman Sachs"},
                {"symbol": "MS", "name": "Morgan Stanley"},
                {"symbol": "V", "name": "Visa"},
                {"symbol": "MA", "name": "Mastercard"},
                {"symbol": "PYPL", "name": "PayPal"},
                {"symbol": "AXP", "name": "American Express"},
                {"symbol": "C", "name": "Citigroup"},
                {"symbol": "BLK", "name": "BlackRock"},
                {"symbol": "SCHW", "name": "Charles Schwab"},
                {"symbol": "COF", "name": "Capital One"},
            ],
            "Healthcare": [
                {"symbol": "JNJ", "name": "Johnson & Johnson"},
                {"symbol": "UNH", "name": "UnitedHealth"},
                {"symbol": "PFE", "name": "Pfizer"},
                {"symbol": "ABBV", "name": "AbbVie"},
                {"symbol": "MRK", "name": "Merck"},
                {"symbol": "LLY", "name": "Eli Lilly"},
                {"symbol": "TMO", "name": "Thermo Fisher"},
                {"symbol": "ABT", "name": "Abbott"},
                {"symbol": "BMY", "name": "Bristol-Myers Squibb"},
                {"symbol": "AMGN", "name": "Amgen"},
                {"symbol": "GILD", "name": "Gilead Sciences"},
                {"symbol": "MRNA", "name": "Moderna"},
            ],
            "Consumer": [
                {"symbol": "WMT", "name": "Walmart"},
                {"symbol": "COST", "name": "Costco"},
                {"symbol": "HD", "name": "Home Depot"},
                {"symbol": "MCD", "name": "McDonald's"},
                {"symbol": "KO", "name": "Coca-Cola"},
                {"symbol": "PEP", "name": "PepsiCo"},
                {"symbol": "PG", "name": "Procter & Gamble"},
                {"symbol": "NKE", "name": "Nike"},
                {"symbol": "SBUX", "name": "Starbucks"},
                {"symbol": "DIS", "name": "Disney"},
                {"symbol": "TGT", "name": "Target"},
                {"symbol": "LOW", "name": "Lowe's"},
            ],
            "Energy & Industrial": [
                {"symbol": "XOM", "name": "Exxon Mobil"},
                {"symbol": "CVX", "name": "Chevron"},
                {"symbol": "BA", "name": "Boeing"},
                {"symbol": "CAT", "name": "Caterpillar"},
                {"symbol": "GE", "name": "GE Aerospace"},
                {"symbol": "LMT", "name": "Lockheed Martin"},
                {"symbol": "UPS", "name": "UPS"},
                {"symbol": "RTX", "name": "RTX (Raytheon)"},
                {"symbol": "DE", "name": "Deere & Co"},
                {"symbol": "NEE", "name": "NextEra Energy"},
            ],
            "ETFs & Indices": [
                {"symbol": "SPY", "name": "S&P 500 ETF"},
                {"symbol": "QQQ", "name": "Nasdaq 100 ETF"},
                {"symbol": "DIA", "name": "Dow Jones ETF"},
                {"symbol": "IWM", "name": "Russell 2000 ETF"},
                {"symbol": "VTI", "name": "Total Stock Market ETF"},
                {"symbol": "VOO", "name": "Vanguard S&P 500"},
                {"symbol": "ARKK", "name": "ARK Innovation ETF"},
                {"symbol": "GLD", "name": "Gold ETF"},
                {"symbol": "SLV", "name": "Silver ETF"},
                {"symbol": "USO", "name": "US Oil ETF"},
            ],
        },
        "crypto": [
            {"symbol": "BTC-USD", "name": "Bitcoin"},
            {"symbol": "ETH-USD", "name": "Ethereum"},
            {"symbol": "BNB-USD", "name": "Binance Coin"},
            {"symbol": "SOL-USD", "name": "Solana"},
            {"symbol": "XRP-USD", "name": "Ripple"},
            {"symbol": "ADA-USD", "name": "Cardano"},
            {"symbol": "DOGE-USD", "name": "Dogecoin"},
            {"symbol": "AVAX-USD", "name": "Avalanche"},
            {"symbol": "DOT-USD", "name": "Polkadot"},
            {"symbol": "MATIC-USD", "name": "Polygon"},
            {"symbol": "LINK-USD", "name": "Chainlink"},
            {"symbol": "UNI-USD", "name": "Uniswap"},
            {"symbol": "SHIB-USD", "name": "Shiba Inu"},
            {"symbol": "LTC-USD", "name": "Litecoin"},
            {"symbol": "ATOM-USD", "name": "Cosmos"},
            {"symbol": "XLM-USD", "name": "Stellar"},
            {"symbol": "NEAR-USD", "name": "NEAR Protocol"},
            {"symbol": "APT-USD", "name": "Aptos"},
            {"symbol": "ARB-USD", "name": "Arbitrum"},
            {"symbol": "OP-USD", "name": "Optimism"},
            {"symbol": "FIL-USD", "name": "Filecoin"},
            {"symbol": "AAVE-USD", "name": "Aave"},
            {"symbol": "MKR-USD", "name": "Maker"},
            {"symbol": "ALGO-USD", "name": "Algorand"},
            {"symbol": "FTM-USD", "name": "Fantom"},
            {"symbol": "SAND-USD", "name": "The Sandbox"},
            {"symbol": "MANA-USD", "name": "Decentraland"},
            {"symbol": "AXS-USD", "name": "Axie Infinity"},
            {"symbol": "HBAR-USD", "name": "Hedera"},
            {"symbol": "VET-USD", "name": "VeChain"},
        ]
    }

@app.post("/api/load_model")
async def load_model(req: LoadModelRequest):
    t_start = time.time()
    if not MODEL_AVAILABLE:
        raise HTTPException(status_code=500, detail="Kronos library not available.")
        
    if req.model_name not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail="Invalid model name.")
        
    tokenizer_id = "NeoQuasar/Kronos-Tokenizer-2k" if req.model_name == 'kronos-mini' else "NeoQuasar/Kronos-Tokenizer-base"
        
    if tokenizer_id not in GLOBAL_STATE["tokenizers"]:
        GLOBAL_STATE["tokenizers"][tokenizer_id] = KronosTokenizer.from_pretrained(tokenizer_id)
        
    tokenizer = GLOBAL_STATE["tokenizers"][tokenizer_id]
        
    if req.model_name not in GLOBAL_STATE["predictors"]:
        model_config = AVAILABLE_MODELS[req.model_name]
        try:
            model = Kronos.from_pretrained(model_config['model_id'])
            predictor = KronosPredictor(
                model, 
                tokenizer, 
                device=req.device, 
                max_context=model_config['context_length']
            )
            GLOBAL_STATE["predictors"][req.model_name] = predictor
            load_time = time.time() - t_start
            logger.info("Model loaded", extra={"structured_data": {"event": "model_load", "model": req.model_name, "latency_sec": load_time, "cache": "miss"}})
        except Exception as e:
            logger.error("Failed to load model", exc_info=True, extra={"structured_data": {"event": "model_load_error", "model": req.model_name}})
            raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")
    else:
        logger.info("Model already in cache", extra={"structured_data": {"event": "model_load", "model": req.model_name, "cache": "hit"}})
            
    return {"status": "success", "message": f"{req.model_name} loaded."}

def fetch_live_data(ticker: str, lookback: int):
    """Fetch recent 1m data for a single ticker via yfinance."""
    print(f"Fetching data for {ticker}...")
    # Fetch lookback + 10 to ensure we have enough points, yfinance 1m data is limit to 7 days
    # We will grab 5 days of 1m data
    df = yf.download(ticker, period="5d", interval="1m", progress=False)
    if df.empty:
        raise ValueError(f"No data found for ticker {ticker}")
    
    # Flatten MultiIndex columns if yfinance returns them
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0].lower() for col in df.columns]
    else:
        df.columns = [col.lower() for col in df.columns]
        
    df = df.reset_index()
    # rename 'Datetime' to 'timestamps'
    if 'Datetime' in df.columns:
        df = df.rename(columns={'Datetime': 'timestamps'})
    elif 'Date' in df.columns:
        df = df.rename(columns={'Date': 'timestamps'})
        
    df = df.dropna()
    req_cols = ['timestamps', 'open', 'high', 'low', 'close', 'volume']
    if not all(col in df.columns for col in req_cols):
        raise ValueError(f"Missing columns in {ticker} data. Got: {list(df.columns)}")
        
    # Take the last `lookback` rows
    df = df.tail(lookback).reset_index(drop=True)
    return df

@app.post("/api/predict")
async def run_predict(req: PredictRequest):
    if not MODEL_AVAILABLE:
        raise HTTPException(status_code=500, detail="Kronos library not available.")
        
    if req.model_name not in GLOBAL_STATE["predictors"]:
        raise HTTPException(status_code=400, detail="Model not loaded. Call /load_model first.")
        
    predictor = GLOBAL_STATE["predictors"][req.model_name]
    
    results = {}
    
    # We run prediction sequentially (to avoid OOM on single GPU/CPU)
    for ticker in req.tickers:
        t_start = time.time()
        try:
            # 1. Fetch live data
            try:
                df = fetch_live_data(ticker, req.lookback)
            except Exception as e:
                logger.error("Ticker fetch failure", extra={"structured_data": {"event": "ticker_fetch_failure", "ticker": ticker, "error": str(e)}})
                raise e
            if len(df) < req.lookback:
                # If less than requested, use what we have, but Kronos might fail if it's too short.
                pass
                
            # Prepare inputs
            df['timestamps'] = pd.to_datetime(df['timestamps'])
            if df['timestamps'].dt.tz is not None:
                df['timestamps'] = df['timestamps'].dt.tz_localize(None)
                
            x_df = df[['open', 'high', 'low', 'close', 'volume']].copy()
            for col in ['open', 'high', 'low', 'close', 'volume']:
                x_df[col] = pd.to_numeric(x_df[col], errors='coerce').astype(float)
            x_df = x_df.reset_index(drop=True)
            
            x_timestamp = df['timestamps'].reset_index(drop=True)
            
            # Fake y_timestamp for the future (since we are predicting the future)
            time_diff = x_timestamp.iloc[-1] - x_timestamp.iloc[-2] if len(x_timestamp) > 1 else pd.Timedelta(minutes=1)
            future_timestamps = pd.date_range(
                start=x_timestamp.iloc[-1] + time_diff,
                periods=req.pred_len,
                freq=time_diff
            )
            y_timestamp = pd.Series(future_timestamps, name='timestamps').reset_index(drop=True)
            
            # 2. Inference
            print(f"Running inference for {ticker}...")
            
            all_preds = []
            for i in range(req.sample_count):
                pred_df = predictor.predict(
                    df=x_df,
                    x_timestamp=x_timestamp,
                    y_timestamp=y_timestamp,
                    pred_len=req.pred_len,
                    T=req.temperature,
                    top_p=req.top_p,
                    sample_count=1,
                    verbose=False
                )
                all_preds.append(pred_df)
            
            # 3. Format output
            historical_data = df.to_dict('records')
            
            cols = ['open', 'high', 'low', 'close']
            tensor_3d = np.stack([p[cols].values for p in all_preds], axis=0) # (sample_count, pred_len, num_cols)
            
            mean_vals = np.mean(tensor_3d, axis=0)
            median_vals = np.median(tensor_3d, axis=0)
            std_vals = np.std(tensor_3d, axis=0)
            min_vals = np.min(tensor_3d, axis=0)
            max_vals = np.max(tensor_3d, axis=0)

            if req.aggregation_method == 'mean':
                agg_vals = mean_vals
            elif req.aggregation_method == 'median':
                agg_vals = median_vals
            elif req.aggregation_method == 'trimmed_mean':
                lower = np.percentile(tensor_3d, 10, axis=0, keepdims=True)
                upper = np.percentile(tensor_3d, 90, axis=0, keepdims=True)
                mask = (tensor_3d >= lower) & (tensor_3d <= upper)
                trimmed_sum = np.sum(tensor_3d * mask, axis=0)
                trimmed_count = np.sum(mask, axis=0)
                agg_vals = trimmed_sum / np.maximum(trimmed_count, 1)
            else:
                agg_vals = mean_vals

            q_vals = {}
            if req.return_quantiles:
                for q in req.quantiles:
                    q_vals[q] = np.quantile(tensor_3d, q, axis=0)
            
            pred_records = []
            for j in range(req.pred_len):
                rec = {
                    "timestamps": future_timestamps[j].isoformat(),
                }
                for c_idx, c in enumerate(cols):
                    rec[f"mean_{c}"] = float(mean_vals[j, c_idx])
                    rec[f"median_{c}"] = float(median_vals[j, c_idx])
                    rec[f"trimmed_mean_{c}"] = float(agg_vals[j, c_idx])
                    rec[f"std_{c}"] = float(std_vals[j, c_idx])
                    rec[f"min_{c}"] = float(min_vals[j, c_idx])
                    rec[f"max_{c}"] = float(max_vals[j, c_idx])
                    
                    if req.return_quantiles:
                        for q in req.quantiles:
                            q_str = f"q{int(q*100)}_{c}"
                            rec[q_str] = float(q_vals[q][j, c_idx])
                    
                    rec[c] = float(agg_vals[j, c_idx])
                    
                rec["volume"] = float(all_preds[0]['volume'].iloc[j]) if 'volume' in all_preds[0].columns else 0.0
                pred_records.append(rec)
                
            current_regime = None
            try:
                if 'detect_regime' in globals():
                    current_regime = detect_regime(df, ticker)
            except Exception as e:
                print("Regime detection failed:", str(e))
                
            if req.store_forecast:
                forecast_id = str(uuid.uuid4())
                forecast_run = {
                    "forecast_id": forecast_id,
                    "ticker": ticker,
                    "model_name": req.model_name,
                    "tokenizer_id": "NeoQuasar/Kronos-Tokenizer-2k" if req.model_name == 'kronos-mini' else "NeoQuasar/Kronos-Tokenizer-base",
                    "horizon": req.pred_len,
                    "lookback": req.lookback,
                    "temperature": req.temperature,
                    "top_p": req.top_p,
                    "sample_count": req.sample_count,
                    "aggregation_method": req.aggregation_method,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "historical_window_end": df['timestamps'].iloc[-1].isoformat(),
                    "predicted_timestamps": [future_timestamps[j].isoformat() for j in range(req.pred_len)],
                    "predicted_paths": [] if not req.return_paths else [ [float(p['close'].iloc[j]) for j in range(req.pred_len)] for p in all_preds ],
                    "aggregated_forecast": pred_records,
                    "regime": current_regime,
                    "status": "pending",
                    "run_label": req.run_label,
                    "user_session_id": None
                }
                GLOBAL_STATE["forecast_store"][forecast_id] = forecast_run
                
            out_res = {
                "historical": [
                    {**row, "timestamps": row["timestamps"].isoformat()} 
                    for row in historical_data
                ],
                "prediction": pred_records,
                "latest_time": df['timestamps'].iloc[-1].isoformat()
            }
            if current_regime:
                out_res["regime"] = current_regime
            if req.store_forecast:
                out_res["forecast_id"] = forecast_id
            if req.return_paths:
                out_res["paths"] = [ [float(p['close'].iloc[j]) for j in range(req.pred_len)] for p in all_preds ]
            if req.return_baselines:
                if 'generate_baselines' in globals():
                    out_res["baselines"] = generate_baselines(df, future_timestamps)

            results[ticker] = out_res
            pred_time = time.time() - t_start
            logger.info("Prediction successful", extra={"structured_data": {"event": "predict", "ticker": ticker, "model": req.model_name, "latency_sec": pred_time, "sample_count": req.sample_count}})
            
        except Exception as e:
            pred_time = time.time() - t_start
            logger.error("Predict error", exc_info=True, extra={"structured_data": {"event": "predict_error", "ticker": ticker, "model": req.model_name, "latency_sec": pred_time}})
            results[ticker] = {"error": str(e)}
            
    return {"status": "success", "results": results}

@app.get("/api/poll")
async def poll_prices(ticker: str):
    """
    Fetch the very latest minute bar to tick the Ground Truth graph.
    Normally we'd use websocket, but simple polling is fine for 1min bars.
    """
    try:
        df = yf.download(ticker, period="1d", interval="1m", progress=False)
        if df.empty:
            return {"status": "error", "message": "No data"}
            
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [col[0].lower() for col in df.columns]
        else:
            df.columns = [col.lower() for col in df.columns]
            
        df = df.reset_index()
        if 'Datetime' in df.columns:
            df = df.rename(columns={'Datetime': 'timestamps'})
        elif 'Date' in df.columns:
            df = df.rename(columns={'Date': 'timestamps'})
            
        if pd.api.types.is_datetime64_any_dtype(df['timestamps']) and df['timestamps'].dt.tz is not None:
            df['timestamps'] = df['timestamps'].dt.tz_localize(None)
            
        latest = df.iloc[-1]
        
        return {
            "status": "success",
            "data": {
                "timestamps": latest["timestamps"].isoformat(),
                "open": float(latest["open"]),
                "high": float(latest["high"]),
                "low": float(latest["low"]),
                "close": float(latest["close"]),
                "volume": float(latest["volume"])
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/score_pending")
async def score_pending():
    t_start = time.time()
    try:
        scored_count = 0
        pending_by_ticker = {}
        for fid, f in GLOBAL_STATE["forecast_store"].items():
            if f["status"] in ["pending", "partially_scored"]:
                pending_by_ticker.setdefault(f["ticker"], []).append(fid)
                
        for ticker, fids in pending_by_ticker.items():
            try:
                df = fetch_live_data(ticker, lookback=1440)
            except Exception as e:
                logger.error("Score fetch failure", extra={"structured_data": {"event": "ticker_fetch_failure", "ticker": ticker, "error": str(e)}})
                continue
                
            # Timezone aware/naive handling
            ts_index = pd.DatetimeIndex(df['timestamps'])
            if ts_index.tz is not None:
                ts_index = ts_index.tz_localize(None)
                
            realized_series = pd.Series(df['close'].values, index=ts_index)
            
            for fid in fids:
                f = GLOBAL_STATE["forecast_store"][fid]
                preds = f["aggregated_forecast"]
                
                y_pred = []
                y_true = []
                
                for j, p in enumerate(preds):
                    ts = pd.to_datetime(p["timestamps"])
                    if ts.tz is not None:
                        ts = ts.tz_localize(None)
                    
                    if ts in realized_series.index:
                        y_pred.append(p["close"])
                        y_true.append(realized_series[ts])
                
                if len(y_true) > 0:
                    y_pred_arr = np.array(y_pred)
                    y_true_arr = np.array(y_true)
                    mae = np.mean(np.abs(y_true_arr - y_pred_arr))
                    rmse = np.sqrt(np.mean((y_true_arr - y_pred_arr)**2))
                    
                    f["scoring"] = {
                        "scored_points": len(y_true),
                        "mae": float(mae),
                        "rmse": float(rmse),
                        "realized": [{"ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts), "close": val} for ts, val in zip(realized_series.index, y_true_arr)]
                    }
                    
                    if len(y_true) == len(preds):
                        f["status"] = "fully_scored"
                    else:
                        f["status"] = "partially_scored"
                        
                    scored_count += 1
    
        score_time = time.time() - t_start
        logger.info("Scored forecasts", extra={"structured_data": {"event": "score_pending", "scored_count": scored_count, "latency_sec": score_time}})
        return {"status": "success", "scored_forecasts": scored_count}
    except Exception as e:
        logger.error("Score pending error", exc_info=True, extra={"structured_data": {"event": "score_pending_error"}})
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.get("/api/leaderboard")
async def get_leaderboard(ticker: str = None):
    t_start = time.time()
    metrics = {}
    for fid, f in GLOBAL_STATE["forecast_store"].items():
        if ticker and f["ticker"] != ticker:
            continue
        if "scoring" not in f:
            continue
        
        m_name = f["model_name"]
        mae = f["scoring"].get("mae")
        rmse = f["scoring"].get("rmse")
        if mae is None:
            continue
            
        if m_name not in metrics:
            metrics[m_name] = {"overall": {"mae_sum": 0, "rmse_sum": 0, "count": 0}, "regimes": {}}
            
        metrics[m_name]["overall"]["mae_sum"] += mae
        metrics[m_name]["overall"]["rmse_sum"] += rmse
        metrics[m_name]["overall"]["count"] += 1
        
        regm = f.get("regime")
        if regm:
            for r_type, r_val in regm.items(): # e.g. 'trend': 'trending up'
                if r_type not in metrics[m_name]["regimes"]:
                    metrics[m_name]["regimes"][r_type] = {}
                if r_val not in metrics[m_name]["regimes"][r_type]:
                    metrics[m_name]["regimes"][r_type][r_val] = {"mae_sum": 0, "rmse_sum": 0, "count": 0}
                metrics[m_name]["regimes"][r_type][r_val]["mae_sum"] += mae
                metrics[m_name]["regimes"][r_type][r_val]["rmse_sum"] += rmse
                metrics[m_name]["regimes"][r_type][r_val]["count"] += 1
        
    leaderboard = {}
    for m, mdata in metrics.items():
        leaderboard[m] = {
            "overall": {
                "mae": mdata["overall"]["mae_sum"] / mdata["overall"]["count"],
                "rmse": mdata["overall"]["rmse_sum"] / mdata["overall"]["count"],
                "count": mdata["overall"]["count"]
            },
            "regimes": {}
        }
        for r_type, r_dict in mdata["regimes"].items():
            leaderboard[m]["regimes"][r_type] = {}
            for r_val, r_stats in r_dict.items():
                leaderboard[m]["regimes"][r_type][r_val] = {
                    "mae": r_stats["mae_sum"] / r_stats["count"],
                    "rmse": r_stats["rmse_sum"] / r_stats["count"],
                    "count": r_stats["count"]
                }
            leaderboard[m]["regimes"]["session"] = {"overall": {"mae": mdata["overall"]["mae_sum"] / mdata["overall"]["count"], "rmse": mdata["overall"]["rmse_sum"] / mdata["overall"]["count"], "count": 1}}

    lb_time = time.time() - t_start
    logger.info("Generated leaderboard", extra={"structured_data": {"event": "get_leaderboard", "latency_sec": lb_time}})
    return {"status": "success", "leaderboard": leaderboard}


class EnsemblePredictRequest(BaseModel):
    tickers: List[str]
    lookback: int = 400
    pred_len: int = 120
    models: List[str]
    weighting_scheme: str = 'equal' # equal, inverse_mae
    sample_count: int = 1

@app.post("/api/ensemble_predict")
async def run_ensemble_predict(req: EnsemblePredictRequest):
    # Generate predictions for each model
    results = {}
    for ticker in req.tickers:
        ticker_preds = []
        model_names = []
        for model_name in req.models:
            # We call the same internal logic basically or formulate an internal predictor request
            if model_name not in GLOBAL_STATE["predictors"]:
                continue
                
            predictor = GLOBAL_STATE["predictors"][model_name]
            try:
                df = fetch_live_data(ticker, req.lookback)
                df['timestamps'] = pd.to_datetime(df['timestamps'])
                if df['timestamps'].dt.tz is not None:
                    df['timestamps'] = df['timestamps'].dt.tz_localize(None)
                    
                x_df = df[['open', 'high', 'low', 'close', 'volume']].copy()
                for col in ['open', 'high', 'low', 'close', 'volume']:
                    x_df[col] = pd.to_numeric(x_df[col], errors='coerce').astype(float)
                x_df = x_df.reset_index(drop=True)
                
                x_timestamp = df['timestamps'].reset_index(drop=True)
                time_diff = x_timestamp.iloc[-1] - x_timestamp.iloc[-2] if len(x_timestamp) > 1 else pd.Timedelta(minutes=1)
                future_timestamps = pd.date_range(
                    start=x_timestamp.iloc[-1] + time_diff,
                    periods=req.pred_len,
                    freq=time_diff
                )
                y_timestamp = pd.Series(future_timestamps, name='timestamps').reset_index(drop=True)
                
                pred_df = predictor.predict(
                    df=x_df,
                    x_timestamp=x_timestamp,
                    y_timestamp=y_timestamp,
                    pred_len=req.pred_len,
                    T=1.0,
                    top_p=0.9,
                    sample_count=req.sample_count,
                    verbose=False
                )
                ticker_preds.append(pred_df['close'].values)
                model_names.append(model_name)
                
            except Exception as e:
                print(e)
                continue
                
        if not ticker_preds:
            results[ticker] = {"error": "No models succeeded"}
            continue
            
        tensor_2d = np.stack(ticker_preds, axis=0) # (num_models, pred_len)
        
        # Determine weights
        weights = np.ones(len(model_names)) / len(model_names)
        
        if req.weighting_scheme == 'inverse_mae':
            mae_list = []
            for m in model_names:
                # get score from leaderboard
                mae_sum = 0
                count = 0
                for fid, f in GLOBAL_STATE["forecast_store"].items():
                    if f["ticker"] == ticker and f["model_name"] == m and "scoring" in f:
                        if f["scoring"].get("mae") is not None:
                            mae_sum += f["scoring"]["mae"]
                            count += 1
                if count > 0:
                    mae_list.append(mae_sum / count)
                else:
                    # fallback to some default
                    mae_list.append(1.0)
            
            mae_arr = np.array(mae_list)
            inv_mae = 1.0 / (mae_arr + 1e-6)
            weights = inv_mae / np.sum(inv_mae)
            
        ensemble_pred = np.average(tensor_2d, axis=0, weights=weights)
        
        pred_records = []
        for j in range(req.pred_len):
            pred_records.append({
                "timestamps": future_timestamps[j].isoformat(),
                "close": float(ensemble_pred[j])
            })
            
        results[ticker] = {
            "prediction": pred_records,
            "weights": {m: float(w) for m, w in zip(model_names, weights)},
            "models_used": model_names
        }
        
    return {"status": "success", "results": results}

@app.post("/api/replay")
async def api_replay(req: ReplayRequest):
    if not MODEL_AVAILABLE:
        raise HTTPException(status_code=500, detail="Kronos library not available.")
    if req.model_name not in GLOBAL_STATE["predictors"]:
        raise HTTPException(status_code=400, detail="Model not loaded. Call /load_model first.")
        
    try:
        return run_replay_forecast(req, GLOBAL_STATE["predictors"][req.model_name])
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.post("/api/backtest")
async def api_backtest(req: BacktestRequest):
    if not MODEL_AVAILABLE:
        raise HTTPException(status_code=500, detail="Kronos library not available.")
    if req.model_name not in GLOBAL_STATE["predictors"]:
        raise HTTPException(status_code=400, detail="Model not loaded. Call /load_model first.")
        
    try:
        return run_mini_backtest(req, GLOBAL_STATE["predictors"][req.model_name])
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

if __name__ == "__main__":
    # Ensure uvicorn runs on IP
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
