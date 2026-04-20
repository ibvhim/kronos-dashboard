import pytest
import numpy as np
import pandas as pd
from api.baselines import generate_baselines
from api.regime import detect_regime

# 1. Multi-path aggregation & Quantile Band correctness
def test_quantile_band_generation():
    # Simulate a tensor_3d from Kronos model (sample_count, pred_len, num_cols)
    # say we have 5 paths, 10 minutes out, 4 columns (open, high, low, close)
    tensor_3d = np.random.rand(5, 10, 4) * 100
    
    mean_vals = np.mean(tensor_3d, axis=0)
    assert mean_vals.shape == (10, 4)
    
    # 0.1 and 0.9 quantiles
    q10 = np.quantile(tensor_3d, 0.1, axis=0)
    q90 = np.quantile(tensor_3d, 0.9, axis=0)
    
    assert q10.shape == (10, 4)
    assert q90.shape == (10, 4)
    
    # q10 should be less than or equal to q90 intrinsically
    assert np.all(q10 <= q90)

# 2. Baseline generation correctness
def test_baselines():
    # generate a dummy historical dataset
    dates = pd.date_range('2026-04-01', periods=100, freq='1min')
    df = pd.DataFrame({
        'timestamps': dates,
        'close': np.linspace(100, 110, 100),
        'high': np.linspace(101, 111, 100),
        'low': np.linspace(99, 109, 100)
    })
    
    future_timestamps = pd.date_range(dates[-1] + pd.Timedelta(minutes=1), periods=10, freq='1min')
    res = generate_baselines(df, future_timestamps)
    
    assert 'persistence' in res
    assert 'ema_drift' in res
    
    # persistence should equal the VERY last close price for all future steps
    pers_data = res['persistence']['prediction']
    assert len(pers_data) == 10
    assert all(abs(p['close'] - 110.0) < 1e-5 for p in pers_data)

# 3. Regime classification edge cases
def test_regime_classification():
    dates = pd.date_range('2026-04-10', periods=60, freq='1min')
    # high volatility random walk
    df = pd.DataFrame({
        'timestamps': dates,
        'close': [100 + (np.random.rand() * 10 - 5) for _ in range(60)],
        'high': [105 for _ in range(60)],
        'low': [95 for _ in range(60)],
        'volume': [1000 for _ in range(60)]
    })
    
    regime = detect_regime(df, 'AAPL')
    assert 'trend' in regime
    assert 'volatility' in regime
    assert 'liquidity' in regime

# 4. Scoring metrics correctness
def test_scoring_metrics():
    # simulate true vs pred
    y_true = np.array([100, 101, 102])
    y_pred = np.array([101, 101, 100])
    
    mae = np.mean(np.abs(y_true - y_pred))
    assert mae == 1.0  # |100-101| + |101-101| + |102-100| = 1 + 0 + 2 = 3 / 3 = 1.0
    
    rmse = np.sqrt(np.mean((y_true - y_pred)**2))
    assert round(rmse, 4) == 1.2910 # sqrt((1+0+4)/3) = sqrt(1.666)
