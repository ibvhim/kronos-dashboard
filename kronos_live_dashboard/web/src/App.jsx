import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { Target, Activity, Moon, Sun, BarChart2, X, ChevronRight } from 'lucide-react';
import './index.css';
import StockCard from './StockCard';

const API_URL = 'http://localhost:8001/api';

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

// Removed redundant components that are now inside StockCard

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

// StockCard completely moved to separate file

/* ─── App Shell ───────────────────────────────────────── */
export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [models, setModels] = useState([]);
  const [activeTickers, setActiveTickers] = useState([]);
  const [cardSpans, setCardSpans] = useState({});
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [tickerData, setTickerData] = useState(null);

  // Phase 4: Leaderboard & Run Drawer
  const [showDrawer, setShowDrawer] = useState(false);
  const [leaderboard, setLeaderboard] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/models`).then(res => setModels(res.data.models)).catch(err => console.error('Failed to fetch models', err));
    axios.get(`${API_URL}/tickers`).then(res => setTickerData(res.data)).catch(err => console.error('Failed to fetch tickers', err));
  }, []);

  useEffect(() => {
    // Poll the backend to score any pending forecasts automatically as time moves forward
    const scoreInterval = setInterval(() => {
      axios.post(`${API_URL}/score_pending`).catch(() => {});
    }, 60000);
    return () => clearInterval(scoreInterval);
  }, []);

  const openDrawer = async () => {
    setShowDrawer(true);
    setLeaderboard(null); // Optional: clear to show loading spin if we want a fresh state
    try {
      // Force an immediate score before fetching the leaderboard
      await axios.post(`${API_URL}/score_pending`);
      const res = await axios.get(`${API_URL}/leaderboard`);
      setLeaderboard(res.data.leaderboard);
    } catch(e) {
      console.error(e);
      // Fallback in case scoring throws an internal error, try to fetch leaderboard anyway
      try {
        const res = await axios.get(`${API_URL}/leaderboard`);
        setLeaderboard(res.data.leaderboard);
      } catch(e2) {
        setLeaderboard({});
      }
    }
  };

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

          <button className="theme-toggle" onClick={openDrawer} title="Leaderboard & Runs">
            <BarChart2 size={16} />
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

      {/* Leaderboard Drawer Overlay */}
      {showDrawer && (
        <div className="drawer-overlay" onClick={() => setShowDrawer(false)} style={{
            position:'fixed', top:0, left:0, width:'100vw', height:'100vh', background:'rgba(0,0,0,0.55)', zIndex: 999, backdropFilter:'blur(4px)'
        }}>
          <div className="drawer-panel" onClick={e => e.stopPropagation()} style={{
              position:'absolute', right:0, top:0, width:'440px', height:'100%',
              background:'var(--surface-0)',
              borderLeft:'1px solid var(--edge-emphasis)', boxShadow:'-10px 0 40px rgba(0,0,0,0.25)', padding:'1.5rem',
              overflowY:'auto', display:'flex', flexDirection:'column', gap:'1rem'
          }}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--edge)', paddingBottom:'0.75rem'}}>
              <h2 style={{margin:0, fontSize:'1.1rem', fontWeight:700, display:'flex', alignItems:'center', gap:'0.5rem', color:'var(--ink-primary)'}}>
                <BarChart2 size={18} color="var(--signal-live)" /> Model Leaderboard
              </h2>
              <button onClick={() => setShowDrawer(false)} style={{background:'var(--surface-2)', border:'1px solid var(--edge)', borderRadius:'6px', width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--ink-secondary)'}}><X size={16}/></button>
            </div>
            
            {!leaderboard ? <Activity className="spin" size={24} style={{alignSelf:'center', marginTop:'2rem', color:'var(--ink-tertiary)'}} /> : 
             Object.keys(leaderboard).length === 0 ? (
              <div style={{padding:'2rem 1rem', textAlign:'center'}}>
                <p style={{color:'var(--ink-secondary)', fontSize:'0.85rem', lineHeight:'1.5'}}>No tracked forecasts scored yet.<br/>Predict, wait for the ground-truth candle, then open this drawer again.</p>
              </div>
             ) :
             Object.entries(leaderboard).map(([mName, data]) => (
                <div key={mName} style={{background:'var(--surface-1)', border:'1px solid var(--edge)', borderRadius:'10px', padding:'1rem'}}>
                    <h3 style={{margin:'0 0 0.75rem 0', fontSize:'0.95rem', fontWeight:700, color:'var(--ink-primary)', fontFamily:"'DM Mono', monospace"}}>{mName}</h3>
                    <div style={{display:'flex', gap:'1.25rem', fontSize:'0.82rem', color:'var(--ink-primary)'}}>
                       <div><span style={{color:'var(--ink-secondary)', fontWeight:500}}>MAE: </span><strong>{data.overall?.mae?.toFixed(4) || '--'}</strong></div>
                       <div><span style={{color:'var(--ink-secondary)', fontWeight:500}}>RMSE: </span><strong>{data.overall?.rmse?.toFixed(4) || '--'}</strong></div>
                       <div><span style={{color:'var(--ink-secondary)', fontWeight:500}}>Runs: </span><strong>{data.overall?.count || 0}</strong></div>
                    </div>
                    {data.regimes && Object.keys(data.regimes).length > 0 && (
                        <div style={{marginTop:'0.75rem', fontSize:'0.75rem', borderTop:'1px solid var(--edge-soft)', paddingTop:'0.5rem'}}>
                            <div style={{color:'var(--ink-secondary)', fontWeight:600, marginBottom:'0.4rem', textTransform:'uppercase', letterSpacing:'0.05em', fontSize:'0.65rem'}}>Regime Breakdowns</div>
                            {Object.entries(data.regimes).map(([rType, rVals]) => (
                                <div key={rType} style={{marginTop:'0.35rem', display:'flex', flexWrap:'wrap', gap:'0.35rem', alignItems:'center'}}>
                                    <span style={{color:'var(--ink-secondary)', textTransform:'capitalize', fontWeight:600, minWidth:'65px'}}>{rType}:</span>
                                    {Object.entries(rVals).map(([val, vStats]) => (
                                        <span key={val} style={{background:'var(--surface-2)', border:'1px solid var(--edge)', padding:'2px 8px', borderRadius:'4px', color:'var(--ink-primary)', fontFamily:"'DM Mono', monospace", fontSize:'0.72rem'}}>
                                            {val} <span style={{color:'var(--ink-secondary)'}}>({vStats.mae?.toFixed(2)})</span>
                                        </span>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
             ))
            }
          </div>
        </div>
      )}

    </div>
  );
}
