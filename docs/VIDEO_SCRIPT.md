# SpaceATC — Demo Video Script (target 3:30, hard cap 5:00)

A judge must understand the **entire** project from this video alone. Every claim is shown
working on the live build — no slideware, no faked steps. Record the live Space at
`https://huggingface.co/spaces/Rishet11/spaceatc` (confirm it's the latest build first:
`/health` should report ~100 satellites).

**Rule:** narrate what is literally happening on screen. If it isn't on screen, cut the line.

---

## 0:00–0:25 · Hook + Problem
**On screen:** the 3D globe, ~100 Starlink satellites orbiting. Mission Control log visible.
**Voiceover:**
> "In January 2026 SpaceX's Stargaze system began flagging 30 million orbital observations a
> day. It tells two operators they're about to collide — but not *who* moves, by how much, or
> by when. With a million collision-avoidance maneuvers projected per year, that uncoordinated
> handoff is the gap. SpaceATC closes it — with two layers of autonomy."

## 0:25–0:40 · What it is (one breath)
**On screen:** slow orbit; overlay the two-layer line from the README.
**Voiceover:**
> "Layer one: ground-side multi-agent negotiation with a human in the loop. Layer two: a
> fully-autonomous onboard reflex for the debris nobody tracks. Real orbital physics, real
> agents, running live in your browser right now."

## 0:40–1:50 · LIVE DEMO — Layer 1 (this is the core; do not rush)
**Action 1 (0:40):** Click **INJECT CONJUNCTION**.
> "I inject a conjunction between two satellites."
**Action 2 (0:50):** Event feed prints the detector lines; two craft turn red on the globe.
> "A LangGraph detector screens cross-operator pairs with real SGP4 propagation and SciPy
> time-of-closest-approach refinement. Collision probability crosses the one-in-ten-thousand
> alert threshold — so it escalates."
**Action 3 (1:05):** Stage tracker shows both operator bids.
> "Now two *independent* operator agents each compute their own avoidance burn using
> Clohessy-Wiltshire orbital mechanics. The coordinator picks the winner on a real cost
> signal — delta-V plus maneuver history — not a coin flip."
**Action 4 (1:20):** HITL panel slides up showing ΔV, Pc before/after.
> "The agent graph then *interrupts itself* and checkpoints to SQLite, waiting for human
> authority. No maneuver executes without a person."
**Action 5 (1:30):** Click **APPROVE**. The maneuvered satellite's track redraws; the
before→after Pc panel updates.
> "I approve. The burn executes, the satellite's track redraws, and — read the panel —
> collision probability drops from one in a few hundred to one in millions. That's the handoff
> Stargaze can't do, automated end to end."

## 1:50–3:00 · LIVE DEMO — Layer 2 (OrbitMind, the differentiator)
**Action 6 (1:50):** Switch to **Onboard Reflex**. Default feed shows YOLO box + 6-DOF wireframe.
> "Layer two runs on the satellite itself. A YOLO26 model detects tumbling debris from a single
> camera; a MobileNet pose network recovers its full 6-DOF position and orientation."
**Action 7 (2:10):** Click **Decision-Loop Replay**. Point at the labeled badge.
> "To show the full autonomous policy I sweep the relative range — and I label it honestly: the
> detection and the decision logic are live; only the range is a swept demonstration input."
**Action 8 (2:25):** Range falls; status walks MONITORING → WARNING → CRITICAL.
> "Watch the onboard agent reason in real time. It classifies the threat deterministically,
> retrieves the matching evasion play, and as the object crosses one-and-a-half meters—"
**Action 9 (2:40):** CRITICAL fires; evade trajectory + emitted JSON command appear.
> "—it executes an autonomous evasion and emits a thruster command. Critically, that command is
> *validated against a deterministic safety envelope*. The language model proposes and explains;
> it never commands a thruster directly. No ground contact, sub-second, fail-safe."

## 3:00–3:20 · Engineering + scale (fast, over B-roll)
**On screen:** quick cuts — architecture diagram, the test suite passing, the repo commit graph.
**Voiceover:**
> "Under the hood: FastAPI and LangGraph, SGP4 propagation, PyTorch perception, one Docker image
> serving the API, the socket, the ML, and the UI. Deterministic guardrails are unit-tested. It
> screens a constellation today and is built to port onto ARM64 flight compute under six gigs."

## 3:20–3:30 · Close
**On screen:** globe + the live-demo URL on screen.
**Voiceover:**
> "SpaceATC — autonomous, coordinated collision avoidance, ground to orbit. It's live, it's real,
> try it yourself."

---

## Capture checklist (before recording)
- [ ] Live Space is the **latest** build (`/health` ≈ 100 sats; INJECT works; replay reaches CRITICAL).
- [ ] Pre-warm the Reflex feed once so playback is smooth on camera (wait for "Buffering" to clear).
- [ ] 60× sim speed so orbits move visibly; reset demo state before the take (`/api/demo/reset`).
- [ ] Screen-record at 1080p; keep the Mission Control log and stage tracker in frame for Layer 1.
- [ ] Keep total under 5:00; 3:30 is the target. One clean take per layer beats a long take.
