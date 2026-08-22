# STATE (updated 2026-08-23 02:30)

SpaceATC: multi-agent orbital collision-avoidance. LangGraph negotiates maneuvers with
human-in-the-loop approval on a live WebGL globe. Plus OrbitMind, a separate vision-based
onboard reflex demo. Submitted to FARAWAY Round 2.

## Done
- Demo pair now sits in DIFFERENT orbital planes (53.05/74.0 deg), crossing head-on at 13.66 km/s, miss 0.463 km, Pc 2.82e-4, TCA +180s, deterministic every run. They shared a plane before, so both tracks drew on top of each other and read as a single line.
- Fixed `find_tca`: it refined only the smallest coarse sample, so at 60s steps and 13.7 km/s closing speed it locked onto the wrong basin and missed the real encounter (reported 3.15 km at +1.7d instead of 0.46 km at +180s). Now refines every coarse local minimum, capped by `MAX_REFINED_BASINS`.
- Post-maneuver path is real physics: SGP4 state at burn epoch, computed delta-V as an along-track impulse, propagated as a two-body DIFFERENTIAL added to the SGP4 track. Absolute two-body drifts ~16 km/30min and would swamp the ~4 km the maneuver buys. CW predicts 3.391 km, independent propagation gives 3.496 km.
- Frontend: per-satellite identity colours, glow + marching dash flow, full orbit rings, TCA marker, new `CameraDirector` (plane-bisector framing, sunlit side, frustum shift so the docked HITL panel stops covering the marker), Earth shader with local textures (day/night/clouds/atmosphere).
- README gained 3 screenshots. Corrected the Layer 2 "LLM+RAG" claim (it is a 4-entry range-indexed list). YOLO26 claim verified true from the checkpoint metadata and left as-is.
- Deployed and verified on HF: full click-through passes on the live Space, WebSockets work (1.29s connect, 2s/5s cadences), `data_source: "live"`.
- Content readiness review (FARAWAY Round 2 challenge #464): `backend/content_review.py`, a deterministic, LLM-free, network-free module that checks LLM-authored prose for completeness and consistency BEFORE it is cached or shown to an operator. See the Round 2 section below.
- Tests: `pytest test_*.py` -> 60 passed, 1 failed. The failure is `test_ws.py::test_flow`, PRE-EXISTING and unrelated: it is a bare `async def test_` and pytest-asyncio is not a dependency. Same defect class was fixed in `test_reflex.py` (sync `asyncio.run()` shims); `test_ws.py` also wants a live backend, so it was left alone.

## In progress
- Nothing mid-edit. `main` and the round2 content-review branch are merged; working tree clean.

## Round 2: Content Readiness Review
`backend/content_review.py` is deterministic, imports no LLM and touches no network (so the prose it reviews cannot prompt-inject the reviewer) and never raises. It checks the reflex narrative and the negotiation rationale for completeness (the `Verdict:` line the prompt demands, an `Executing Evasion` line iff the band is CRITICAL, a validated burn command paired with the right band) and consistency (no band-contradicting language; any axis named in prose must match the validated command). A failed review falls through to the existing deterministic fallback.

Two real defects this closed:
- `reflex_playbook.py` validated only that the LLM returned something non-empty. One malformed generation was written to `_DECISION_CACHE` and replayed on every frame in that threat band for the life of the process. The review now runs BEFORE the cache write, so the fallback is what gets cached.
- `operator_agent.py` computed the Groq negotiation rationale and then discarded it - it never reached the frontend. Revived, behind the same gate.

UI: a three-state pill on the ReflexPanel decision log (`Content Reviewed` green / `Safe Fallback` amber / `Deterministic` grey) plus an `AI RATIONALE` row on the HITLPanel. The grey state exists because a missing API key is not a rejection, and rendering it as one would repeat the defect this work exists to fix. Full writeup in `ROUND2.md`.

DEMO SCAFFOLDING: `GET /api/reflex/frame/{idx}?force_bad_narrative=true` (`backend/api/reflex.py:555`) runs a hardcoded malformed narrative through the REAL reviewer so a presenter can show the amber pill on demand. Default off; bypasses `_DECISION_CACHE` and `_FRAME_CACHE` on both read and write, so it cannot contaminate a normal request. Nothing gates it - fine for the demo, delete it or put it behind a settings flag before any real deploy.

## Next
1. Review the two drafts (paths in Gotchas): OrbitMind narration script and the submission form answer. Both written, neither approved.
2. Record the video. Reset the Space first.
3. Deliberately cut earlier, revisit only if time: HUD density (left conjunction list), catalogue-wide screening.

## Gotchas
- Backend run: do NOT use `python3 -m uvicorn` — Python 3.13/3.14 here hits a uvicorn/stdlib `logging` shadowing crash, and the bare `uvicorn` CLI resolves to a 3.11 without scipy. Use a runner script calling `uvicorn.run("backend.main:app", port=7860)`. Frontend: `cd frontend && npm run dev` (5173, proxies /api and /ws to 7860).
- Use **5173** locally. Port 7860 serves a stale `frontend/dist` unless you re-run `npm run build`.
- Env NAMES: `GROQ_API_KEY`, `VITE_HITL_TIMEOUT_S` (default 60). `VITE_*` is inlined at BUILD time — it is a Dockerfile ARG, not a runtime variable. Setting it on the host after the image is built does nothing.
- HF rejects any binary not in LFS. Add new images/textures to `.gitattributes` BEFORE `git add`, and let `git lfs push --all space` finish before `git push space main`.
- Confirm a deploy landed: `curl -sI https://rishet11-spaceatc.hf.space/textures/earth/day.jpg` must return `image/jpeg`. `text/html` means the old build is still being served.
- `rm spaceatc.db` or POST `/api/demo/reset` between takes, or stale counters show in the metrics bar.
- CelesTrak 403s on some networks; backend falls back to `backend/orbital/starlink_cache.tle` and `/health` reports which source is live.
- OrbitMind is a replay of precomputed frames, not a live camera. Labelled as such in the UI.
- Drafts live in the session scratchpad: `orbitmind-script.md` and `form-answer.md` under
  `/private/tmp/claude-501/-Users-rishetmehra--ao-data-worktrees-spaceatc-orchestrator-spaceatc-orchestrator/7092f7b6-957c-441b-9758-1cdbcd5c3ebd/scratchpad/`
  (temp dir — copy them into the repo if they matter beyond this session).
