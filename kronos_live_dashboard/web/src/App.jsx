import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ReferenceLine
} from 'recharts';
import { Target, Activity, Plus, Trash2, Loader, TrendingUp, Eraser, X, Maximize2, Minimize2, Sun, Moon, Search } from 'lucide-react';
import './index.css';

const API_URL = 'http://localhost:8001/api';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PRED_COLORS = [
  '#d97706', '#db2777', '#7c3aed', '#059669',
  '#ea580c', '#0284c7', '#c026d3', '#ca8a04',
];

// Dark-mode-friendly prediction colors
const PRED_COLORS_DARK = [
  '#fbbf24', '#f472b6', '#a78bfa', '#34d399',
  '#fb923c', '#38bdf8', '#e879f9', '#facc15',
];

let predIdCounter = 0;

/* ─── useTheme hook ───────────────────────────────────── */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('kronos-theme') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kronos-theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  return { theme, toggle };
}

/* ─── Error Boundary ──────────────────────────────────── */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '1.5rem', color: 'var(--signal-danger)', background: 'rgba(208,48,48,0.06)', borderRadius: '10px' }}>
          <h3>Render Error</h3>
          <pre style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>{this.state.error?.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── Custom Tooltip ──────────────────────────────────── */
const KronosTooltip = ({ active, payload, predictions, theme }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const dateObj = new Date(point.fullTime);
  const dayName = DAYS[dateObj.getDay()];
  const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const gtColor = theme === 'dark' ? '#6ba3d6' : '#2563b4';
  const meanColor = theme === 'dark' ? '#e4ddd4' : '#1a1714';
  const upColor = theme === 'dark' ? '#5ec9a2' : '#1a9a6a';
  const downColor = theme === 'dark' ? '#e06060' : '#d03030';

  const predEntries = (predictions || []).map(p => ({ ...p, value: point[`pred_${p.id}`] }));
  const meanVal = point.mean;

  return (
    <div className="custom-tooltip">
      <div className="tooltip-header">
        <span className="day">{dayName}</span> · {dateStr} · {timeStr}
      </div>
      <div className="tooltip-row">
        <span className="label"><span className="dot" style={{ background: gtColor }} />Ground Truth</span>
        {point.groundTruth != null ? <span className="value gt">${Number(point.groundTruth).toFixed(2)}</span> : <span className="no-data">—</span>}
      </div>
      {predEntries.map(pe => (
        <div className="tooltip-row" key={pe.id}>
          <span className="label">
            <span className="dot" style={{ background: pe.color }} />
            P{pe.id} <span style={{ color: 'var(--ink-muted)', fontSize: '0.72rem' }}>({pe.model} · {pe.predLen}m)</span>
          </span>
          {pe.value != null ? <span className="value" style={{ color: pe.color }}>${Number(pe.value).toFixed(2)}</span> : <span className="no-data">—</span>}
        </div>
      ))}
      {predictions && predictions.length >= 2 && (
        <div className="tooltip-row" style={{ borderTop: '1px solid var(--edge)', marginTop: '0.25rem', paddingTop: '0.3rem' }}>
          <span className="label"><span className="dot" style={{ background: meanColor }} />Mean</span>
          {meanVal != null ? <span className="value" style={{ color: meanColor }}>${Number(meanVal).toFixed(2)}</span> : <span className="no-data">—</span>}
        </div>
      )}
      {point.groundTruth != null && meanVal != null && (
        <div className="tooltip-row" style={{ marginTop: '0.15rem' }}>
          <span className="label" style={{ fontSize: '0.75rem' }}>Δ Mean vs GT</span>
          <span className="value" style={{ color: (meanVal - point.groundTruth) >= 0 ? upColor : downColor, fontSize: '0.75rem' }}>
            {(meanVal - point.groundTruth) >= 0 ? '+' : ''}${(meanVal - point.groundTruth).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
};

/* ─── Prediction Chip ─────────────────────────────────── */
const PredictionChip = ({ pred, onRemove }) => (
  <div className="pred-chip" style={{ borderColor: pred.color + '44' }}>
    <span className="pred-chip-dot" style={{ background: pred.color }} />
    <span className="pred-chip-label">P{pred.id}</span>
    <span className="pred-chip-meta">
      {pred.model} · {pred.predLen}m · {new Date(pred.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
    <button className="pred-chip-remove" onClick={() => onRemove(pred.id)} title="Remove"><X size={12} /></button>
  </div>
);

/* ─── Ticker Search Dropdown ──────────────────────────── */
const TickerSearch = ({ tickerData, onSelect, activeTickers }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const q = query.toUpperCase().trim();

  // Flatten and filter
  const filteredSections = useMemo(() => {
    if (!tickerData) return [];
    const sections = [];

    // Crypto
    if (tickerData.crypto) {
      const items = tickerData.crypto.filter(t =>
        !activeTickers.includes(t.symbol) &&
        (t.symbol.toUpperCase().includes(q) || t.name.toUpperCase().includes(q))
      );
      if (items.length > 0) sections.push({ label: 'Crypto', items });
    }

    // Stocks by sector
    if (tickerData.stocks) {
      Object.entries(tickerData.stocks).forEach(([sector, tickers]) => {
        const items = tickers.filter(t =>
          !activeTickers.includes(t.symbol) &&
          (t.symbol.toUpperCase().includes(q) || t.name.toUpperCase().includes(q))
        );
        if (items.length > 0) sections.push({ label: sector, items });
      });
    }

    return sections;
  }, [tickerData, q, activeTickers]);

  const handleSelect = (symbol) => {
    onSelect(symbol);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const t = query.toUpperCase().trim();
      if (t) { onSelect(t); setQuery(''); setOpen(false); }
    }
  };

  return (
    <div className="ticker-search-wrapper" ref={wrapperRef}>
      <input
        type="text"
        className="glass-input"
        placeholder="Search tickers..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {open && (
        <div className="ticker-dropdown">
          {filteredSections.length === 0 ? (
            <div className="ticker-dropdown-empty">
              {q ? `No match for "${q}" — press Enter to add custom` : 'Type to search or browse below'}
            </div>
          ) : (
            filteredSections.map(section => (
              <div key={section.label} className="ticker-dropdown-section">
                <div className="ticker-dropdown-section-label">{section.label}</div>
                {section.items.map(t => (
                  <div key={t.symbol} className="ticker-dropdown-item" onClick={() => handleSelect(t.symbol)}>
                    <span className="ticker-symbol">{t.symbol}</span>
                    <span className="ticker-name">{t.name}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Stock Chart Card ────────────────────────────────── */
const StockCard = ({ ticker, models, onRemove, span, onToggleSpan, theme }) => {
  const [gtData, setGtData] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [latestPrice, setLatestPrice] = useState(null);
  const [chartType, setChartType] = useState('line');
  const [cardModel, setCardModel] = useState(models[0] || '');
  const [cardPredLen, setCardPredLen] = useState(10);
  const [predicting, setPredicting] = useState(false);
  const pollRef = useRef(null);

  const predColors = theme === 'dark' ? PRED_COLORS_DARK : PRED_COLORS;
  const gtColor = theme === 'dark' ? '#6ba3d6' : '#2563b4';
  const meanColor = theme === 'dark' ? '#e4ddd4' : '#1a1714';
  const axisColor = theme === 'dark' ? '#6b6055' : '#8a837b';
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
  const refLineColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true); setError(null);
        if (!cardModel) { setError('No model available'); setLoading(false); return; }
        await axios.post(`${API_URL}/load_model`, { model_name: cardModel });
        const res = await axios.post(`${API_URL}/predict`, { model_name: cardModel, tickers: [ticker], lookback: 120, pred_len: 1 });
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
    fetchHistory();
    return () => clearInterval(pollRef.current);
  }, [ticker]);

  useEffect(() => { if (!cardModel && models.length > 0) setCardModel(models[0]); }, [models]);

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
      await axios.post(`${API_URL}/load_model`, { model_name: cardModel });
      const res = await axios.post(`${API_URL}/predict`, { model_name: cardModel, tickers: [ticker], lookback: 120, pred_len: cardPredLen });
      const tickRes = res.data.results[ticker];
      if (tickRes?.error) { setPredicting(false); return; }
      const historical = tickRes.historical || [];
      const predPoints = tickRes.prediction || [];
      const anchor = historical.length > 0
        ? { time: new Date(historical[historical.length - 1].timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            fullTime: historical[historical.length - 1].timestamps, close: Number(historical[historical.length - 1].close) }
        : null;
      const predData = [];
      if (anchor) predData.push({ time: anchor.time, fullTime: anchor.fullTime, close: anchor.close });
      predPoints.forEach(p => { predData.push({ time: new Date(p.timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), fullTime: p.timestamps, close: Number(p.close) }); });
      const newPred = {
        id: ++predIdCounter, model: cardModel, predLen: cardPredLen,
        color: predColors[(predIdCounter - 1) % predColors.length],
        createdAt: new Date().toISOString(), data: predData,
      };
      setPredictions(prev => [...prev, newPred]);
      if (historical.length > 0) {
        setGtData(historical.map(h => ({ time: new Date(h.timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), fullTime: h.timestamps, groundTruth: Number(h.close) })));
        setLatestPrice(Number(historical[historical.length - 1].close));
      }
      setPredicting(false);
    } catch (e) { console.error('Prediction failed', e); setPredicting(false); }
  };

  const handleRemovePrediction = (id) => setPredictions(prev => prev.filter(p => p.id !== id));
  const handleClearAll = () => setPredictions([]);

  const mergedData = useMemo(() => {
    const timeMap = new Map();
    gtData.forEach(pt => { timeMap.set(pt.time, { time: pt.time, fullTime: pt.fullTime, groundTruth: pt.groundTruth }); });
    predictions.forEach(pred => {
      const key = `pred_${pred.id}`;
      pred.data.forEach(pt => {
        if (!timeMap.has(pt.time)) timeMap.set(pt.time, { time: pt.time, fullTime: pt.fullTime, groundTruth: null });
        timeMap.get(pt.time)[key] = pt.close;
      });
    });
    const predKeys = predictions.map(p => `pred_${p.id}`);
    const entries = Array.from(timeMap.values());
    if (predKeys.length >= 2) {
      entries.forEach(entry => {
        const vals = predKeys.map(k => entry[k]).filter(v => v != null);
        if (vals.length >= 2) entry.mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      });
    }
    entries.sort((a, b) => new Date(a.fullTime) - new Date(b.fullTime));
    return entries;
  }, [gtData, predictions]);

  const renderChart = () => {
    const commonProps = { data: mergedData, margin: { top: 5, right: 10, left: -15, bottom: 5 } };
    const xAxis = <XAxis dataKey="time" stroke={axisColor} fontSize={11} tickMargin={8} minTickGap={25} />;
    const yAxis = <YAxis stroke={axisColor} domain={['auto', 'auto']} fontSize={11} tickFormatter={v => { const n = Number(v); return isNaN(n) ? '' : `$${n.toFixed(0)}`; }} />;
    const grid = <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />;
    const tooltip = <Tooltip content={<KronosTooltip predictions={predictions} theme={theme} />} />;
    const legend = <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: '0.65rem' }} />;

    const lastGtIdx = mergedData.reduce((acc, d, i) => d.groundTruth != null ? i : acc, -1);
    const dividerTime = lastGtIdx >= 0 ? mergedData[lastGtIdx].time : null;

    const predLines = predictions.map(pred => (
      <Line key={`pred_${pred.id}`} type="monotone" dataKey={`pred_${pred.id}`}
        name={`P${pred.id} (${pred.model})`} stroke={pred.color} strokeWidth={1.5}
        strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={true} />
    ));
    const meanLine = predictions.length >= 2 ? (
      <Line key="mean" type="monotone" dataKey="mean" name="Mean"
        stroke={meanColor} strokeWidth={2.5} strokeDasharray="2 3"
        dot={false} isAnimationActive={false} connectNulls={true} />
    ) : null;

    if (chartType === 'area') {
      return (
        <AreaChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}{legend}
          {dividerTime && <ReferenceLine x={dividerTime} stroke={refLineColor} strokeDasharray="4 4" />}
          <defs>
            <linearGradient id={`gt-grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={gtColor} stopOpacity={0.15} />
              <stop offset="95%" stopColor={gtColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="groundTruth" name="Ground Truth" stroke={gtColor} strokeWidth={2}
            fill={`url(#gt-grad-${ticker})`} dot={false} isAnimationActive={false} connectNulls={true} />
          {predLines}{meanLine}
        </AreaChart>
      );
    }

    if (chartType === 'bar') {
      return (
        <BarChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}{legend}
          {dividerTime && <ReferenceLine x={dividerTime} stroke={refLineColor} strokeDasharray="4 4" />}
          <Bar dataKey="groundTruth" name="Ground Truth" fill={gtColor} opacity={0.7} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          {predictions.map(pred => (
            <Bar key={`pred_${pred.id}`} dataKey={`pred_${pred.id}`} name={`P${pred.id}`}
              fill={pred.color} opacity={0.5} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      );
    }

    return (
      <LineChart {...commonProps}>
        {grid}{xAxis}{yAxis}{tooltip}{legend}
        {dividerTime && <ReferenceLine x={dividerTime} stroke={refLineColor} strokeDasharray="4 4" />}
        <Line type="monotone" dataKey="groundTruth" name="Ground Truth" stroke={gtColor} strokeWidth={2}
          dot={false} isAnimationActive={false} connectNulls={true} />
        {predLines}{meanLine}
      </LineChart>
    );
  };

  return (
    <div className="glass-panel stock-card">
      <div className="stock-card-header">
        <div className="stock-card-left">
          <span className="ticker-badge">{ticker}</span>
          <span className={`price-display ${latestPrice ? 'price-up' : ''}`}>
            {latestPrice && !isNaN(latestPrice) ? `$${latestPrice.toFixed(2)}` : '---'}
          </span>
          <div className="live-indicator"><div className="live-dot" /> Live</div>
          {predictions.length > 0 && <span className="pred-count-badge">{predictions.length} pred{predictions.length > 1 ? 's' : ''}</span>}
        </div>

        <div className="stock-card-controls">
          <div className="chart-type-group">
            {['line', 'area', 'bar'].map(t => (
              <button key={t} className={`chart-type-btn ${chartType === t ? 'active' : ''}`} onClick={() => setChartType(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
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
          {predictions.length > 0 && <button className="btn-clear-pred" onClick={handleClearAll}><Eraser size={12} /> Clear</button>}
          <button className="btn-icon-danger" onClick={onRemove} title="Remove"><Trash2 size={13} /></button>
        </div>
      </div>

      <div className="chart-wrapper">
        {loading && <div className="status-overlay"><Loader size={24} className="spin" style={{ color: 'var(--signal-live)' }} /><p>Fetching {ticker}...</p></div>}
        {error && <div className="status-overlay"><p style={{ color: 'var(--signal-danger)' }}>Error: {error}</p></div>}
        {predicting && !loading && <div className="predicting-badge"><Loader size={11} className="spin" /> Inference...</div>}
        {!loading && !error && mergedData.length > 0 && (
          <ErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">{renderChart()}</ResponsiveContainer>
          </ErrorBoundary>
        )}
      </div>

      {predictions.length > 0 && (
        <div className="pred-chips-bar">
          {predictions.map(pred => <PredictionChip key={pred.id} pred={pred} onRemove={handleRemovePrediction} />)}
        </div>
      )}
    </div>
  );
};

/* ─── App Shell ───────────────────────────────────────── */
export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [models, setModels] = useState([]);
  const [activeTickers, setActiveTickers] = useState([]);
  const [cardSpans, setCardSpans] = useState({});
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [tickerData, setTickerData] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/models`).then(res => setModels(res.data.models)).catch(err => console.error('Failed to fetch models', err));
    axios.get(`${API_URL}/tickers`).then(res => setTickerData(res.data)).catch(err => console.error('Failed to fetch tickers', err));
  }, []);

  const handleAddTicker = (t) => {
    const sym = t.toUpperCase().trim();
    if (sym && !activeTickers.includes(sym)) {
      setActiveTickers(prev => [...prev, sym]);
      setCardSpans(prev => ({ ...prev, [sym]: 1 }));
    }
  };

  const handleRemoveTicker = (t) => {
    setActiveTickers(prev => prev.filter(x => x !== t));
    setCardSpans(prev => { const n = { ...prev }; delete n[t]; return n; });
  };

  const toggleSpan = (t) => setCardSpans(prev => ({ ...prev, [t]: prev[t] === 2 ? 1 : 2 }));

  /* ── Drag-and-drop reorder ─────────────────────────── */
  const handleDragStart = (idx) => (e) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  };
  const handleDragOver = (idx) => (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (idx !== dragIdx) setOverIdx(idx); };
  const handleDragLeave = () => setOverIdx(null);
  const handleDrop = (idx) => (e) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    setActiveTickers(prev => { const arr = [...prev]; const temp = arr[dragIdx]; arr[dragIdx] = arr[idx]; arr[idx] = temp; return arr; });
    setDragIdx(null); setOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setOverIdx(null); };

  return (
    <div className="dashboard-container">
      <header>
        <div className="header-title">
          <Target size={18} color="var(--signal-live)" />
          <h1>Kronos Live Vanguard</h1>
        </div>

        <div className="header-right">
          <TickerSearch tickerData={tickerData} onSelect={handleAddTicker} activeTickers={activeTickers} />

          <button className="btn-primary" onClick={() => {}} style={{ visibility: 'hidden', width: 0, padding: 0, overflow: 'hidden' }}>
            {/* Hidden spacer — search has its own enter-to-add */}
          </button>

          <button className="theme-toggle" onClick={toggleTheme} title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <div className="live-indicator">
            <div className="live-dot" />
            Connected
          </div>
        </div>
      </header>

      {activeTickers.length === 0 ? (
        <div className="glass-panel empty-state">
          <Activity size={36} style={{ opacity: 0.08, margin: '0 auto 0.75rem auto' }} />
          <h2>Awaiting Telemetry</h2>
          <p>Search for a ticker above to begin live tracking.</p>
        </div>
      ) : (
        <div className="stocks-grid">
          {activeTickers.map((ticker, idx) => (
            <div key={ticker}
              className={`grid-cell${dragIdx === idx ? ' dragging' : ''}${overIdx === idx ? ' drag-over' : ''}`}
              style={{ gridColumn: `span ${cardSpans[ticker] || 1}` }}
              draggable onDragStart={handleDragStart(idx)} onDragOver={handleDragOver(idx)}
              onDragLeave={handleDragLeave} onDrop={handleDrop(idx)} onDragEnd={handleDragEnd}>
              <StockCard ticker={ticker} models={models} span={cardSpans[ticker] || 1}
                onToggleSpan={() => toggleSpan(ticker)} onRemove={() => handleRemoveTicker(ticker)} theme={theme} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
