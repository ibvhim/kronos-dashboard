import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  ComposedChart, Line, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ReferenceLine, Brush
} from 'recharts';
import { Loader, TrendingUp, Eraser, Trash2, Maximize2, Minimize2, X, Settings2, Eye, EyeOff } from 'lucide-react';
import { buildChartData, parsePredictionAPIResponse } from './ChartAdapter';

const API_URL = 'http://localhost:8001/api';
const PRED_COLORS = ['#d97706', '#db2777', '#7c3aed', '#059669', '#ea580c', '#0284c7', '#c026d3', '#ca8a04'];
const PRED_COLORS_DARK = ['#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#38bdf8', '#e879f9', '#facc15'];

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function DiagnosticsPanel({ pred }) {
  if (!pred) return null;
  const reg = pred.regime || {};

  let avgWidthStr = "N/A";
  if (pred.data && pred.data.length > 0 && pred.data[pred.data.length-1].q90_close) {
      const pData = pred.data.filter(d => d.q90_close != null);
      if (pData.length > 0) {
        const sumWidth = pData.reduce((s, d) => s + (d.q90_close - d.q10_close)/d.mean_close, 0);
        const avgWidthPct = (sumWidth / pData.length) * 100;
        avgWidthStr = `${avgWidthPct.toFixed(2)}%`;
      }
  }

  let movePct = "0%";
  if (pred.data && pred.data.length > 1 && pred.anchorClose) {
      movePct = ((pred.data[pred.data.length-1].mean_close - pred.anchorClose) / pred.anchorClose * 100).toFixed(2) + '%';
  }

  return (
    <div className="diagnostics-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--surface-1)', borderTop: '1px solid var(--edge)', fontSize: '0.75rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      <div className="diag-item"><span style={{color: 'var(--ink-secondary)'}}>Mode:</span> {pred.model}</div>
      <div className="diag-item"><span style={{color: 'var(--ink-secondary)'}}>Samples:</span> {pred.samples}</div>
      <div className="diag-item"><span style={{color: 'var(--ink-secondary)'}}>Est. Move:</span> {movePct}</div>
      <div className="diag-item"><span style={{color: 'var(--ink-secondary)'}}>Avg Width (80%):</span> {avgWidthStr}</div>
      <div className="diag-item"><span style={{color: 'var(--ink-secondary)'}}>Trend:</span> {reg.trend || '?'}</div>
      <div className="diag-item"><span style={{color: 'var(--ink-secondary)'}}>Vol:</span> {reg.volatility || '?'}</div>
      <div className="diag-item"><span style={{color: 'var(--ink-secondary)'}}>Liq:</span> {reg.liquidity || '?'}</div>
      <div className="diag-item"><span style={{color: 'var(--ink-secondary)'}}>Sess:</span> {reg.session || '?'}</div>
    </div>
  );
}

const fmt = (v) => typeof v === 'number' ? `$${v.toFixed(2)}` : '—';

function KronosTooltip({ active, payload, label, visiblePredictions, gtColor }) {
  if (!active || !payload || payload.length === 0) return null;

  // Extract the row from the first payload entry
  const row = payload[0]?.payload || {};
  const gt = row.groundTruth;

  // Group prediction info by prediction id
  const predSummaries = [];
  if (visiblePredictions) {
    visiblePredictions.forEach(pred => {
      const pKey = `pred_${pred.id}`;
      const central = row[`${pKey}_central`];
      if (central == null) return; // this prediction has no data at this timestamp

      const band80 = row[`${pKey}_band80`]; // [low, high] or undefined
      const band50 = row[`${pKey}_band50`];

      predSummaries.push({
        model: pred.model,
        predLen: pred.predLen,
        color: pred.color,
        central,
        band80,
        band50,
      });
    });
  }

  return (
    <div className="custom-tooltip">
      <div className="tooltip-header">{label}</div>

      {/* Ground Truth */}
      {gt != null && (
        <div className="tooltip-row" style={{ marginBottom: predSummaries.length > 0 ? '6px' : 0 }}>
          <span className="label">
            <span className="dot" style={{ background: gtColor }} />
            Ground Truth
          </span>
          <span className="value gt">{fmt(gt)}</span>
        </div>
      )}

      {/* Prediction groups */}
      {predSummaries.map((ps, i) => (
        <div key={i} style={{ borderTop: i > 0 || gt != null ? '1px solid var(--edge-soft)' : 'none', paddingTop: '4px', marginTop: '4px' }}>
          <div className="tooltip-row">
            <span className="label">
              <span className="dot" style={{ background: ps.color }} />
              {ps.model} <span style={{ opacity: 0.5, marginLeft: '3px' }}>({ps.predLen}m)</span>
            </span>
            <span className="value">{fmt(ps.central)}</span>
          </div>
          {ps.band80 && (
            <div className="tooltip-row" style={{ paddingLeft: '14px' }}>
              <span className="label" style={{ fontSize: '0.7rem', color: 'var(--ink-tertiary)' }}>80% band</span>
              <span className="value" style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--ink-secondary)' }}>
                {fmt(ps.band80[0])} — {fmt(ps.band80[1])}
              </span>
            </div>
          )}
          {ps.band50 && (
            <div className="tooltip-row" style={{ paddingLeft: '14px' }}>
              <span className="label" style={{ fontSize: '0.7rem', color: 'var(--ink-tertiary)' }}>50% band</span>
              <span className="value" style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--ink-secondary)' }}>
                {fmt(ps.band50[0])} — {fmt(ps.band50[1])}
              </span>
            </div>
          )}
        </div>
      ))}

      {gt == null && predSummaries.length === 0 && (
        <div className="tooltip-row"><span className="no-data">No data at this point</span></div>
      )}
    </div>
  );
}

export default function StockCard({ ticker, models, onRemove, span, onToggleSpan, theme }) {
  const [gtData, setGtData] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [hiddenPreds, setHiddenPreds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [latestPrice, setLatestPrice] = useState(null);
  const [cardModel, setCardModel] = useState(models[0] || '');
  const [cardPredLen, setCardPredLen] = useState(10);
  const [predicting, setPredicting] = useState(false);
  const [fetchingHistory, setFetchingHistory] = useState(false);
  const pollRef = useRef(null);

  // Advanced Controls Config
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cfgLookback, setCfgLookback] = useState(120);
  const [cfgSamples, setCfgSamples] = useState(5);
  const [cfgAgg, setCfgAgg] = useState('mean');
  const [cfgTemp, setCfgTemp] = useState(1.0);
  const [cfgTopP, setCfgTopP] = useState(0.9);

  const [showSpaghetti, setShowSpaghetti] = useState(false);
  const [showBands, setShowBands] = useState(true);
  const [showBaselines, setShowBaselines] = useState(false);

  // Brush zoom state — null means "not yet initialized, use default"
  const [brushRange, setBrushRange] = useState(null);
  const brushInitialized = useRef(false);

  const predColors = theme === 'dark' ? PRED_COLORS_DARK : PRED_COLORS;
  const gtColor = theme === 'dark' ? '#6ba3d6' : '#2563b4';
  const axisColor = theme === 'dark' ? '#6b6055' : '#8a837b';
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
  const refLineColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
  const brushFillColor = theme === 'dark' ? '#162036' : '#f0ede7';

  // ── Fetch ground truth history (independent of predictions) ──
  const fetchHistoryData = useCallback(async (lookback) => {
    try {
      setFetchingHistory(true);
      if (!cardModel) return;
      await axios.post(`${API_URL}/load_model`, { model_name: cardModel, device: 'cpu' });
      const res = await axios.post(`${API_URL}/predict`, { model_name: cardModel, tickers: [ticker], lookback: lookback, pred_len: 1, sample_count: 1 });
      const tickRes = res.data.results[ticker];
      if (tickRes?.error) { setFetchingHistory(false); return; }
      if (!tickRes?.historical?.length) { setFetchingHistory(false); return; }
      const history = tickRes.historical.map(h => ({
        time: new Date(h.timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullTime: h.timestamps, groundTruth: Number(h.close),
      }));
      setGtData(history);
      setLatestPrice(Number(tickRes.historical[tickRes.historical.length - 1].close));
      setFetchingHistory(false);
    } catch (e) {
      console.error('History fetch error', e);
      setFetchingHistory(false);
    }
  }, [ticker, cardModel]);

  // Initial load
  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true); setError(null);
        if (!cardModel) { setError('No model available'); setLoading(false); return; }
        await axios.post(`${API_URL}/load_model`, { model_name: cardModel, device: 'cpu' });
        const res = await axios.post(`${API_URL}/predict`, { model_name: cardModel, tickers: [ticker], lookback: cfgLookback, pred_len: 1, sample_count: 1 });
        const tickRes = res.data.results[ticker];
        if (tickRes?.error) { setError(tickRes.error); setLoading(false); return; }
        if (!tickRes?.historical?.length) { setError('No data received'); setLoading(false); return; }
        const history = tickRes.historical.map(h => ({
          time: new Date(h.timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          fullTime: h.timestamps, groundTruth: Number(h.close),
        }));
        setGtData(history);
        setLatestPrice(Number(tickRes.historical[tickRes.historical.length - 1].close));
        setLoading(false);
        startPolling();
      } catch (e) { setError(e.response?.data?.detail || e.message); setLoading(false); }
    };
    init();
    return () => clearInterval(pollRef.current);
  }, [ticker]);

  useEffect(() => { if (!cardModel && models.length > 0) setCardModel(models[0]); }, [models]);

  // Re-fetch when lookback changes (debounced)
  const lookbackTimerRef = useRef(null);
  useEffect(() => {
    if (loading) return; // skip during initial load
    clearTimeout(lookbackTimerRef.current);
    lookbackTimerRef.current = setTimeout(() => {
      fetchHistoryData(cfgLookback);
    }, 600); // 600ms debounce so it doesn't fire on every keystroke
    return () => clearTimeout(lookbackTimerRef.current);
  }, [cfgLookback]);

  const startPolling = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const pollRes = await axios.get(`${API_URL}/poll?ticker=${ticker}`);
        if (pollRes.data.status === 'success') {
          const liveData = pollRes.data.data;
          const newClose = Number(liveData.close);
          if (!isNaN(newClose)) setLatestPrice(newClose);
          setGtData(prev => {
            const liveTime = new Date(liveData.timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const out = [...prev];
            const idx = out.findIndex(d => d.time === liveTime);
            if (idx !== -1) { out[idx] = { ...out[idx], groundTruth: newClose }; }
            else { out.push({ time: liveTime, fullTime: liveData.timestamps, groundTruth: newClose }); out.sort((a, b) => new Date(a.fullTime) - new Date(b.fullTime)); }
            return out;
          });
        }
      } catch (e) { console.error('Polling error', e); }
    }, 60000);
  }, [ticker]);

  const handlePredict = async () => {
    try {
      setPredicting(true);
      await axios.post(`${API_URL}/load_model`, { model_name: cardModel, device: 'cpu' });
      const res = await axios.post(`${API_URL}/predict`, {
        model_name: cardModel,
        tickers: [ticker],
        lookback: cfgLookback,
        pred_len: cardPredLen,
        sample_count: cfgSamples,
        aggregation_method: cfgAgg,
        temperature: cfgTemp,
        top_p: cfgTopP,
        return_paths: true,
        return_quantiles: true,
        quantiles: [0.1, 0.25, 0.75, 0.9],
        return_baselines: true,
        store_forecast: true
      });
      const tickRes = res.data.results[ticker];
      if (tickRes?.error) { setPredicting(false); return; }

      const historical = tickRes.historical || [];
      if (historical.length > 0) {
        setGtData(historical.map(h => ({
            time: new Date(h.timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            fullTime: h.timestamps,
            groundTruth: Number(h.close)
        })));
        setLatestPrice(Number(historical[historical.length - 1].close));
      }

      const newPredId = Date.now() + Math.floor(Math.random()*1000);
      const colorHex = predColors[predictions.length % predColors.length];

      const newPred = parsePredictionAPIResponse(tickRes, {
          model: cardModel, predLen: cardPredLen, sampleCount: cfgSamples
      }, colorHex, newPredId);

      setPredictions(prev => [...prev, newPred]);
      setPredicting(false);
    } catch (e) { console.error('Prediction failed', e); setPredicting(false); }
  };

  const handleRemovePrediction = (id) => {
    setPredictions(prev => prev.filter(p => p.id !== id));
    setHiddenPreds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const togglePredVisibility = (id) => {
    setHiddenPreds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Only pass visible predictions to the chart adapter
  const visiblePredictions = useMemo(() => {
    return predictions.filter(p => !hiddenPreds.has(p.id));
  }, [predictions, hiddenPreds]);

  const mergedData = useMemo(() => {
     return buildChartData(gtData, visiblePredictions, { showSpaghetti, showBaselines });
  }, [gtData, visiblePredictions, showSpaghetti, showBaselines]);


  const renderChart = () => {
    const commonProps = { data: mergedData, margin: { top: 5, right: 10, left: -15, bottom: 5 } };
    const xAxis = <XAxis dataKey="time" stroke={axisColor} fontSize={11} tickMargin={8} minTickGap={25} />;
    const yAxis = <YAxis stroke={axisColor} domain={['auto', 'auto']} fontSize={11} tickFormatter={v => { const n = Number(v); return isNaN(n) ? '' : `$${n.toFixed(0)}`; }} />;
    const grid = <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />;
    const tooltip = <Tooltip content={<KronosTooltip visiblePredictions={visiblePredictions} gtColor={gtColor} />} />;
    const legend = <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: '0.65rem' }} />;

    const lastGtIdx = mergedData.reduce((acc, d, i) => d.groundTruth != null ? i : acc, -1);
    const dividerTime = lastGtIdx >= 0 ? mergedData[lastGtIdx].time : null;

    const chartElements = [];

    if (showBands) {
        visiblePredictions.forEach(pred => {
            const pKey = `pred_${pred.id}`;
            const c80 = hexToRgba(pred.color, 0.12);
            const c50 = hexToRgba(pred.color, 0.22);
            chartElements.push(
                <Area key={`${pKey}_band80`} type="monotone" dataKey={`${pKey}_band80`} name={`80% CI`} stroke="none" fill={c80} isAnimationActive={false} connectNulls={true} legendType="none" />
            );
            chartElements.push(
                <Area key={`${pKey}_band50`} type="monotone" dataKey={`${pKey}_band50`} name={`50% CI`} stroke="none" fill={c50} isAnimationActive={false} connectNulls={true} legendType="none" />
            );
        });
    }

    if (showSpaghetti) {
        visiblePredictions.forEach(pred => {
            const pKey = `pred_${pred.id}`;
            if (pred.paths) {
                pred.paths.forEach((_, i) => {
                    chartElements.push(
                        <Line key={`${pKey}_path_${i}`} type="monotone" dataKey={`${pKey}_path_${i}`} stroke={hexToRgba(pred.color, 0.2)} strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={true} legendType="none" />
                    );
                });
            }
        });
    }

    visiblePredictions.forEach(pred => {
        const pKey = `pred_${pred.id}`;
        chartElements.push(
            <Line key={`${pKey}_central`} type="monotone" dataKey={`${pKey}_central`} name={`${pred.model} (${pred.predLen}m)`} stroke={pred.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={true} />
        );
    });

    if (showBaselines) {
        visiblePredictions.forEach(pred => {
            const pKey = `pred_${pred.id}`;
            if (pred.baselines) {
                Object.keys(pred.baselines).forEach((bName, i) => {
                    chartElements.push(
                        <Line key={`${pKey}_baseline_${bName}`} type="monotone" dataKey={`${pKey}_baseline_${bName}`} name={`B: ${bName}`} stroke={axisColor} strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls={true} />
                    );
                });
            }
        });
    }

    // Brush for zoom — compute default only on first render
    let bStart, bEnd;
    if (brushRange) {
      // Clamp stored range to current data bounds
      bStart = Math.min(brushRange.startIndex, mergedData.length - 1);
      bEnd = Math.min(brushRange.endIndex, mergedData.length - 1);
      if (bStart < 0) bStart = 0;
      if (bEnd < bStart) bEnd = mergedData.length - 1;
    } else {
      bStart = Math.max(0, mergedData.length - 60);
      bEnd = mergedData.length - 1;
    }

    const handleBrushChange = (range) => {
      if (range && typeof range.startIndex === 'number' && typeof range.endIndex === 'number') {
        setBrushRange({ startIndex: range.startIndex, endIndex: range.endIndex });
      }
    };

    return (
        <ComposedChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}{legend}
          {dividerTime && <ReferenceLine x={dividerTime} stroke={refLineColor} strokeDasharray="4 4" />}

          {chartElements}

          <Line type="monotone" dataKey="groundTruth" name="Ground Truth" stroke={gtColor} strokeWidth={2.5}
            dot={false} isAnimationActive={false} connectNulls={true} />

          <Brush
            dataKey="time"
            height={22}
            stroke={axisColor}
            fill={brushFillColor}
            startIndex={bStart}
            endIndex={bEnd}
            travellerWidth={8}
            tickFormatter={() => ''}
            onChange={handleBrushChange}
          />
        </ComposedChart>
    );
  };

  // ── Lookback select options ──
  const lookbackOptions = [
    { value: 60, label: '1h' },
    { value: 120, label: '2h' },
    { value: 240, label: '4h' },
    { value: 400, label: '~7h' },
  ];

  return (
    <div className="glass-panel stock-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="stock-card-header">
        <div className="stock-card-left">
          <span className="ticker-badge">{ticker}</span>
          <span className={`price-display ${latestPrice ? 'price-up' : ''}`}>
            {latestPrice && !isNaN(latestPrice) ? `$${latestPrice.toFixed(2)}` : '---'}
          </span>
          <div className="live-indicator"><div className="live-dot" /> Live</div>
        </div>

        <div className="stock-card-controls">
          {/* Lookback selector — always visible, refetches GT immediately */}
          <select className="glass-input" value={cfgLookback} onChange={e => setCfgLookback(Number(e.target.value))}
            title="Historical lookback window">
            {lookbackOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {fetchingHistory && <Loader size={12} className="spin" style={{ color: 'var(--signal-pred)' }} />}

          <div className="chart-type-group" style={{ marginRight: '0.5rem' }}>
             <button className={`chart-type-btn ${showBands ? 'active' : ''}`} onClick={() => setShowBands(!showBands)}>Bands</button>
             <button className={`chart-type-btn ${showSpaghetti ? 'active' : ''}`} onClick={() => setShowSpaghetti(!showSpaghetti)}>Paths</button>
             <button className={`chart-type-btn ${showBaselines ? 'active' : ''}`} onClick={() => setShowBaselines(!showBaselines)}>Base</button>
          </div>

          <button className="chart-type-btn active" onClick={onToggleSpan}
            title={span === 1 ? 'Expand' : 'Shrink'} style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--edge)' }}>
            {span === 1 ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          </button>
          <select className="glass-input" value={cardModel} onChange={e => setCardModel(e.target.value)}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="glass-input" value={cardPredLen} onChange={e => setCardPredLen(Number(e.target.value))}>
            <option value={5}>5m</option><option value={10}>10m</option><option value={30}>30m</option><option value={60}>1h</option>
          </select>
          <button className="btn-predict" onClick={handlePredict} disabled={predicting}>
            {predicting ? <Loader size={13} className="spin" /> : <TrendingUp size={13} />}
            {predicting ? 'Running' : 'Predict'}
          </button>
          {predictions.length > 0 && <button className="btn-clear-pred" onClick={() => { setPredictions([]); setHiddenPreds(new Set()); }}><Eraser size={12} /> Clear</button>}

          <button className={`chart-type-btn ${showAdvanced ? 'active' : ''}`} onClick={() => setShowAdvanced(!showAdvanced)} title="Advanced Config"
            style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--edge)' }}>
            <Settings2 size={13} />
          </button>

          <button className="btn-icon-danger" onClick={onRemove} title="Remove"><Trash2 size={13} /></button>
        </div>
      </div>

      {showAdvanced && (
        <div className="advanced-controls" style={{
          padding: '0.6rem 0.75rem', background: 'var(--surface-1)', display: 'flex', gap: '1rem',
          borderTop: '1px solid var(--edge)', fontSize: '0.75rem', alignItems: 'center', flexWrap: 'wrap', borderRadius: '0 0 var(--r-md) var(--r-md)'
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.35rem' }}>
            <label style={{color:'var(--ink-secondary)', fontWeight:500, fontSize:'0.7rem'}}>Lookback</label>
            <input type="number" value={cfgLookback} onChange={e=>setCfgLookback(Number(e.target.value))}
              style={{width:'55px', background:'var(--surface-0)', border:'1px solid var(--edge)', color:'var(--ink-primary)', borderRadius:'4px', padding:'3px 5px', fontSize:'0.75rem'}} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.35rem' }}>
            <label style={{color:'var(--ink-secondary)', fontWeight:500, fontSize:'0.7rem'}}>Samples</label>
            <input type="number" value={cfgSamples} onChange={e=>setCfgSamples(Number(e.target.value))}
              style={{width:'45px', background:'var(--surface-0)', border:'1px solid var(--edge)', color:'var(--ink-primary)', borderRadius:'4px', padding:'3px 5px', fontSize:'0.75rem'}} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.35rem' }}>
            <label style={{color:'var(--ink-secondary)', fontWeight:500, fontSize:'0.7rem'}}>Aggregator</label>
            <select value={cfgAgg} onChange={e=>setCfgAgg(e.target.value)}
              style={{background:'var(--surface-0)', border:'1px solid var(--edge)', color:'var(--ink-primary)', borderRadius:'4px', padding:'3px 5px', fontSize:'0.75rem'}}>
              <option value="mean">Mean</option>
              <option value="median">Median</option>
              <option value="trimmed_mean">Trimmed</option>
            </select>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.35rem' }}>
            <label style={{color:'var(--ink-secondary)', fontWeight:500, fontSize:'0.7rem'}}>Temp</label>
            <input type="number" step="0.1" value={cfgTemp} onChange={e=>setCfgTemp(Number(e.target.value))}
              style={{width:'50px', background:'var(--surface-0)', border:'1px solid var(--edge)', color:'var(--ink-primary)', borderRadius:'4px', padding:'3px 5px', fontSize:'0.75rem'}} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.35rem' }}>
            <label style={{color:'var(--ink-secondary)', fontWeight:500, fontSize:'0.7rem'}}>Top p</label>
            <input type="number" step="0.1" value={cfgTopP} onChange={e=>setCfgTopP(Number(e.target.value))}
              style={{width:'50px', background:'var(--surface-0)', border:'1px solid var(--edge)', color:'var(--ink-primary)', borderRadius:'4px', padding:'3px 5px', fontSize:'0.75rem'}} />
          </div>
        </div>
      )}

      <div className="chart-wrapper" style={{ flexGrow: 1, minHeight: 0 }}
        draggable="true"
        onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
        onDoubleClick={() => setBrushRange(null)}
      >
        {loading && <div className="status-overlay"><Loader size={24} className="spin" style={{ color: 'var(--signal-live)' }} /><p>Fetching {ticker}...</p></div>}
        {error && <div className="status-overlay"><p style={{ color: 'var(--signal-danger)' }}>Error: {error}</p></div>}
        {predicting && !loading && <div className="predicting-badge"><Loader size={11} className="spin" /> Inference...</div>}
        {!loading && !error && mergedData.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">{renderChart()}</ResponsiveContainer>
        )}
      </div>

      {predictions.length > 0 && (
          <DiagnosticsPanel pred={visiblePredictions[visiblePredictions.length - 1] || predictions[predictions.length - 1]} />
      )}

      {predictions.length > 0 && (
        <div className="pred-chips-bar">
          {predictions.map(pred => {
              const isHidden = hiddenPreds.has(pred.id);
              return (
                <div key={pred.id} className="pred-chip" style={{
                  borderColor: pred.color + '44',
                  opacity: isHidden ? 0.45 : 1,
                  transition: 'opacity 0.15s ease'
                }}>
                  <span className="pred-chip-dot" style={{ background: pred.color }} />
                  <span className="pred-chip-meta" style={{ fontFamily: "'DM Mono', monospace" }}>
                    {pred.model} · {pred.predLen}m · {new Date(pred.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button
                    className="pred-chip-remove"
                    onClick={() => togglePredVisibility(pred.id)}
                    title={isHidden ? 'Show prediction' : 'Hide prediction'}
                    style={{ color: isHidden ? 'var(--signal-warn)' : 'var(--ink-tertiary)' }}
                  >
                    {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button className="pred-chip-remove" onClick={() => handleRemovePrediction(pred.id)} title="Remove">
                    <X size={12} />
                  </button>
                </div>
              );
          })}
        </div>
      )}
    </div>
  );
}
