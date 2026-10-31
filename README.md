# ORBIT-X
### Autonomous Satellite Collision Avoidance System (ASCAS)

An autonomous flight-dynamics and orbital safety engine designed to safeguard LEO satellite constellations against space debris using sub-millisecond neural surrogate modeling and multi-objective Pareto maneuver optimization.

---

## ⚡ Technical Highlights
- **Spatial Screening:** Balanced 3D SciPy cKDTree screening ($O(N \log N)$ complexity, $1.2\text{ ms}$).
- **Surrogate Inference:** ONNX Runtime Foster 2D probability-of-collision ($P_c$) solver running in **$0.38\text{ ms}$** ($R^2 = 0.978$ calibrated on 25,000 ESA Kelvins CDM-derived scenarios).
- **Maneuver Optimization:** Tsiolkovsky-based 3-tier Pareto trade-space engine balancing $\Delta v$, altitude clearance, and propellant mass depletion ($\Delta m$).
- **Autonomous Agent:** Closed-loop Guardian Agent enabling automated evasive burn execution without ground-station communication latency.
- **Flight Visualization:** 60 FPS hardware-accelerated CesiumJS HUD displaying 180 km 3D volumetric covariance shells, multi-target threat vectors, and B-plane cross-sections.

---

## 📂 Repository Layout
├── backend/
│   ├── engine.py              # Orbital mechanics, spatial screening, & Pareto solver
│   ├── server.py              # FastAPI WebSocket streaming server
│   ├── train_surrogate.py     # Surrogate training pipeline
│   ├── requirements.txt       # Backend dependencies
│   ├── risk_surrogate.onnx    # Neural risk surrogate
│   └── risk_surrogate.onnx.data
├── pages/
│   ├── index.tsx              # Mission Control HUD & CesiumJS runtime
│   └── _app.tsx
├── styles/
│   └── globals.css
├── package.json
├── tsconfig.json
└── next.config.js
---

## 🚀 Execution Instructions

### 1. Launch Backend Server
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

### 2. Launch Mission Control Interface
```bash
npm install
npm run dev
```
Open http://localhost:3000 in your browser.
