# SpaceATC — Engineering Handoff

**Written:** 22 Aug 2026 · **Baseline commit:** `15f35d9` ("refinement")
**Read first:** [`SUMMARY.md`](./SUMMARY.md) → [`AUDIT.md`](./AUDIT.md) → this file.

---

## 1. State of the tree

All prior work is **already committed at HEAD** — 18 fixes, plus `test_orbital.py` and
`AUDIT.md`. `git status` is clean. There are no uncommitted changes to preserve.

> Note for whoever picks this up: the audit work was performed with an explicit
> "no commits, no pushes" constraint. The repository was subsequently re-cloned and
> re-committed by the environment, which is how these changes ended up inside
> `15f35d9`. If you need to review them in isolation, diff against the upstream
> remote rather than against `HEAD~1`.

---

## 2. Environment — read this before running anything

This machine does **not** have `npm` or `pip` on PATH. Use these instead:

| Need | Use | Not |
|---|---|---|
| Frontend deps | `bun install` (in `frontend/`) | ~~npm install~~ |
| Python deps | `uv pip install --python .venv-audit/bin/python ...` | ~~pip install~~ |
| Run a JS binary | `./node_modules/.bin/<tool>` | ~~npx~~ |

A working virtualenv already exists at **`.venv-audit/`** with all backend deps
including `opencv-python-headless`. `frontend/node_modules/` is populated (127 pkgs).
Both survived the re-clone — verify before rebuilding:

```bash
./.venv-audit/bin/python -c "import sgp4, fastapi; print('deps OK')"
ls frontend/node_modules | wc -l
```

### Gotchas that cost time

- **`backend/main.py` imports the reflex router unguarded**, and `backend/api/reflex.py`
  imports `cv2` at module level. Without OpenCV installed, the *entire* backend fails to
  boot — including the globe demo, which has nothing to do with vision.
- **`pytest test_*.py` fails out of the box.** The repo ships no pytest config for
  asyncio mode. You must pass `--asyncio-mode=auto` or `test_ws.py::test_flow` errors.
- **Never use bare `lsof -ti:PORT | xargs kill`.** That returns connected *clients* as
  well as the listener — it will target browser processes. Always add `-sTCP:LISTEN`.

---

## 3. Running it

```bash
# Backend (port 7860, stays on localhost)
./.venv-audit/bin/python -m uvicorn backend.main:app --port 7860

# Frontend (port 5173)
cd frontend && ./node_modules/.bin/vite --port 5173
```

Open **http://localhost:5173/dashboard**.

**For LAN access** (so teammates can view it), expose only Vite — the backend does not
need to be exposed, because `vite.config.ts` already proxies both `/api` and `/ws`:

```bash
cd frontend && ./node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort
```

This keeps `:7860` bound to localhost. That matters: **the HITL approve/veto endpoints
have no authentication and CORS is `*`**, so anyone who can reach the backend can
approve or veto a maneuver.

### Verify it actually works

```bash
curl -s localhost:7860/health          # expect data_source: "live" or "cache"
curl -s -o /dev/null -w '%{http_code}' localhost:5173/api/metrics    # 200
```

Demo flow: **INJECT CONJUNCTION** → stage tracker advances DETECT → NEGOTIATE →
DECIDE → **APPROVE MANEUVER** → result card appears top-left.

To show the content-review gate rejecting something live, append
`?force_bad_narrative=true` to a reflex frame request, e.g.:

```
GET /api/reflex/frame/{idx}?force_bad_narrative=true
```

This runs a hardcoded malformed narrative through the real
`review_reflex_narrative` (`backend/api/reflex_playbook.py:34-45,247-260`)
and flips the ReflexPanel pill to amber `Safe Fallback` with real rejection
reasons in the tooltip — see `ROUND2.md` §4 for the full mechanism and the
cache-isolation guarantee that keeps a forced request from contaminating
later normal ones.

**Set sim speed to 60× or 300×** (top-right selector). At the 1× default the
constellation is effectively a still image. This is deliberate on the backend's part
(`SIM_SPEED = 1.0`, so SIM TIME tracks real UTC without drift) and is the honest
remainder of the "trajectories don't read clearly" problem.

---

## 4. Verification commands (all currently green)

```bash
# Backend tests — 33 passing (Round 2; was 8 before content_review.py landed)
./.venv-audit/bin/python -m pytest test_*.py -q --asyncio-mode=auto

# Frontend typecheck + production build
cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build
```

`test_orbital.py` is the regression guard for the GMST fix. It is deliberately
discriminating — the pre-fix code produced 18.6974° and a −1.94°/orbit ground-track
drift, both far outside the asserted bounds. **If it fails, the propagator regressed.**

**Collection finding (Round 2):** `test_negotiation.py` predates the content-review
work and contributed **zero** tests to the old "8/8" figure — its only function was
`main()`, guarded by `if __name__ == "__main__":`, which pytest never collects
because it isn't `test_`-prefixed. So the negotiation path was silently untested
before this pass, not just under-tested. It now has one real, collected test:
`test_negotiation_rationale_crediting_loser_is_replaced_by_deterministic_fallback`.
Worth checking any other top-level `test_*.py` file the same way before trusting a
"passing" count at face value.

---

## 5. What was changed, and why

### Backend (1 file)

| File | Change |
|---|---|
| `backend/orbital/propagator.py` | GMST divisor `3600.0` → `240.0`. The Vallado polynomial returns seconds of time, not arcseconds. Every longitude was off by a factor of 15. |

### Frontend (14 files)

| Area | Change |
|---|---|
| `store/useSpaceStore.ts` | Added explicit `pipelineStage`, `maneuverResult`, `maneuverSummary`; monotonic `feedSeq` for log keys; `simSpeed` default 60 → 1 to match backend. |
| `hooks/useWebSocket.ts` | Drives `pipelineStage` synchronously; captures the real before/after numbers from `maneuver_executed`; handles the previously-ignored `metrics_update`; de-duplicated four copies of the metrics mapping; WS URL now uses current origin (LAN-safe). |
| `components/StageTracker` | Reads explicit stage instead of DB status (NEGOTIATE was unreachable); active step is a filled pill with a pulsing ring. |
| `components/MathPanel` | Rewritten: raw 25-row binary-search dump → result card, derivation behind a disclosure, moved out of the globe-covering full-screen modal, index-based keys. |
| `components/HITLPanel` | Re-entry guard against double-submit; auto-veto moved out of the setState updater (StrictMode double-fired it); stale-closure fix via ref; rollback + toast on failed POST; real `burn_time` and miss distance replacing hardcoded `TIMING: 60 min` / `IMPACT: LOW`; removed fabricated `pc = 0.01` fallback; log-scale risk bars. |
| `components/Globe/SatelliteLayer` | Trail cap 40 → 400; fade to 25% brightness instead of black (additive blending made half of every trail invisible); conjunction pair 2× → 4.5× and background desaturated; freezes the pre-maneuver track instead of deleting it. |
| `components/Globe/Globe.tsx` | "COLLISION COURSE" label showed *current* separation; now miss distance at TCA. |
| `components/Outcome/OutcomeOverlay` | Removed a helper that **hashed satellite names** to synthesize a debris mass; one stated assumption, labelled as such. |
| `components/MetricsBar` | Total ΔV divided an m/s value by 1000 again — metric was pinned at `0.000 m/s`. |
| `components/EventFeed` | Duplicate keys (`timestamp::type` collided within a millisecond); auto-scroll was dead past 50 entries. |
| `components/ReflexPanel` | Dodge geometry re-derived from measured range (the offset branch was unreachable); correction-burn leg driven by the real `post_evade_action` field; threshold legend corrected (SAFE is >2.2 m, not >1.5 m); removed a fabricated "+50m CORRIDOR BIAS". |
| `components/Legend` | "paths exaggerated for clarity" → "SGP4-propagated from live TLEs". |
| `types/index.ts` | Added `ManeuverResult`, `ManeuverSummary`, `WSMessageMetricsUpdate`, `EventLogItem.seq`; corrected `ConjunctionEvent` to match the **live** API (`operator_primary`, `operator_secondary`, `tca_iso` are absent at runtime despite being declared in the response schema). |

---

## 6. Open work, in priority order

Ranked in full in `AUDIT.md`. Condensed:

### Closed in Round 2 (Content Readiness Review — see `ROUND2.md`)
- The negotiation rationale dead-code defect noted in `AUDIT.md` Rank 03
  ("the Groq rationale is computed and then never read") is fixed:
  `backend/agents/nodes/operator_agent.py` now reviews the rationale via
  `backend/content_review.py` and writes it into
  `winning_proposal["rationale"]`, rendered as `AI RATIONALE` in
  `HITLPanel.tsx`.
- The onboard reflex narrative (`backend/api/reflex_playbook.py`) is now
  content-reviewed before it is cached per threat band, so a malformed LLM
  generation can no longer be served unchanged for the rest of the process
  (see AUDIT/Rank 02 background and `ROUND2.md` §3).
- `[Executor]` → `[EXECUTOR]` case fix so the EventFeed badge matcher (case
  sensitive) picks it up instead of falling through to a generic SYSTEM
  badge (`backend/agents/nodes/maneuver_executor.py`).
- The duplicated `hitl_request` websocket emission (`hitl_node.py` and
  `operator_agent.py` both emitted it) is removed; the single emission now
  lives in `operator_agent.py`, with both defensive guards in `hitl_node.py`
  preserved.

### Blocks the demo
1. **Git LFS assets are pointers.** `best (1).pt` 133 B, `keypoint_mobilenet.pth` 132 B,
   `output_h264.mp4` 133 B; `git-lfs` not installed. All reflex endpoints 503.
   → `git lfs pull` and verify sizes. **Still open** — unchanged by Round 2.
   The half of this item that was in the UI's control — the badge and slider
   masking the dead pipeline as "PIPELINE: READY" / `1 / 100` — is **closed**:
   `ReflexPanel.tsx` now binds the badge to real tri-state fetch status and
   `totalFrames`/distance/pose telemetry render em dashes instead of fake
   defaults when there is no data. See `ROUND2.md` §5 and `AUDIT.md`.

### Will cost points in judging
2. **`generate_bids → await_hitl` is an unconditional edge.** A failed bid parks the
   graph at the interrupt with no `hitl_request` emitted, while `/api/demo/inject`
   still returns HTTP 200. UI hangs on "negotiating" forever.
   → Make the edge conditional on `winning_proposal`; emit a `system_status` error.
3. **HITL endpoints validate nothing.** Unknown `event_id` silently falls back to the
   latest session, so `POST /api/hitl/does-not-exist/approve` executes a *different*
   event's maneuver. No auth, `allow_origins="*"`, no compare-and-set.
   The reflex frame endpoint's `force_bad_narrative` query param (see §3
   above) has the same gap — no auth check gates it
   (`backend/api/reflex.py:553-571`), so anyone who knows the parameter can
   flip a viewer's pill state. Low stakes for a demo, consistent with the
   rest of this API, but not presenter-only.
4. **An "executed" maneuver never touches orbital state** — a cosmetic longitude nudge.
   Re-screening re-detects the same conjunction at the same miss distance.
5. **Screening checks zero pairs on real data.** All satellites are labelled "SpaceX"
   and same-operator pairs are skipped; the flat 20-pair budget means only index 0 is
   ever screened. (Performance is not the constraint: 0.02 s per pair measured.)
6. **`starlink_cache.tle` is 60 days stale** — 7 SGP4 errors, 5 impossible altitudes
   (10,423 km and 63 km) rendered as normal satellites. No epoch-age check anywhere.
7. **Coarse TCA scan takes a global `argmin` before refinement.** At 15.2 km/s the
   satellites move 915 km between samples, so a true 0.5 km miss can register as
   456 km and lose to a benign encounter. → Bracket range-rate sign changes.

### Polish
8. Earth texture loads from `raw.githubusercontent.com` at runtime — vendor it into
   `frontend/public/` or the globe is a white sphere on venue wifi.
9. `routes.py` doesn't serialize through `ConjunctionEventResponse`, so three declared
   fields never reach the client.
10. Landing page section 4 shows three hardcoded result numbers presented as system
    output. Add `--asyncio-mode=auto` to a pytest config so the documented test
    command works as written.

---

## 7. Do not "fix" these — rehearse them

- **"Is that really RAG?"** No. Four-element Python list, interval matching, no
  embeddings. The strong answer is that a deterministic lookup is *correct* for a
  safety reflex. Rename the misleading `Search Query:` log line to match.
- **"Does the LLM fire the thruster?"** No — `need_cmd = status == "CRITICAL"` from the
  deterministic classifier. But clamp `duration_ms`; it is the one unbounded field.
- **"How do you know the burn helps?"** The CW model computes
  `sqrt(orig² + shift²)`, which *cannot represent a harmful burn*. The docstring's
  "conservative" claim is wrong.
- **Pc is capped at 3.14e-4**, so a direct hit reports "1 in 3,183". The demo pair is
  co-orbital at ~0.1 m/s where a judge expects 10–15 km/s.
