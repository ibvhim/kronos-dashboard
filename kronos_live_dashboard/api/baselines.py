import numpy as np
import pandas as pd

def compute_atr(df, period=14):
    high = df['high']
    low = df['low']
    close_prev = df['close'].shift(1)
    
    tr1 = high - low
    tr2 = (high - close_prev).abs()
    tr3 = (low - close_prev).abs()
    
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(window=period).mean()
    return atr

def generate_baselines(df, future_timestamps):
    pred_len = len(future_timestamps)
    if len(df) == 0:
        return {}

    last_close = df['close'].iloc[-1]
    baselines = {}
    
    # 1. Last value / persistence
    baselines['persistence'] = np.full(pred_len, last_close)
    
    # 2. Rolling mean (20 periods)
    if len(df) >= 20:
        roll_mean = df['close'].rolling(20).mean().iloc[-1]
    else:
        roll_mean = df['close'].mean()
    if pd.isna(roll_mean): roll_mean = last_close
    baselines['rolling_mean'] = np.full(pred_len, roll_mean)
    
    # 3. EMA continuation
    if len(df) > 0:
        ema = df['close'].ewm(span=min(20, len(df)), adjust=False).mean().iloc[-1]
    else:
        ema = last_close
    baselines['ema'] = np.full(pred_len, ema)
    
    # 4. Drift forecast (recent 10 slope)
    if len(df) >= 10:
        past_10 = df['close'].iloc[-10:].values
        x = np.arange(10)
        slope, _ = np.polyfit(x, past_10, 1)
        drift = last_close + slope * np.arange(1, pred_len + 1)
    else:
        drift = np.full(pred_len, last_close)
    baselines['drift'] = drift
    
    # 5. Direction-only baseline based on recent momentum sign
    if len(df) >= 10:
        mom_10 = df['close'].iloc[-1] - df['close'].iloc[-10]
    else:
        mom_10 = df['close'].iloc[-1] - df['close'].iloc[0]
        
    atr = compute_atr(df, 14).iloc[-1]
    if pd.isna(atr): atr = df['close'].std() * 0.5
    if pd.isna(atr): atr = 0.0

    sign = np.sign(mom_10)
    direction_baseline = last_close + sign * np.linspace(0, atr, pred_len)
    baselines['momentum_direction'] = direction_baseline
    
    formatted_baselines = {}
    for name, path in baselines.items():
        records = []
        for j, ts in enumerate(future_timestamps):
             records.append({
                 "timestamps": ts.isoformat(),
                 "close": float(path[j])
             })
        formatted_baselines[name] = {"prediction": records}
        
    return formatted_baselines
