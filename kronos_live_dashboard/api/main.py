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
    "tokenizer": None,
    "predictors": {}
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
    if not MODEL_AVAILABLE:
        raise HTTPException(status_code=500, detail="Kronos library not available.")
        
    if req.model_name not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail="Invalid model name.")
        
    if GLOBAL_STATE["tokenizer"] is None:
        GLOBAL_STATE["tokenizer"] = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
        
    if req.model_name not in GLOBAL_STATE["predictors"]:
        model_config = AVAILABLE_MODELS[req.model_name]
        try:
            print(f"Loading {req.model_name}...")
            model = Kronos.from_pretrained(model_config['model_id'])
            predictor = KronosPredictor(
                model, 
                GLOBAL_STATE["tokenizer"], 
                device=req.device, 
                max_context=model_config['context_length']
            )
            GLOBAL_STATE["predictors"][req.model_name] = predictor
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")
            
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
        try:
            # 1. Fetch live data
            df = fetch_live_data(ticker, req.lookback)
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
            
            # 3. Format output
            historical_data = df.to_dict('records')
            
            # Format prediction
            pred_records = []
            for j, (_, row) in enumerate(pred_df.iterrows()):
                pred_records.append({
                    "timestamps": future_timestamps[j].isoformat(),
                    "open": float(row['open']),
                    "high": float(row['high']),
                    "low": float(row['low']),
                    "close": float(row['close']),
                    "volume": float(row.get('volume', 0))
                })
                
            results[ticker] = {
                "historical": [
                    {**row, "timestamps": row["timestamps"].isoformat()} 
                    for row in historical_data
                ],
                "prediction": pred_records,
                "latest_time": df['timestamps'].iloc[-1].isoformat()
            }
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Error predicting {ticker}: {e}")
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

if __name__ == "__main__":
    # Ensure uvicorn runs on IP
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
