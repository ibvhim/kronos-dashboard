import pandas as pd
import numpy as np

def detect_regime(df: pd.DataFrame, ticker: str) -> dict:
    if len(df) < 50:
        return {
            "trend": "unknown",
            "volatility": "unknown",
            "liquidity": "unknown",
            "session": "unknown"
        }
        
    last_close = df['close'].iloc[-1]
    
    # 1. Trend: distance from 50-period EMA
    ema50 = df['close'].ewm(span=50, adjust=False).mean().iloc[-1]
    pct_diff = (last_close - ema50) / ema50
    if pct_diff > 0.005: 
        trend = "trending up"
    elif pct_diff < -0.005:
        trend = "trending down"
    else:
        trend = "ranging"
        
    # 2. Volatility: based on rolling 20-period ATR normalized
    high = df['high']
    low = df['low']
    close_prev = df['close'].shift(1)
    tr = pd.concat([high - low, (high - close_prev).abs(), (low - close_prev).abs()], axis=1).max(axis=1)
    atr20 = tr.rolling(20).mean()
    atr_hist = atr20.rolling(200, min_periods=10).mean().iloc[-1]
    atr_curr = atr20.iloc[-1]
    
    if pd.isna(atr_hist) or atr_hist == 0:
        volatility = "medium"
    else:
        ratio = atr_curr / atr_hist
        if ratio > 1.5:
            volatility = "high"
        elif ratio < 0.5:
            volatility = "low"
        else:
            volatility = "medium"
            
    # 3. Liquidity: Volume percentile
    if 'volume' in df.columns and df['volume'].sum() > 0:
        vol_curr = df['volume'].rolling(5).mean().iloc[-1]
        vol_hist = df['volume'].rolling(200, min_periods=10).median().iloc[-1]
        if pd.isna(vol_hist) or vol_hist == 0:
            liquidity = "normal"
        else:
            v_ratio = vol_curr / vol_hist
            if v_ratio > 1.5:
                liquidity = "high"
            elif v_ratio < 0.5:
                liquidity = "low"
            else:
                liquidity = "normal"
    else:
        liquidity = "normal"
        
    # 4. Session Regime
    ts = pd.to_datetime(df['timestamps'].iloc[-1])
    is_crypto = "-" in ticker
    if is_crypto:
        if ts.weekday() >= 5:
            session = "weekend"
        else:
            session = "weekday"
    else:
        hour = ts.hour
        if 9 <= hour < 10:
            session = "market open"
        elif 10 <= hour < 15:
            session = "regular"
        elif 15 <= hour < 16:
            session = "close"
        else:
            session = "overnight"
            
    return {
        "trend": trend,
        "volatility": volatility,
        "liquidity": liquidity,
        "session": session
    }
