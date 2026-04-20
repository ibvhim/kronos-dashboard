import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime
from pydantic import BaseModel

class BacktestRequest(BaseModel):
    model_name: str
    ticker: str
    lookback: int = 120
    pred_len: int = 20
    entry_threshold_pct: float = 0.001
    stop_loss_pct: float = 0.005
    take_profit_pct: float = 0.01

def run_mini_backtest(req: BacktestRequest, predictor):
    print(f"Starting mini-backtest for {req.ticker} with {req.model_name}")
    # We fetch max 7d of 1m data but to keep backtest fast, we will only evaluate points every 2 hours
    df = yf.download(req.ticker, period="5d", interval="1m", progress=False)
    if df.empty:
        return {"error": "No data available for backtest."}
        
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
        
    # generate test points
    test_indices = list(range(req.lookback, len(df) - req.pred_len, 120))  # Step by 120 mins = 2 hours
    if len(test_indices) > 20: 
        test_indices = test_indices[-20:] # Limit to 20 trades max to protect performance
        
    trades = []
    capital = 10000.0
    
    for idx in test_indices:
        past_df = df.iloc[idx - req.lookback : idx].copy()
        future_df = df.iloc[idx : idx + req.pred_len].copy()
        
        last_price = float(past_df['close'].iloc[-1])
        
        x_df = past_df[['open', 'high', 'low', 'close', 'volume']].copy()
        for col in ['open', 'high', 'low', 'close', 'volume']:
            x_df[col] = pd.to_numeric(x_df[col], errors='coerce').astype(float)
        x_df = x_df.reset_index(drop=True)
        
        x_timestamp = past_df['timestamps'].reset_index(drop=True)
        time_diff = pd.Timedelta(minutes=1)
        future_timestamps = pd.date_range(start=x_timestamp.iloc[-1] + time_diff, periods=req.pred_len, freq=time_diff)
        y_timestamp = pd.Series(future_timestamps, name='timestamps').reset_index(drop=True)
        
        try:
            pred = predictor.predict(
                df=x_df, x_timestamp=x_timestamp, y_timestamp=y_timestamp,
                pred_len=req.pred_len, sample_count=1, verbose=False
            )
        except Exception:
            continue
            
        pred_end_price = float(pred['close'].iloc[-1])
        expected_ret = (pred_end_price - last_price) / last_price
        
        direction = 0
        if expected_ret > req.entry_threshold_pct: direction = 1
        elif expected_ret < -req.entry_threshold_pct: direction = -1
        
        if direction != 0:
            entry_price = last_price
            exit_price = entry_price
            reason = "Hold till end"
            
            for f_idx in range(len(future_df)):
                f_high = float(future_df['high'].iloc[f_idx])
                f_low = float(future_df['low'].iloc[f_idx])
                f_close = float(future_df['close'].iloc[f_idx])
                
                if direction == 1:
                    if (entry_price - f_low)/entry_price > req.stop_loss_pct:
                        exit_price = entry_price * (1 - req.stop_loss_pct)
                        reason = "Stop Loss"
                        break
                    elif (f_high - entry_price)/entry_price > req.take_profit_pct:
                        exit_price = entry_price * (1 + req.take_profit_pct)
                        reason = "Take Profit"
                        break
                else:
                    if (f_high - entry_price)/entry_price > req.stop_loss_pct:
                        exit_price = entry_price * (1 + req.stop_loss_pct)
                        reason = "Stop Loss"
                        break
                    elif (entry_price - f_low)/entry_price > req.take_profit_pct:
                        exit_price = entry_price * (1 - req.take_profit_pct)
                        reason = "Take Profit"
                        break
                        
            if reason == "Hold till end":
                exit_price = float(future_df['close'].iloc[-1])
                
            pnl_pct = (exit_price - entry_price)/entry_price if direction == 1 else (entry_price - exit_price)/entry_price
            trade_pnl_usd = capital * pnl_pct
            capital += trade_pnl_usd
            
            trades.append({
                "time": str(past_df['timestamps'].iloc[-1]),
                "direction": "LONG" if direction == 1 else "SHORT",
                "entry_price": entry_price,
                "exit_price": exit_price,
                "expected_ret": expected_ret,
                "actual_pnl_pct": pnl_pct,
                "pnl_usd": trade_pnl_usd,
                "reason": reason
            })
            
    hit_rate = sum([1 for t in trades if t['pnl_usd'] > 0]) / len(trades) if len(trades)>0 else 0
            
    return {
        "status": "success",
        "trades": trades,
        "summary": {
            "total_trades": len(trades),
            "hit_rate": hit_rate,
            "final_capital": capital,
            "net_profit": capital - 10000.0,
            "net_profit_pct": (capital - 10000.0)/10000.0
        }
    }
