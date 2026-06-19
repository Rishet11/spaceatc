# SpaceATC — Architecture

SpaceATC is a **two-layer autonomous system** for satellite collision avoidance. It is built
to answer the FAR AWAY "Agentic & Autonomous Systems" bar directly: autonomous multi-step
reasoning, tool use, persistent memory, and a human-in-the-loop interrupt — not an LLM behind
a UI.

```
                          ┌────────────────────────────────────────────┐
                          │            FRONTEND (React + R3F)            │
                          │  3D globe · event feed · HITL panel · reflex │
                          └───────────────┬──────────────┬───────────────┘
                              WebSocket    │              │  REST
                          ┌───────────────▼──────────────▼───────────────┐
                          │               BACKEND (FastAPI)               │
                          │                                               │
   LAYER 1 — GROUND       │   LangGraph StateGraph (SQLite checkpointer)  │
   multi-agent + HITL     │                                               │
                          │   ingest_tle → detect_conjunctions            │
                          │        │ (Pc > 1e-4?)                         │
                          │        ▼                                      │
                          │   coordinate_negotiation                      │
                          │        ▼                                      │
                          │   generate_bids  ── Operator A agent ──┐      │
                          │                  ── Operator B agent ──┤      │
                          │        ▼            winner = min(score) │     │
                          │   await_hitl  ◄── interrupt_before ─────┘     │
                          │        │ (human APPROVE / VETO via REST)      │
                          │        ▼                                      │
                          │   execute_maneuver → Pc drops, orbit retrace  │
                          │                                               │
   LAYER 2 — ONBOARD      │   OrbitMind reflex (per camera frame):        │
   fully autonomous       │   YOLO26 detect → MobileNetV3 6-DOF pose →    │
                          │   classify_threat (deterministic) →           │
                          │   retrieve_plays (RAG) → LLM reason →          │
                          │   validate_dodge_command (safety guardrail)   │
                          └───────────────────────────────────────────────┘
            tools: CelesTrak TLEs (httpx) · SGP4 (sgp4) · Clohessy–Wiltshire · PyTorch/OpenCV
```

## Layer 1 — Ground Negotiation (multi-agent + HITL)

A LangGraph `StateGraph` (`backend/agents/graph.py`) compiled with an `AsyncSqliteSaver`
checkpointer and `interrupt_before=["await_hitl"]`. Nodes:

| Node | File | What it does (real work, not a prompt) |
|---|---|---|
| `ingest_tle` | `nodes/tle_ingestion.py` | Pulls live Starlink TLEs from CelesTrak (httpx), bounded-timeout fallback to a 100-sat local cache. |
| `detect_conjunctions` | `nodes/conjunction_detector.py` | Screens cross-operator pairs with a real **SGP4 coarse scan + SciPy TCA refinement** (`orbital/conjunction.py:find_tca`); raises an event when **Pc > 1e-4** (industry alert threshold). |
| `coordinate_negotiation` | `nodes/negotiation_coordinator.py` | Selects the highest-Pc event and broadcasts a call-for-proposals. |
| `generate_bids` | `nodes/operator_agent.py` | **Each operator agent independently** computes its avoidance ΔV via **Clohessy–Wiltshire** relative-motion math using *its own* satellite's mean motion. `bid_score = ΔV + maneuver_count·0.1`; the coordinator picks `min(bid_score)` — a real cost trade-off (fuel + maneuver history), with an LLM (Gemini) narrating *why*. |
| `await_hitl` | `nodes/hitl_node.py` | The graph **interrupts here** and persists its state; it resumes only on a human `APPROVE`/`VETO` (REST → `resume_after_hitl`). |
| `execute_maneuver` | `nodes/maneuver_executor.py` | Applies the burn; post-maneuver Pc drops by orders of magnitude. |

**Why this is agentic, not a wrapper:** independent agents with their own objective functions,
a coordinator arbitrating on a real cost signal, autonomous tool use (orbital propagation), a
graph that **pauses and checkpoints** for human authority and resumes deterministically. The
LLM explains decisions; it does not *make* the safety-critical ones.

## Layer 2 — OrbitMind Onboard Reflex (fully autonomous)

A per-frame perception→decision loop (`backend/api/reflex.py`, `reflex_playbook.py`) for the
~1.2M uncatalogued objects no ground network tracks:

1. **Perceive** — YOLO26 detects the debris; MobileNetV3 regresses 11 keypoints; OpenCV
   `solvePnP` recovers the 6-DOF pose (translation + quaternion).
2. **Classify** — `classify_threat()` maps range to a band **deterministically**
   (`>2.2m` monitor · `1.5–2.2m` prime · `<1.5m` evade). A safety reflex never lets an LLM
   move a threshold.
3. **Reason (RAG + LLM)** — `retrieve_plays()` ranks an onboard evasion playbook by range
   band; Gemini produces the onboard-log narrative grounded in the retrieved plays.
4. **Guardrail** — `validate_dodge_command()` clamps/validates any proposed thruster command
   to a safety envelope (axis ∈ {X,Y,Z}, 1–50 cm/s). **The model never commands thrusters
   directly.** A rule-based fallback runs if the LLM/network is unavailable, so the reflex
   never depends on connectivity.

**Decision-Loop Replay (demo integrity):** the benchmark SPEED+ clip never closes to the
evasion threshold, so a *clearly-labeled* range **sweep** (`reflex_playbook.swept_range()`)
walks the agent through every band to demonstrate the full policy. Detection and decision
logic stay live; only the range is a swept demonstration input, and the UI says so. Nothing
about the perception is faked.

## Data & deploy
- **State:** SQLite via `aiosqlite` (satellites, conjunctions, proposals) + LangGraph
  checkpoints in the same DB.
- **Transport:** WebSocket pushes satellite positions, agent log lines, and HITL requests;
  REST drives demo injection, HITL decisions, sim speed, and reflex frames.
- **Deploy:** single Docker image on Hugging Face Spaces — FastAPI serves the API, the `/ws`
  socket, OrbitMind inference, **and** the built React SPA same-origin. GitHub Actions mirrors
  `main` → the Space (LFS-aware) with a token preflight so a broken deploy fails loudly.
