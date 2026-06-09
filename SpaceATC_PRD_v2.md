# SpaceATC — Product Requirements Document v2.0
**FAR AWAY 2026 | Internal | Tracks: Space & Aerospace + Agentic & Autonomous Systems**
**Team: ClauseZero | Version 2.0 | June 2026**

> This version merges the original SpaceATC (ground negotiation) PRD with the OrbitMind project (onboard vision + reasoning), repositioned as the **Reflex Layer**. Code is intentionally minimal — this document is for the team to align on concept, architecture, and talking points. Implementation details belong in the codebase, not here.

---

## 0. Project Brief (At a Glance)

| | |
|---|---|
| **Project Name** | SpaceATC (Ground Negotiation) + OrbitMind Reflex Layer (Onboard Auto-Dodge) |
| **One-line pitch** | SpaceATC predicts and negotiates collisions between known satellites days in advance. The OrbitMind Reflex Layer detects untracked debris in real time and autonomously nudges the satellite out of the way — no ground contact needed. |
| **Primary system (live demo)** | SpaceATC — real CelesTrak TLE data, real satellite names, multi-agent negotiation, human approval. |
| **Secondary system (simulated demo)** | OrbitMind Reflex Layer — SPEED+ dataset imagery, CNN pose estimation, small LLM decision-making, simulated dodge. |
| **Why both exist** | Layer 1 solves the *predictable* problem (28,000 tracked objects, 72-hour warning). Layer 2 solves the *unpredictable* problem (1.2M untracked debris fragments, near-zero warning). |
| **Core tech (Layer 1)** | Python, FastAPI, LangGraph, sgp4, React, Three.js |
| **Core tech (Layer 2)** | YOLO + EfficientNet + PnP (vision), small quantized LLM + RAG (reasoning), JSON schema validation |
| **Build approach** | Software-only. No PCB/hardware track. Both layers are simulations/dashboards running on laptops. |

### How it all fits together (simple view)

```
                         ┌──────────────────────────────────┐
                         │        SHARED DASHBOARD           │
                         │  (Globe view + Event Feed + Logs) │
                         └─────────────┬──────────────────────┘
                                        │
        ┌───────────────────────────────┴────────────────────────────────┐
        │                                                                  │
┌───────▼─────────────────────────┐                ┌───────────────────────▼────────┐
│  LAYER 1 — SpaceATC (Ground)     │   advisory      │  LAYER 2 — Reflex (Onboard)     │
│  LIVE DEMO, real data            │   data only,    │  SIMULATED DEMO, SPEED+ images  │
│                                   │   no control    │                                 │
│  CelesTrak TLE → SGP4 propagate  │ ───────────────▶│  Camera frame → CNN pose (30ms) │
│  → Conjunction Detector          │                 │  → Small LLM + mission playbook │
│  → Agent Negotiation (bids)      │                 │  → JSON dodge command (150ms)   │
│  → HITL Approval → Maneuver      │                 │  → Fail-safe check → "Maneuver" │
└───────────────────────────────────┘                └─────────────────────────────────┘
```

**The arrow between layers is one-directional and informational only.** SpaceATC never controls a satellite. The Reflex Layer never talks to SpaceATC's negotiation system. They share a dashboard for the demo, nothing else. This separation is important — keep it clean when judges ask "how do these talk to each other?"

---

## 1. The Problem (Both Halves)

### 1.1 The Predictable Half (Layer 1's problem)

SpaceX launched **Stargaze** on January 29, 2026. It generates Conjunction Data Messages (CDMs) for ~30,000 star trackers across the Starlink fleet and sends them to operators within minutes.

**What Stargaze does:** Tells two operators "you are going to collide."
**What it does NOT do:** Tell them who moves, by how much, or when.

Numbers that matter:
- Starlink performed ~144,000 collision-avoidance maneuvers in 5 months (2024–2025) — one every 90 seconds
- Projected ~1 million maneuvers/year by 2027
- $11.1B in projected satellite losses from uncoordinated conjunctions (WEF, 2025)
- ~28,000–43,000 tracked objects in LEO

### 1.2 The Unpredictable Half (Layer 2's problem)

- ~1.2 million untracked debris fragments, 1–10cm, too small for radar, too large to be harmless
- These fragments are statistically responsible for the majority of catastrophic collision risk
- No TLE exists for them. No CDM is ever generated. Ground-based prediction is structurally blind to them.
- The only way to "see" them is from the satellite itself, at close range, with very little reaction time

**The honest framing:** SpaceATC alone solves the coordination problem for tracked objects — a real, deployable, impactful slice. The Reflex Layer is the answer to "but what about the 1.2 million objects nobody tracks?" — it doesn't claim to solve debris tracking globally, it gives an individual satellite the ability to react to what it sees, right in front of it.

---

## 2. Layer 1 — SpaceATC (Ground Negotiation)

*This section is a trimmed version of the original PRD. Full implementation detail (file structure, API contracts, build timeline) stays in the codebase/README, not duplicated here.*

### 2.1 What It Does

1. Pulls real TLE/OMM data for satellites from CelesTrak (no auth needed)
2. Propagates orbits using SGP4 to find close approaches (conjunctions)
3. When a conjunction crosses a danger threshold, two "operator agents" are triggered
4. Each agent calculates the **minimum fuel burn (delta-V)** needed on *its* satellite to make the conjunction safe
5. Agents submit bids to a coordinator. Lowest-cost bid wins — that satellite maneuvers, the other holds position
6. The winning proposal is shown to a human operator for **approve/veto** (Human-In-The-Loop, HITL)
7. On approval, the maneuver is "executed" (simulated for demo) and collision probability (Pc) drops visibly on the globe

### 2.2 Core Libraries (Layer 1)

| Purpose | Library |
|---|---|
| Orbital propagation | `sgp4` (Python) |
| Multi-agent orchestration | `LangGraph` |
| Backend API + WebSocket | `FastAPI` |
| Vector/optimization math | `numpy`, `scipy` |
| Data fetching | `httpx` |
| State persistence | `SQLite` (`aiosqlite`) |
| 3D globe frontend | `React` + `Three.js` + `@react-three/fiber` |
| Orbit math in browser | `satellite.js` |
| State management | `Zustand` |

### 2.3 Key Data Formats (Schemas Only)

**Conjunction Event**
```json
{
  "event_id": "uuid",
  "sat_primary": "STARLINK-4521",
  "sat_secondary": "STARLINK-7833",
  "tca": "2026-06-15T08:42:00Z",
  "miss_distance_km": 0.41,
  "pc": 0.0012,
  "status": "negotiating"
}
```

**Maneuver Proposal (Bid)**
```json
{
  "proposal_id": "uuid",
  "event_id": "uuid",
  "satellite": "STARLINK-4521",
  "delta_v_ms": 0.087,
  "burn_direction": "prograde",
  "fuel_reserve_after_pct": 84,
  "mission_impact": "LOW",
  "post_maneuver_pc": 0.00000031
}
```

**Bid scoring (concept, not full code)**
```
bid_score = delta_v_ms 
          + (maneuver_count_penalty * 0.1) 
          + (mission_impact_weight)

# lower score wins → that satellite maneuvers
```

---

## 3. Layer 2 — OrbitMind Reflex Layer (Onboard Auto-Dodge)

### 3.1 The Core Idea

A satellite has a camera. The camera constantly watches for nearby objects. When something unexpected (untracked debris) drifts close, the onboard pipeline:

1. **Sees it** — camera frame captured
2. **Understands it** — CNN figures out what it is, where it is, and how it's tumbling (6-Degrees-of-Freedom pose: position + rotation)
3. **Decides** — a small AI reasoning layer checks mission rules and decides if/how to dodge
4. **Acts** — outputs a structured (JSON) command: which direction to nudge, how much, for how long
5. **Double-checks** — a classical (non-AI) safety check verifies the command is physically sane before it's "executed"
6. **Recovers** — afterward, the satellite schedules a small correction burn to return to its planned path (see Section 6)

All of this happens **onboard, in well under a second, with zero ground contact.**

### 3.2 The Two-Stage AI (Why This Isn't a Gimmick)

| Stage | What it does | Tech | Speed |
|---|---|---|---|
| **Perception** | Detect object, find 11 structural keypoints, solve 6DOF pose | YOLO (detection) + EfficientNet-B2 (keypoints) + OpenCV `solvePnP` (math) | <30ms, runs continuously |
| **Reasoning** | Interpret the situation, check mission playbook, decide the response | Small quantized LLM (e.g. Llama/DeepSeek, INT4, 1–3B params) + local RAG over mission playbooks | <150ms, only runs when something is detected |

**Why split it this way:** the CNN does deterministic physics/geometry — it must never "hallucinate" a position. The LLM does *judgment* — interpreting a situation against rules ("if tumbling rate exceeds X, switch to Match-Tumble mode"). Neither layer does the other's job. This split is the actual answer to "is this just an LLM wrapper" — the LLM never touches the numbers, only the decision logic.

### 3.3 Grammar-Constrained Output (The Safety Net)

The LLM's output is **forced** into a fixed JSON schema. It cannot produce free-text. If the output doesn't match the schema, the command is rejected automatically and the system falls back to a safe default ("hold position / abort").

**Reflex Command (Schema)**
```json
{
  "intent": "EVADE",
  "axis": "Y",
  "delta_v_cm_s": 12,
  "duration_ms": 400,
  "reason": "debris_tumbling_close_approach",
  "post_evade_action": "schedule_correction_burn"
}
```

### 3.4 Core Libraries (Layer 2 — software simulation)

| Purpose | Library |
|---|---|
| Object detection | `YOLO` (Ultralytics) |
| Keypoint regression | `EfficientNet-B2` (via `timm`/PyTorch) |
| 6DOF pose solving | `OpenCV` `solvePnP` |
| Small LLM (local) | Quantized Llama/DeepSeek via `llama.cpp` or `Ollama` |
| RAG over mission playbooks | `FAISS` + simple embedding model |
| Output validation | `pydantic` (JSON schema enforcement) |
| Demo dataset | `SPEED+` (Tango spacecraft images) |

**Note on "on-device":** for the hackathon demo, the entire Reflex pipeline runs on a laptop as a simulation — there's no actual satellite. The architecture (quantization, <6GB footprint, ARM64-class hardware) is described as the *intended* deployment target, framed honestly as feasibility analysis, not as something running on real hardware today.

---

## 4. How the Two Layers Connect

- **SpaceATC (Layer 1)** generates a maneuver *advisory* for a predicted conjunction. This advisory is just data — a recommendation sent toward the satellite's systems.
- **The Reflex Layer (Layer 2)** runs independently and continuously, watching for anything *not* in that advisory — i.e., debris nobody predicted.
- **Both feed the same dashboard** for the demo: SpaceATC's events show up in the Event Feed as "Predicted Conjunction → Negotiated → Approved." Reflex events show up as "Unplanned Debris Detected → Auto-Dodge Executed."

They are **not** the same agent system and do not call each other's APIs. This is intentional — it mirrors reality (ground coordination vs. onboard reflexes are genuinely separate systems with separate timescales), and it keeps both halves independently demoable if one breaks.

---

## 5. Trajectory & Safety — "Won't This Permanently Change the Orbit?"

**No.** Both layers produce *small, temporary* deviations, not new orbits.

- A negotiated SpaceATC maneuver is typically **0.05–0.1 m/s** of delta-V — at LEO altitudes this shifts the satellite's position at the time of closest approach by roughly **200–500 meters**, enough to drop Pc from ~10⁻³ to <10⁻⁶.
- A Reflex Layer dodge is even smaller — centimeters to a couple of meters, just enough to clear an immediate close pass.

**Analogy:** stepping sideways to avoid a puddle in a hallway, then stepping back to keep walking straight.

After either maneuver, the satellite schedules a small **correction burn** during its next routine **station-keeping** window — something satellites already do constantly regardless of debris (to counter atmospheric drag, etc.). The overall orbit (altitude, period, inclination) is unaffected.

**Honest tradeoff to acknowledge if asked:** every maneuver uses a small amount of fuel. Frequent dodging adds up over a satellite's lifetime. This is the same tradeoff satellites already accept for collision avoidance today — this system automates the *decision*, it doesn't introduce a new cost.

---

## 6. Is This Genuinely Agentic AI?

A system is "agentic" if it can **perceive → reason → decide → act** autonomously on inputs it wasn't explicitly pre-programmed for.

**Layer 1 (SpaceATC):**
- Perceives: a new CDM with orbital parameters it's never seen before
- Reasons: computes delta-V for *this specific* conjunction geometry (changes every time)
- Decides: generates a bid reflecting fuel state, mission priority, maneuver cost
- Acts: submits the bid; the coordinator picks a winner it didn't know in advance

**Layer 2 (Reflex):**
- Perceives: a camera frame of an object it's never seen before
- Reasons: estimates pose, checks mission rules via RAG
- Decides: chooses an evasion strategy based on the specific tumble rate/geometry
- Acts: emits a structured command

**What would make it a gimmick:** if an LLM were asked to directly output a delta-V number or thrust vector ("please calculate how much fuel to burn"). That's not done anywhere in this system. All physics/geometry is deterministic (sgp4, PnP, optimization). The AI's role is *judgment and interpretation*, never raw number generation. Keep this separation crystal clear in the pitch — it's the strongest answer to the "gimmick" question.

---

## 7. Competitive Landscape — "Isn't This Already Built?"

This is the most important section to get right, because the landscape shifted in early 2026.

**Stargaze (SpaceX, Jan 2026):** Sends CDMs (alerts) to operators. Does not negotiate. Does not decide who moves.

**Kayhan Space — Pathfinder / Satcat (as of 2026):** This is the closest existing competitor, and you should name it proactively rather than let a judge bring it up.
- Kayhan's Satcat platform now covers **90%+ of operational LEO satellites** across **50+ operator customers** — the largest commercial space traffic coordination platform.
- A 2026 update to Pathfinder **operationalizes pre-negotiated "operative agreements"** — when a conjunction occurs between two Kayhan customers, the platform checks if a prior agreement exists (based on Space Safety Coalition maneuverability classes) and assigns responsibility automatically, cutting response time from hours to seconds.

**So — is the idea "already done"?** Partially, and you should say so plainly:

| | Kayhan Pathfinder | SpaceATC |
|---|---|---|
| Access model | Commercial, ~50 paying operator customers | Open/neutral protocol layer |
| Negotiation basis | Pre-existing paper agreements between *subscribed* operators, now automated | Real-time agent negotiation, including between operators with **no prior agreement** |
| Untracked debris | Not addressed | Addressed via Reflex Layer (onboard, real-time) |

**The honest pitch line:** "Stargaze tells you there's a problem. Kayhan automates agreements between operators who already pay them and already agreed in advance. SpaceATC is the open negotiation layer for the conjunctions that fall outside any existing agreement — plus an onboard reflex for debris no platform tracks at all."

Don't claim to have invented cross-operator coordination — claim to have built the open, real-time negotiation piece for the gap that remains, and to have extended coverage to untracked objects via the Reflex Layer, which neither Stargaze nor Kayhan address at the onboard level.

---

## 8. Tracking, Communication & Integration

### 8.1 How tracking works (Layer 1)
SpaceATC does **not** track anything itself. Tracking is done by the US Space Surveillance Network and commercial providers (e.g., LeoLabs), published as free TLE/OMM data via CelesTrak/Space-Track. SpaceATC just *reads* this public data.

### 8.2 Does SpaceATC talk to satellites?
**No, never, by design.** SpaceATC is ground-to-ground only:

```
SpaceATC → maneuver recommendation → operator's ground control team (human)
   → operator reviews/approves → operator's existing uplink → satellite executes
```

SpaceATC produces a recommendation document for a human. It never has, and never needs, any communication link to a satellite.

### 8.3 Does the Reflex Layer run on the satellite (on-device)?
**Conceptually yes, for production** — that's the entire point (it must work when ground contact is impossible). **For the hackathon demo, no** — it runs as a software simulation on a laptop using SPEED+ imagery, with the on-device architecture (quantized models, hardware target) presented as a feasibility analysis. Be upfront about this distinction if asked.

### 8.4 Integration — new satellites needed?
**Layer 1: zero hardware changes, zero new satellites.** Operators register, point to existing public TLE data, and receive recommendations via an API/email endpoint. No write access to any operator's systems is needed.

**Layer 2: future-scope requires a camera-equipped satellite.** For the demo, this is simulated. Acknowledge clearly: most existing satellites (e.g., most of Starlink) don't have cameras pointed for this purpose today — production deployment would require either new satellites with this capability or retrofitting via future missions.

### 8.5 CelesTrak catalog note (still relevant)
CelesTrak is approaching exhaustion of 5-digit NORAD catalog numbers (~mid-July 2026). Use OMM/JSON format or `FORMAT=TLE` (both fine through the hackathon window) — avoid hardcoding assumptions about ID length.

---

## 9. Demo Script — Two Acts

### Act 1 — SpaceATC (Live, ~2 min)
1. Globe loads with real Starlink satellites from CelesTrak
2. Demo injection triggers a conjunction between two satellites (real names)
3. Event Feed shows: conjunction detected → both operator agents bidding → winner selected
4. HITL panel appears with the winning proposal (delta-V, burn direction, Pc before/after)
5. Human clicks **Approve** → orbit trail visibly shifts → Pc drops from ~10⁻³ to <10⁻⁶

### Act 2 — Reflex Layer (Simulated, ~1.5–2 min)
1. Camera feed (SPEED+ image) shows a tumbling object entering frame
2. CNN overlay draws bounding box + 11 keypoints; pose numbers (position, rotation rate) appear live
3. Decision log shows the LLM's structured output (the JSON dodge command from Section 3.3) — displayed as literal text so judges see it's structured, not vague
4. Simple animation shows the satellite's path with a small step-aside, debris passing through where it used to be
5. Final status line: *"Maneuver complete. Correction burn scheduled for next station-keeping window. Orbit unaffected."*

### Closing line
*"SpaceATC gives satellites days to plan. The Reflex Layer gives them milliseconds to react. Together, that's coordination for what we can predict, and autonomy for what we can't."*

---

## 10. Full Q&A Bank (Team Reference)

**Q1. How does negotiation actually work?**
Contract-Net Protocol (an established multi-agent standard, not invented here). Coordinator broadcasts the conjunction to both operator agents → each computes its own minimum delta-V bid based on its own fuel/mission state → coordinator picks the lower-cost bid → that satellite gets the proposal → human approves/vetoes → done. See Section 2.1.

**Q2. How much does the trajectory actually change?**
0.05–0.1 m/s delta-V → 200–500m shift at closest approach (Layer 1); centimeters–meters (Layer 2). Orbit itself (altitude/period) is unaffected. See Section 5.

**Q3. Is this really agentic AI or a gimmick?**
Yes, genuinely — because the AI does judgment/reasoning, never raw physics. See Section 6 for the exact test and the "what would make it a gimmick" check.

**Q4. Is this already implemented? Why do this?**
Partially — Kayhan Space's Pathfinder automates pre-agreed coordination for ~50 paying operators. SpaceATC is the open, real-time negotiation layer for conjunctions *without* a prior agreement, plus the Reflex Layer for untracked debris. See Section 7.

**Q5. What happens if both agents bid the exact same delta-V?**
Tiebreaker: higher fuel-reserve satellite maneuvers (more spare capacity). Secondary tiebreaker: lower mission-value satellite moves.

**Q6. How is tracking done, and how do you contact satellites?**
Tracking = existing public TLE data (no new infrastructure). SpaceATC never contacts satellites — ground-to-ground only, recommendations go to human operators. See Section 8.1–8.2.

**Q7. Will this run on-device / onboard?**
Layer 1: no, ground-only by design. Layer 2: that's the architecture's purpose, but the hackathon demo is a laptop simulation, framed as feasibility analysis. See Section 8.3.

**Q8. How do you integrate with existing satellites — are new satellites required?**
Layer 1: zero changes, operators just register and receive recommendations. Layer 2: requires camera-equipped satellites in production (future scope); demo is simulated. See Section 8.4.

**Q9. What about conjunctions involving 3+ satellites at once?**
Out of scope for v1 (bilateral negotiation only). Acknowledge as a known limitation / future scope — even ESA treats multi-body conjunctions as a harder research problem.

**Q10. What's the latency from detection to proposal?**
Target: under 60 seconds total (TLE fetch cached, sgp4 propagation is fast, delta-V optimization is a quick numerical search) — replacing a ~45-minute manual process.

**Q11. What about military/government satellites?**
Out of scope — they have separate, protected coordination channels. SpaceATC targets commercial operators.

**Q12. What's the ground-contact-window dependency?**
A satellite can only execute a burn during a ground contact window (~10–20 min/orbit for LEO). The maneuver proposal must specify a burn window that falls within an upcoming contact window — this is a real constraint to mention if pressed, even if not fully modeled in the demo.

**Q13. Won't the dodge permanently change the trajectory?**
No — see Section 5 in full. Station-keeping restores the nominal path; the fuel cost is the only lasting effect, and it's the same tradeoff satellites already accept today.

**Q14. Who governs/runs this platform — why would operators trust it?**
Framed as an open consortium model (not controlled by a single operator), analogous to how DNS is governed by a neutral body rather than one company.

**Q15. If SpaceX/Kayhan builds this exact feature tomorrow, what happens to you?**
Same as TCP/IP being adopted by a big commercial player — a neutral protocol doesn't die because someone implements it; this implementation is the reference architecture/proof of concept.

---

## 11. Future Scope & Honest Limitations

- **Untracked debris coverage** via the Reflex Layer is demonstrated as a simulation on benchmark imagery (SPEED+), not deployed on real hardware — say this plainly, don't let it be "discovered."
- **Multi-body conjunctions** (3+ satellites) are not handled in v1.
- **Reflex Layer production deployment** requires camera-equipped satellites — most current satellites don't have this.
- **Governance model** for an open negotiation platform is conceptual, not built.
- **RL-based negotiation** (agents that improve bidding strategy over time) is a natural v2 direction.

---

## 12. Lightweight Repo Structure

```
spaceatc/
├── README.md                 # Problem, solution, architecture image, setup, team
├── backend/                  # Layer 1 — SpaceATC
│   ├── agents/                # LangGraph negotiation graph
│   ├── orbital/               # sgp4 propagation, conjunction math
│   └── api/                   # FastAPI routes + WebSocket
├── reflex/                    # Layer 2 — OrbitMind Reflex Layer
│   ├── vision/                # YOLO + EfficientNet + PnP pipeline
│   ├── reasoning/              # Small LLM + RAG + JSON schema
│   └── demo_data/              # SPEED+ sample images
├── frontend/                  # Shared dashboard (React + Three.js)
│   ├── Globe/                  # Layer 1 view
│   └── ReflexPanel/             # Layer 2 view
└── demo/                      # Demo scripts, pre-recorded backups
```

---

## 13. Reference Links

- CelesTrak Starlink (TLE): `https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=TLE`
- CelesTrak OMM format docs: `https://celestrak.org/NORAD/documentation/gp-data-formats.php`
- Space-Track.org (backup source, register early): `https://www.space-track.org/`
- python-sgp4: `https://github.com/brandon-rhodes/python-sgp4`
- LangGraph docs: `https://langchain-ai.github.io/langgraph/`
- SPEED+ dataset (pose estimation benchmark): search "Stanford SPEED+ dataset"

---

*SpaceATC + OrbitMind Reflex Layer PRD v2.0 | FAR AWAY 2026 | Team ClauseZero | June 2026*
