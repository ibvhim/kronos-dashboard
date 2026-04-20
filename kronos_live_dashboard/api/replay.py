import yfinance as yf
import pandas as pd
import numpy as np
from pydantic import BaseModel
from typing import List

class ReplayRequest(BaseModel):
    model_name: str
    ticker: str
    end_time: str
    lookback: int = 120
    pred_len: int = 10
    sample_count: int = 5
    quantiles: List[float] = [0.1, 0.25, 0.75, 0.9]

def run_replay_forecast(req: ReplayRequest, predictor):
    print(f"Starting replay for {req.ticker} ending {req.end_time}")
    df = yf.download(req.ticker, period="7d", interval="1m", progress=False)
    if df.empty:
        return {"error": "No data available."}
        
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0].lower() for col in df.columns]
    else:
        df.columns = [col.lower() for col in df.columns]
        
    df = df.reset_index()
    if 'Datetime' in df.columns:
        df = df.rename(columns={'Datetime': 'timestamps'})
    elif 'Date' in df.columns:
        df = df.rename(columns={'Date': 'timestamps'})
        
    df = df.dropna()
    df['timestamps'] = pd.to_datetime(df['timestamps'])
    if df['timestamps'].dt.tz is not None:
        df['timestamps'] = df['timestamps'].dt.tz_localize(None)
        
    target_time = pd.to_datetime(req.end_time)
    if target_time.tz is not None:
        target_time = target_time.tz_localize(None)
        
    past_df = df[df['timestamps'] <= target_time].copy()
    if past_df.empty:
        return {"error": "Target time not found in last 7 days."}
        
    future_df = df[df['timestamps'] > target_time].head(req.pred_len).copy()
        
    past_df = past_df.tail(req.lookback).reset_index(drop=True)
    
    x_df = past_df[['open', 'high', 'low', 'close', 'volume']].copy()
    for col in ['open', 'high', 'low', 'close', 'volume']:
        x_df[col] = pd.to_numeric(x_df[col], errors='coerce').astype(float)
        
    x_timestamp = past_df['timestamps'].reset_index(drop=True)
    time_diff = pd.Timedelta(minutes=1)
    future_timestamps = pd.date_range(start=x_timestamp.iloc[-1] + time_diff, periods=req.pred_len, freq=time_diff)
    y_timestamp = pd.Series(future_timestamps, name='timestamps').reset_index(drop=True)
    
    all_preds = []
    for i in range(req.sample_count):
        pred_df = predictor.predict(
            df=x_df, x_timestamp=x_timestamp, y_timestamp=y_timestamp,
            pred_len=req.pred_len, T=1.0, top_p=0.9, sample_count=1, verbose=False
        )
        all_preds.append(pred_df)
        
    cols = ['open', 'high', 'low', 'close']
    tensor_3d = np.stack([p[cols].values for p in all_preds], axis=0)
    
    mean_vals = np.mean(tensor_3d, axis=0)
    
    q_vals = {}
    for q in req.quantiles:
        q_vals[q] = np.quantile(tensor_3d, q, axis=0)
        
    pred_records = []
    for j in range(req.pred_len):
        rec = {
            "timestamps": future_timestamps[j].isoformat(),
            "close": float(mean_vals[j, 3])
        }
        for q in req.quantiles:
            rec[f"q{int(q*100)}_close"] = float(q_vals[q][j, 3])
        pred_records.append(rec)
        
    out_res = {
        "status": "success",
        "historical": [
            {**row, "timestamps": row["timestamps"].isoformat()} 
            for row in past_df.tail(60).to_dict('records') # Only send 60 to UI
        ],
        "prediction": pred_records,
        "actual_future": [
            {**row, "timestamps": row["timestamps"].isoformat()} 
            for row in future_df.to_dict('records')
        ],
        "paths": [ [float(p['close'].iloc[j]) for j in range(req.pred_len)] for p in all_preds ]
    }
    
    return out_res
