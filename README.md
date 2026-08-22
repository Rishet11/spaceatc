---
title: SpaceATC
emoji: 🛰️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# SpaceATC 🛰️

Multi-agent autonomous satellite collision avoidance negotiation system.

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://reactjs.org/)
[![Three.js](https://img.shields.io/badge/threejs-black?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)

> **🔴 Live demo:** https://huggingface.co/spaces/Rishet11/spaceatc

---

### Two satellites on a collision course, and the maneuver that resolves it

![Conjunction detected](docs/img/01-conjunction-detected.png)

A real conjunction between two satellites in **different orbital planes** (53.05° and 74.0°),
closing head-on at **13.66 km/s** — the dangerous class of encounter, not a benign co-orbital
drift. SGP4 finds the closest approach at **0.463 km**, collision probability **1 in 3,543**.
Both operators bid an avoidance burn; the coordinator picks the one with the lower operational
cost, and the graph halts for human authorization.

![Maneuver resolved](docs/img/02-maneuver-resolved.png)

Approved: a **0.242 m/s retrograde** burn takes the miss distance to **3.391 km** and the risk to
**1 in 999,999**. The green trajectory is the real post-burn orbit — the actual SGP4 state at the
burn epoch with the computed ΔV applied as an impulse — not an animation. Its separation is
amplified on screen (and labelled as such) because 4 km on a 6,371 km globe is invisible.

![Live constellation](docs/img/03-live-constellation.png)

Idle state: the live Starlink constellation, propagated with SGP4 from current TLEs.

---

## 🚀 Problem

SpaceX launched the Stargaze tracking system on January 29, 2026. It collects 30 million object observations per day across the Starlink fleet, generating Conjunction Data Messages (CDMs) and sending them to operators in minutes instead of hours.

**What Stargaze does:** Tells two operators "you are going to collide."  
**What Stargaze does NOT do:** Tell them who maneuvers, by how much, or by when.

Two operators receive a CDM simultaneously and independently decide what to do. The uncoordinated handoff is the critical gap in modern spaceflight safety. With a projected 1 million collision avoidance maneuvers per year by 2027, an uncoordinated system invites disaster.

## 💡 Solution

SpaceATC fills the uncoordinated handoff gap with **two layers of autonomy**:

**Layer 1 — Ground Negotiation (multi-agent + HITL).** A LangGraph agent system that automatically coordinates maneuver decisions between competing satellite operators. Using true orbital physics (SGP4 and Clohessy-Wiltshire relative-motion equations), independent per-operator agents each propose and score an avoidance burn (delta-V); a coordinator selects the winner on a *real* cost signal (fuel + maneuver history), not an arbitrary tiebreak. The graph **interrupts** for Human-In-The-Loop approval and **checkpoints its state to SQLite** so it survives the pause — genuine agentic orchestration, not a single prompt. A real-time, WebGL 3D globe renders the live constellation and the SGP4-propagated conjunction tracks.

**Layer 2 — OrbitMind Onboard Reflex (vision-based proximity operations).** A satellite-side perception to decision loop for close-proximity encounters: **YOLO26** detects the target and **MobileNetV3** regresses its **6-DOF metric pose** (via the ESA SPEED+ camera model), feeding an onboard decision engine that classifies the range band deterministically, selects from a range-indexed evasion playbook and has an LLM explain the choice, and emits a thruster command **validated against a deterministic safety envelope** so the model never commands thrusters directly. Demonstrated on the **ESA SPEED+ Tango spacecraft-proximity benchmark**.

**Content Readiness Review (ethical safeguard, Round 2).** The maneuver math above is deterministic and fails closed; the AI surface in this system is narrow — the onboard reflex narrative and the negotiation rationale, both LLM-authored prose shown to a human before a decision. `backend/content_review.py` is a synchronous, network-free, stdlib-only checker (no LLM in the loop, so it cannot be fooled by the thing it reviews) that gates both surfaces for completeness and consistency against the deterministic facts computed elsewhere, before either the reflex narrative is cached per threat band or the negotiation rationale is shipped to the HITL panel. A failed review falls back to deterministic text rather than serving the rejected prose. See `ROUND2.md` for the full writeup and demo script.

---

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Globe View  │  │  Event Feed  │  │  HITL Panel       │  │
│  │  (Three.js)  │  │  (agent log) │  │  (approve/veto)   │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         └─────────────────┴───────────────────┘             │
│                          WebSocket                           │
└──────────────────────────────┬──────────────────────────────┘
                               │  ws://localhost:7860/ws
┌──────────────────────────────┴──────────────────────────────┐
│                        BACKEND (FastAPI)                     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │               LangGraph Agent System                 │    │
│  │                                                      │    │
│  │   ┌──────────────┐   triggers   ┌─────────────────┐ │    │
│  │   │  TLE Ingestion│ ──────────► │ Conjunction      │ │    │
│  │   │  Agent       │             │ Detector Agent   │ │    │
│  │   └──────────────┘             └────────┬────────┘ │    │
│  │                                          │ CDM      │    │
│  │                              ┌───────────▼───────┐  │    │
│  │                              │ Negotiation       │  │    │
│  │                              │ Coordinator Agent │  │    │
│  │                              └───────────┬───────┘  │    │
│  │                    ┌──────────────────────┼────────┐ │    │
│  │                    │                      │        │ │    │
│  │             ┌──────▼──────┐      ┌────────▼──────┐ │ │    │
│  │             │ Operator A  │      │ Operator B    │ │ │    │
│  │             │ Agent       │      │ Agent         │ │ │    │
│  │             │ (bid: dV_A) │      │ (bid: dV_B)   │ │ │    │
│  │             └──────┬──────┘      └───────────────┘ │ │    │
│  │                    │ winner determined              │ │    │
│  │             ┌──────▼──────┐                        │ │    │
│  │             │  HITL Node  │ ◄─── human approval    │ │    │
│  │             │  (approve/  │                        │ │    │
│  │             │   veto)     │                        │ │    │
│  │             └──────┬──────┘                        │ │    │
│  │                    │                               │ │    │
│  │             ┌──────▼──────┐                        │ │    │
│  │             │  Maneuver   │                        │ │    │
│  │             │  Executor   │                        │ │    │
│  │             └─────────────┘                        │ │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  CelesTrak    │  │  Orbital     │  │  SQLite State    │  │
│  │  Data Client  │  │  Engine      │  │  Store           │  │
│  │  (httpx)      │  │  (sgp4)      │  │  (aiosqlite)     │  │
│  └───────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

### Backend
* **Python 3.11+**
* **FastAPI 0.111+** (REST API + WebSocket server)
* **LangGraph 1.x** (Multi-agent orchestration + interrupt/checkpoint)
* **sgp4 2.23+** (Orbital propagation - Brandon Rhodes)
* **numpy & scipy** (Vector math & bounded optimization)
* **Groq** (`openai/gpt-oss-120b`, agent reasoning, behind a deterministic guardrail)
* **SQLite / aiosqlite** (State persistence + LangGraph checkpoints)

### OrbitMind (Onboard Reflex)
* **PyTorch + Ultralytics YOLO26** (target detection, ESA SPEED+ Tango)
* **MobileNetV3** (6-DOF pose estimation head)
* **OpenCV** (PnP pose solve + frame pipeline)

### Frontend
* **React 18+** (via Vite for fast HMR)
* **Three.js & @react-three/fiber** (3D globe rendering)
* **satellite.js** (SGP4 propagation in browser)
* **TailwindCSS & Zustand** (Styling & optimized state management)

---

## ⚙️ Setup

### Backend
```bash
git clone <repo>
cd spaceatc/backend
pip install -r requirements.txt
cp ../.env.example ../.env
# IMPORTANT: Add your GROQ_API_KEY to .env before starting
uvicorn main:app --reload --port 7860
```

### Frontend
```bash
cd spaceatc/frontend
npm install
npm run dev
# Open http://localhost:5173
```

### Run Demo
```bash
# With both servers running, trigger the demo injection:
curl -X POST http://localhost:7860/api/demo/inject

# The globe will auto-zoom to the conjunction.
# Click APPROVE in the browser when the HITL panel appears to execute the maneuver.
```

---

## 🔭 Future Scope
* **RL-based bid optimization:** Move beyond deterministic equations to train Reinforcement Learning models for multi-objective optimization (fuel vs risk).
* **OrbitMind on real hardware:** Port the onboard reflex (currently demonstrated on SPEED+ benchmark imagery) to an ARM64 flight-compute target (<6 GB), with the deterministic guardrail as the flight-safety boundary.
* **Multi-operator trust framework:** Cryptographic signing of negotiation bids and maneuver commitments.
* **Integration with LeoLabs:** Plugging directly into commercial tracking radar feeds.

---

## 👥 Team
**ClauseZero** | FAR AWAY 2026  
*Track: Space & Aerospace + Agentic & Autonomous Systems*

[![GitHub](https://img.shields.io/badge/GitHub-nilaysureka-181717?style=flat-square&logo=github)](https://github.com/nilaysureka)
[![GitHub](https://img.shields.io/badge/GitHub-Rishet11-181717?style=flat-square&logo=github)](https://github.com/Rishet11)
[![GitHub](https://img.shields.io/badge/GitHub-Parv7J-181717?style=flat-square&logo=github)](https://github.com/Parv7-J)
[![GitHub](https://img.shields.io/badge/GitHub-RaghavMadan07-181717?style=flat-square&logo=github)](https://github.com/RaghavMadan07)
