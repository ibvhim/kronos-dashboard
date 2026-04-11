<div align="center">

# 📈 Kronos Live Dashboard

**Real-time financial forecasting powered by the Kronos foundation model**

A full-stack application that combines live market data with AI-generated price predictions, visualized through an interactive, multi-ticker dashboard.

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## What is This?

This project wraps the [Kronos](https://github.com/shiyu-coder/Kronos) foundation model — an AAAI 2026 paper that treats financial candlesticks as a "language" — into a live dashboard where you can:

- **Search & track** any stock or crypto ticker in real-time (data from Yahoo Finance)
- **Run AI predictions** on any ticker using different Kronos model sizes
- **Overlay multiple forecasts** on the same chart and compare them
- **Drag & reorder** cards, switch chart types (line / area / bar), and toggle dark mode

<br>

## Architecture

```
┌──────────────────────┐       ┌───────────────────────┐       ┌────────────────────┐
│   React Frontend     │       │   FastAPI Backend      │       │   External APIs     │
│   (Vite + Recharts)  │◄─────►│   (Python)             │◄─────►│                    │
│                      │ HTTP  │                       │       │  Yahoo Finance     │
│  • Ticker search     │       │  • /api/models        │       │  (live OHLCV data) │
│  • Live price charts │       │  • /api/tickers       │       │                    │
│  • Prediction overlay│       │  • /api/load_model    │       │  HuggingFace Hub   │
│  • Dark/Light theme  │       │  • /api/predict       │       │  (model weights)   │
│  • Drag reorder      │       │  • /api/poll          │       │                    │
└──────────────────────┘       └───────────────────────┘       └────────────────────┘
                                        │
                                        ▼
                               ┌────────────────────┐
                               │   Kronos Model      │
                               │   (PyTorch)          │
                               │                     │
                               │  Tokenizer ─► BSQ   │
                               │  Transformer ─► AR  │
                               │  Decode ─► OHLCV    │
                               └────────────────────┘
```

<br>

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.10 or higher |
| Node.js | 18 or higher |
| Git | Any recent version |
| GPU (optional) | CUDA-compatible for faster inference |

<br>

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/ibvhim/kronos-dashboard.git
cd kronos-dashboard
```

### 2. Clone the Kronos Model Library

The dashboard depends on the Kronos model library. Clone it into the project root (sibling to `kronos_live_dashboard/`):

```bash
git clone https://github.com/shiyu-coder/Kronos.git
```

Your directory should now look like:

```
kronos-dashboard/
├── Kronos/                    # The AI model library
├── kronos_live_dashboard/     # This dashboard application
│   ├── api/                   # Python backend
│   └── web/                   # React frontend
└── README.md
```

### 3. Set Up the Backend

```bash
cd kronos_live_dashboard

# Create and activate a virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
# source .venv/bin/activate

# Install Python dependencies
pip install fastapi uvicorn yfinance pandas numpy
pip install torch --index-url https://download.pytorch.org/whl/cpu   # CPU-only
# pip install torch                                                   # Or with CUDA

# Install Kronos dependencies
pip install einops huggingface_hub safetensors tqdm

# Start the API server
cd api
python main.py
```

The backend will start at **http://localhost:8000**.

> **Note:** The first time you load a model, it will download weights from HuggingFace (~100MB-400MB depending on model size). Subsequent runs use the cached weights.

### 4. Set Up the Frontend

Open a **new terminal**:

```bash
cd kronos_live_dashboard/web

# Install Node dependencies
npm install

# Start the development server
npm run dev
```

The frontend will start at **http://localhost:5173**.

### 5. Configure the API URL

The frontend connects to the API at `http://localhost:8001/api` by default. If your backend is running on a different port, update line 11 in `web/src/App.jsx`:

```javascript
const API_URL = 'http://localhost:8000/api';  // ← match your backend port
```

<br>

## Usage

1. **Open the dashboard** at `http://localhost:5173`
2. **Search for a ticker** using the search bar (e.g., `AAPL`, `BTC-USD`, `TSLA`)
3. **Select a ticker** from the dropdown — a card appears with live price data
4. **Choose a model** from the card's dropdown (`kronos-mini`, `kronos-small`, `kronos-base`)
5. **Set the prediction horizon** (5m, 10m, 30m, or 1h)
6. **Click "Predict"** — the model runs inference and overlays a forecast line on the chart
7. **Add more predictions** — each one gets a unique color; a mean line appears when ≥2 exist
8. **Drag cards** to reorder, **expand/shrink** with the resize button, or **switch chart types**

<br>

## Available Models

| Model | Parameters | Context Length | Speed | Best For |
|-------|-----------|----------------|-------|----------|
| `kronos-mini` | 4.1M | 2048 tokens | ⚡ Fastest | Quick exploration |
| `kronos-small` | 24.7M | 512 tokens | 🔄 Moderate | Balanced accuracy/speed |
| `kronos-base` | 102.3M | 512 tokens | 🐢 Slowest | Best accuracy |

<br>

## Project Structure

```
kronos_live_dashboard/
├── api/
│   └── main.py              # FastAPI server — endpoints, data fetching, model inference
│
└── web/
    ├── index.html            # HTML entry point
    ├── package.json          # Dependencies (React 19, Recharts, Axios, Lucide)
    ├── vite.config.js        # Vite configuration
    └── src/
        ├── main.jsx          # React app entry
        ├── App.jsx           # All components (App, StockCard, TickerSearch, Tooltip)
        ├── App.css           # Component styles
        └── index.css         # Design system (glassmorphic, dark/light themes)
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/models` | List available Kronos models |
| `GET` | `/api/tickers` | Get curated stock & crypto ticker catalog |
| `POST` | `/api/load_model` | Load a Kronos model into memory |
| `POST` | `/api/predict` | Fetch data + run AI prediction for ticker(s) |
| `GET` | `/api/poll?ticker=X` | Get the latest 1-minute price bar |

<br>

## Tech Stack

**Backend**
- [FastAPI](https://fastapi.tiangolo.com) — async REST API
- [yfinance](https://github.com/ranaroussi/yfinance) — live market data from Yahoo Finance
- [PyTorch](https://pytorch.org) — model inference
- [Kronos](https://github.com/shiyu-coder/Kronos) — financial foundation model (AAAI 2026)

**Frontend**
- [React 19](https://react.dev) — UI framework
- [Vite 8](https://vite.dev) — build tooling
- [Recharts 3](https://recharts.org) — charting (Line, Area, Bar)
- [Lucide React](https://lucide.dev) — icons
- [Axios](https://axios-http.com) — HTTP client

<br>

## Disclaimer

> This project is for **educational and research purposes only**. It is not financial advice. The predictions generated by Kronos are probabilistic forecasts from an AI model and should not be used as the sole basis for trading decisions.

<br>

## Acknowledgments

- **[Kronos](https://github.com/shiyu-coder/Kronos)** by Shi et al. — the foundation model powering the predictions
- **[Yahoo Finance](https://finance.yahoo.com)** via yfinance — live market data

<br>

## License

This project is licensed under the [MIT License](LICENSE).
