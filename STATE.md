# STATE (updated 2026-08-23 01:50)

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
- 28 tests: `test_demo_geometry.py`, `test_two_body.py`. Diff review passed.

## In progress
- Nothing mid-edit. Both remotes at `d590610`, working tree clean.

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
