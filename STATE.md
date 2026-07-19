# STATE.md

## What it is
SpaceATC: multi-agent orbital collision-avoidance system. LangGraph negotiates satellite maneuvers with human-in-the-loop approval, rendered on a live WebGL globe. Includes OrbitMind, a separate vision-based onboard reflex demo (YOLO + pose + deterministic safety envelope).

## How to run
Backend (authoritative port per README.md and app config: 7860):
```
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env   # add GEMINI_API_KEY, GROQ_API_KEY
uvicorn main:app --reload --port 7860
```
Frontend (per CLAUDE.md and README.md: 5173):
```
cd frontend
npm install
npm run dev
```
Note: CLAUDE.md also lists a stale `port 8000` kill command; the real backend port is 7860. Kill stale processes before starting:
```
lsof -ti:7860 | xargs kill
lsof -ti:5173 | xargs kill
```

Tests: `pytest test_*.py` from repo root (offline, Python 3.11+).

## LLM narrative: now Groq
The agent negotiation narrative uses Groq, not just Gemini. Set `GROQ_API_KEY` in the gitignored `.env` file. Without it, a deterministic fallback narrative runs; the app does not crash.

## Known-good demo flow
1. Start backend (7860) and frontend (5173).
2. `curl -X POST http://localhost:7860/api/demo/inject`
3. Globe auto-zooms to the conjunction. Click APPROVE in the HITL panel to execute the maneuver.

## Known limitations
- CelesTrak often returns 403 on restricted networks. The backend falls back to a bundled cached Starlink TLE file (`backend/orbital/starlink_cache.tle`). `/health` now returns `data_source`: `"live"` or `"cache"` so this is visible, not silent.
- OrbitMind reflex demo runs on a swept-range replay of precomputed frames, not a live camera feed. This is a replay, clearly labeled as such in the UI, not a live sensor loop.
