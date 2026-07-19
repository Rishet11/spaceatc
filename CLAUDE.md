# CLAUDE.md — Faraway

Satellite/orbital-mechanics collision-avoidance hackathon app. Vite/React frontend (Node) + Python backend.

Run: Frontend: `npm run dev` (port 5173); Backend: `python3 -m server` or check backend main (kill stale with `lsof -ti:5173 | xargs kill` and `lsof -ti:8000 | xargs kill`)

Env vars: `GROQ_API_KEY`, `CELESTRAK_BASE_URL`, `SPACE_TRACK_USERNAME`, `SPACE_TRACK_PASSWORD`, `SQLITE_PATH`, `WEBSOCKET_PING_INTERVAL`, `TLE_REFRESH_INTERVAL`, `SCREENING_DISTANCE_KM`, `PC_ALERT_THRESHOLD`, `PC_SAFE_THRESHOLD`

Test: `pytest test_*.py` (runs offline; Python 3.11+)

If STATE.md exists in this root, read it first for current status.
