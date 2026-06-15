
# SpaceATC 🛰️

Multi-agent autonomous satellite collision avoidance negotiation system.

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://reactjs.org/)
[![Three.js](https://img.shields.io/badge/threejs-black?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)

## 🚀 Problem

SpaceX launched the Stargaze tracking system on January 29, 2026. It collects 30 million object observations per day across the Starlink fleet, generating Conjunction Data Messages (CDMs) and sending them to operators in minutes instead of hours. 

**What Stargaze does:** Tells two operators "you are going to collide."  
**What Stargaze does NOT do:** Tell them who maneuvers, by how much, or by when. 

Two operators receive a CDM simultaneously and independently decide what to do. The uncoordinated handoff is the critical gap in modern spaceflight safety. With a projected 1 million collision avoidance maneuvers per year by 2027, an uncoordinated system invites disaster.

## 💡 Solution

SpaceATC fills the uncoordinated handoff gap. It is a multi-agent autonomous negotiation system that automatically coordinates maneuver decisions between competing satellite operators. Using true orbital physics (SGP4 and Clohessy-Wiltshire relative-motion equations) mapped to LangGraph autonomous agents, SpaceATC proposes, scores, and selects optimal collision avoidance burns (delta-V). It features a real-time, WebGL-powered 3D visualization platform with a Human-In-The-Loop (HITL) approval dashboard.

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
                               │  ws://localhost:8000/ws
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
* **LangGraph 0.2+** (Multi-agent orchestration)
* **sgp4 2.23+** (Orbital propagation - Brandon Rhodes)
* **numpy & scipy** (Vector math & bounded optimization)
* **SQLite / aiosqlite** (State persistence)

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
# IMPORTANT: Add your GEMINI_API_KEY to .env before starting
uvicorn main:app --reload --port 8000
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
curl -X POST http://localhost:8000/api/demo/inject

# The globe will auto-zoom to the conjunction.
# Click APPROVE in the browser when the HITL panel appears to execute the maneuver.
```

---

## 🔭 Future Scope
* **RL-based bid optimization:** Move beyond deterministic equations to train Reinforcement Learning models for multi-objective optimization (fuel vs risk).
* **Untracked debris reflex layer:** Sub-agent architecture designed specifically for <5cm uncatalogued debris evasion.
* **Multi-operator trust framework:** Cryptographic signing of negotiation bids and maneuver commitments.
* **Integration with LeoLabs:** Plugging directly into commercial tracking radar feeds.

---

## 👥 Team
**ClauseZero** | FAR AWAY 2026  
*Track: Space & Aerospace + Agentic & Autonomous Systems*
