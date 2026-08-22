# CLAUDE.md — Faraway

Satellite/orbital-mechanics collision-avoidance hackathon app. Vite/React frontend (Node) + Python backend.

Run: Frontend `cd frontend && npm run dev` (port 5173, proxies /api and /ws to the backend).
Backend on port **7860**. Do NOT use `python3 -m uvicorn` — on Python 3.13/3.14 it hits a
uvicorn/stdlib `logging` shadowing crash, and the bare `uvicorn` CLI may resolve to an
interpreter without scipy. Use a runner script calling
`uvicorn.run("backend.main:app", port=7860)` from the repo root.
Kill stale: `lsof -ti:5173 | xargs kill` and `lsof -ti:7860 | xargs kill`.

Open **5173** during development. Port 7860 also serves a UI, but from a prebuilt
`frontend/dist` that is only refreshed by `npm run build`.

Env vars: `GROQ_API_KEY`, `CELESTRAK_BASE_URL`, `SPACE_TRACK_USERNAME`, `SPACE_TRACK_PASSWORD`, `SQLITE_PATH`, `WEBSOCKET_PING_INTERVAL`, `TLE_REFRESH_INTERVAL`, `SCREENING_DISTANCE_KM`, `PC_ALERT_THRESHOLD`, `PC_SAFE_THRESHOLD`, `VITE_HITL_TIMEOUT_S`

`VITE_*` vars are inlined at build time. `VITE_HITL_TIMEOUT_S` is a Dockerfile ARG, not a
runtime variable — setting it on the host after the image is built has no effect.

Test: `pytest test_*.py` (runs offline; Python 3.11+)

If STATE.md exists in this root, read it first for current status.
