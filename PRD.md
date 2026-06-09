# SpaceATC — Product Requirements Document
**FAR AWAY 2026 | Internal | Tracks: Space & Aerospace + Agentic & Autonomous Systems**
**Version 1.0 | June 2026 | Build deadline: June 14, 2026**

---

## 0. Read This First

This PRD is written for AI coding agents (Claude Code, Codex) and human developers. Every section is implementation-ready. Do not invent schemas, endpoints, or data formats — follow exactly what is specified here. If something is ambiguous, check the Demo Script in Section 10 first, then the architecture diagram in Section 4.

**The single most important constraint:** The demo must show real satellite names (STARLINK-XXXX) from real CelesTrak data, autonomous agent negotiation happening visibly, and a collision probability drop. Everything else is secondary.

---

## 1. One-Line Description

SpaceATC is a multi-agent autonomous negotiation system that resolves satellite conjunction events by coordinating maneuver decisions between competing satellite operators — the coordination layer that SpaceX's Stargaze (launched Jan 2026) explicitly does not provide.

---

## 2. The Problem (Exact Pitch Language)

SpaceX launched Stargaze on January 29, 2026. It collects 30 million object observations per day from 30,000 star trackers across the Starlink fleet. It generates Conjunction Data Messages (CDMs) and sends them to operators in minutes instead of hours.

**What Stargaze does:** Tells two operators "you are going to collide."

**What Stargaze does NOT do:** Tell them who maneuvers, by how much, or by when. Two operators receive a CDM simultaneously. They each independently decide what to do. SpaceX's own announcement states: *"If observations of the third-party satellite were less frequent, conjunction screening took longer, or the reaction required human approval, such an event might not have been successfully mitigated."*

The uncoordinated handoff is the gap. SpaceATC fills it.

**Numbers that matter:**
- Starlink performed ~144,000 collision avoidance maneuvers in a 5-month period in 2024-2025
- Projected 1 million maneuvers/year by 2027 (Space Sustainability Rating, WEF)
- $11.1 billion in projected satellite losses from uncoordinated conjunctions (WEF 2025)
- 43,000+ tracked objects in LEO, ~1.2 million untracked fragments 1-10cm
- Kessler Syndrome threshold: a single chain reaction renders entire orbital shells permanently unusable

---

## 3. Tech Stack

### Backend
```
Python           3.11+
FastAPI          0.111+          REST API + WebSocket server
LangGraph        0.2+            Multi-agent orchestration
sgp4             2.23+           Orbital propagation (Brandon Rhodes)
numpy            1.26+           Vector math
scipy            1.13+           Optimization (binary search on delta-V)
httpx            0.27+           Async HTTP for CelesTrak
uvicorn          0.30+           ASGI server
python-dotenv    1.0+            Environment variables
pydantic         2.7+            Request/response schemas
```

### Frontend
```
React            18+             (via Vite, NOT Next.js — faster setup)
Three.js         0.165+          3D globe rendering
satellite.js     4.1+            SGP4 propagation in browser (npm: satellite.js)
@react-three/fiber 8+            React bindings for Three.js
@react-three/drei 9+             Three.js helpers (OrbitControls, etc.)
tailwindcss      3.4+            Styling
zustand          4.5+            Frontend state management
```

### Infrastructure
```
SQLite           (via aiosqlite)  State persistence for demo
Redis            OPTIONAL         WebSocket pub/sub (skip for MVP, use in-process)
```

### Data Sources
```
CelesTrak OMM JSON API    No auth required    Satellite TLE/OMM data
Space-Track.org           Free account        Backup TLE source (register NOW — 24-48h)
```

---

## 4. Architecture

```
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

## 5. Repository Structure

```
spaceatc/
├── README.md
├── .env.example
├── .gitignore
├── requirements.txt
├── package.json                    # root for frontend dependencies
│
├── backend/
│   ├── main.py                     # FastAPI app entry point
│   ├── config.py                   # Settings, env vars
│   ├── requirements.txt
│   │
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── graph.py                # LangGraph graph definition
│   │   ├── state.py                # AgentState TypedDict
│   │   ├── nodes/
│   │   │   ├── __init__.py
│   │   │   ├── tle_ingestion.py    # Fetch + parse CelesTrak data
│   │   │   ├── conjunction_detector.py
│   │   │   ├── negotiation_coordinator.py
│   │   │   ├── operator_agent.py   # Bid generator (shared for all operators)
│   │   │   ├── hitl_node.py        # Human-in-the-loop interrupt
│   │   │   └── maneuver_executor.py
│   │   └── prompts/
│   │       ├── operator_system.txt
│   │       └── coordinator_system.txt
│   │
│   ├── orbital/
│   │   ├── __init__.py
│   │   ├── tle_client.py           # CelesTrak HTTP client
│   │   ├── propagator.py           # SGP4 wrapper (python-sgp4)
│   │   ├── conjunction.py          # TCA + miss distance + Pc calculation
│   │   └── maneuver.py             # Minimum delta-V calculator
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py               # REST endpoints
│   │   ├── websocket.py            # WebSocket handler
│   │   └── schemas.py              # Pydantic models
│   │
│   └── db/
│       ├── __init__.py
│       └── store.py                # SQLite state persistence
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   │
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── store/
│       │   └── useSpaceStore.ts    # Zustand store
│       ├── components/
│       │   ├── Globe/
│       │   │   ├── Globe.tsx       # Three.js Earth globe
│       │   │   ├── SatelliteLayer.tsx
│       │   │   ├── OrbitLine.tsx
│       │   │   └── ConjunctionMarker.tsx
│       │   ├── EventFeed/
│       │   │   ├── EventFeed.tsx
│       │   │   └── EventItem.tsx
│       │   ├── HITLPanel/
│       │   │   ├── HITLPanel.tsx
│       │   │   └── ManeuverCard.tsx
│       │   ├── MetricsBar/
│       │   │   └── MetricsBar.tsx
│       │   └── StatusBadge.tsx
│       ├── hooks/
│       │   ├── useWebSocket.ts
│       │   └── useSatellites.ts
│       └── types/
│           └── index.ts
│
└── demo/
    ├── README.md
    ├── synthetic_conjunction.json  # Pre-crafted TLE pair for demo
    └── demo_script.md              # Exact steps for live demo
```

---

## 6. Data Schemas

### 6.1 CelesTrak OMM JSON Response (single object)
```json
{
  "CCSDS_OMM_VERS": "2.0",
  "OBJECT_NAME": "STARLINK-1234",
  "OBJECT_ID": "2020-001A",
  "NORAD_CAT_ID": "45178",
  "MEAN_MOTION": 15.32487,
  "ECCENTRICITY": 0.00015,
  "INCLINATION": 53.0538,
  "RA_OF_ASC_NODE": 202.5644,
  "ARG_OF_PERICENTER": 89.3412,
  "MEAN_ANOMALY": 270.9873,
  "EPOCH": "2026-06-10T12:34:56.789012",
  "BSTAR": 0.00012,
  "MEAN_MOTION_DOT": 0.000001234,
  "MEAN_MOTION_DDOT": 0.0
}
```
**Endpoint:** `https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=JSON`
**No auth required.** Returns array of OMM objects.

### 6.2 Satellite Internal Model
```python
@dataclass
class Satellite:
    norad_id: str
    name: str
    operator: str           # "SpaceX", "OneWeb", "AST", "Demo_A", "Demo_B"
    omm: dict               # Raw OMM dict from CelesTrak
    satrec: Any             # sgp4 Satrec object (from twoline2rv or parse)
    fuel_units: float       # Simulated fuel budget (100.0 = full)
    maneuver_count: int     # Historical maneuver count (affects bid priority)
```

### 6.3 Conjunction Event
```python
@dataclass
class ConjunctionEvent:
    event_id: str           # UUID
    sat_primary: Satellite
    sat_secondary: Satellite
    tca: datetime           # Time of Closest Approach
    miss_distance_km: float # Miss distance at TCA
    pc: float               # Collision probability (0.0 to 1.0)
    relative_velocity_km_s: float
    status: str             # "detected" | "negotiating" | "pending_hitl" | "resolved" | "vetoed"
    created_at: datetime
    resolved_at: Optional[datetime]
```

### 6.4 Maneuver Proposal (Bid)
```python
@dataclass
class ManeuverProposal:
    proposal_id: str
    event_id: str
    operator: str
    satellite_name: str
    delta_v_ms: float       # Minimum delta-V in m/s to resolve conjunction
    burn_direction: str     # "prograde" | "retrograde" | "radial"
    burn_time: datetime     # When to execute
    post_maneuver_pc: float # Expected Pc after maneuver
    post_maneuver_miss_km: float
    fuel_cost_units: float  # Fuel units consumed
    bid_score: float        # Lower is better (combines delta_v + maneuver_count penalty)
```

### 6.5 WebSocket Message Format
All WebSocket messages follow this envelope:
```typescript
interface WSMessage {
  type: "satellite_update" | "conjunction_detected" | "negotiation_update" 
      | "hitl_request" | "maneuver_executed" | "metrics_update" | "system_status";
  timestamp: string;  // ISO 8601
  payload: Record<string, unknown>;
}
```

#### Message Types:

**satellite_update** (every 5 seconds, batched)
```typescript
{
  type: "satellite_update",
  payload: {
    satellites: Array<{
      norad_id: string;
      name: string;
      operator: string;
      position: { x: number; y: number; z: number };  // ECI km
      lat: number; lon: number; alt_km: number;
      is_highlighted: boolean;
    }>
  }
}
```

**conjunction_detected**
```typescript
{
  type: "conjunction_detected",
  payload: {
    event_id: string;
    sat_primary: string;     // satellite name
    sat_secondary: string;
    tca_iso: string;
    miss_distance_km: number;
    pc: number;
    relative_velocity_km_s: number;
  }
}
```

**negotiation_update**
```typescript
{
  type: "negotiation_update",
  payload: {
    event_id: string;
    stage: "bids_requested" | "bids_received" | "winner_selected";
    proposals: Array<{
      operator: string;
      satellite: string;
      delta_v_ms: number;
      bid_score: number;
    }>;
    winner?: string;  // operator name if stage === "winner_selected"
  }
}
```

**hitl_request**
```typescript
{
  type: "hitl_request",
  payload: {
    event_id: string;
    proposal: {
      satellite_name: string;
      operator: string;
      delta_v_ms: number;
      burn_direction: string;
      burn_time: string;
      post_maneuver_pc: number;
      post_maneuver_miss_km: number;
    };
    timeout_seconds: number;  // 30 for demo
  }
}
```

**maneuver_executed**
```typescript
{
  type: "maneuver_executed",
  payload: {
    event_id: string;
    satellite_name: string;
    delta_v_ms: number;
    pc_before: number;
    pc_after: number;
    miss_km_before: number;
    miss_km_after: number;
    approved_by: "human";
  }
}
```

---

## 7. Backend API Endpoints

### REST
```
GET  /health                          Health check
GET  /api/satellites                  List all tracked satellites with current positions
GET  /api/conjunctions                List all conjunction events (active + resolved)
GET  /api/conjunctions/{event_id}     Get single conjunction event detail
POST /api/demo/inject                 Inject a synthetic conjunction for demo
POST /api/demo/reset                  Reset demo state
POST /api/hitl/{event_id}/approve     Human approves maneuver proposal
POST /api/hitl/{event_id}/veto        Human vetoes maneuver proposal
GET  /api/metrics                     System metrics (total events, resolved %, avg delta-V)
```

### WebSocket
```
WS /ws                                Main real-time channel
```

---

## 8. Orbital Engine — Key Algorithms

### 8.1 TLE/OMM Ingestion

```python
# backend/orbital/tle_client.py

CELESTRAK_STARLINK = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=JSON"
CELESTRAK_ACTIVE   = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON"

async def fetch_tle_group(url: str) -> list[dict]:
    """Fetch OMM JSON from CelesTrak. Returns list of OMM dicts."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()

def parse_omm_to_satrec(omm: dict) -> Satrec:
    """Parse CelesTrak OMM JSON dict to sgp4 Satrec object."""
    # sgp4 >= 2.23 supports dict-based OMM parsing
    satrec = Satrec()
    satrec.sgp4init(
        WGS84,
        'i',                                  # opsmode
        int(omm['NORAD_CAT_ID']),
        ...                                   # see sgp4 docs for full parameter list
    )
    return satrec
```

**IMPORTANT NOTE:** Use `sgp4.api.Satrec.twoline2rv()` for TLE string parsing, OR use the newer OMM dict parsing with `sgp4.conveniences.sat_epoch_datetime()`. Check the latest python-sgp4 docs — the API changed in 2.22. The simplest approach for demo: download as TLE format (3LE) and use `twoline2rv`.

```python
# Simpler alternative: request TLE format and use classic parse
CELESTRAK_STARLINK_TLE = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=TLE"

def parse_tle_block(tle_text: str) -> list[tuple[str, Satrec]]:
    """Parse multi-satellite 3LE block."""
    lines = tle_text.strip().split('\n')
    satellites = []
    for i in range(0, len(lines) - 2, 3):
        name = lines[i].strip()
        line1 = lines[i+1].strip()
        line2 = lines[i+2].strip()
        satrec = Satrec.twoline2rv(line1, line2)
        satellites.append((name, satrec))
    return satellites
```

### 8.2 Position Propagation

```python
# backend/orbital/propagator.py

from sgp4.api import Satrec, jday
from datetime import datetime, timezone

def propagate_at(satrec: Satrec, dt: datetime) -> tuple[list[float], list[float]]:
    """
    Propagate satellite to given datetime.
    Returns (position_km_ECI, velocity_km_s_ECI) as [x, y, z] lists.
    Returns (None, None) on error.
    """
    jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)
    e, r, v = satrec.sgp4(jd, fr)
    if e != 0:
        return None, None
    return list(r), list(v)

def eci_to_geodetic(pos_eci: list[float], dt: datetime) -> tuple[float, float, float]:
    """Convert ECI position to lat/lon/alt for globe display."""
    # Use sgp4's built-in coordinate transform
    # or implement simple GMST rotation
    from sgp4.earth_gravity import wgs84
    # ... implementation
```

### 8.3 Conjunction Detection (TCA + Miss Distance)

```python
# backend/orbital/conjunction.py

import numpy as np
from datetime import datetime, timedelta
from scipy.optimize import minimize_scalar

def compute_separation(sat1: Satrec, sat2: Satrec, dt: datetime) -> float:
    """Return separation in km between two satellites at time dt."""
    r1, _ = propagate_at(sat1, dt)
    r2, _ = propagate_at(sat2, dt)
    if r1 is None or r2 is None:
        return float('inf')
    return np.linalg.norm(np.array(r1) - np.array(r2))

def find_tca(sat1: Satrec, sat2: Satrec, 
             t_start: datetime, t_end: datetime,
             resolution_seconds: int = 60) -> tuple[datetime, float]:
    """
    Find Time of Closest Approach (TCA) between t_start and t_end.
    Returns (tca_datetime, miss_distance_km).
    
    Algorithm:
    1. Coarse scan: evaluate separation every `resolution_seconds`
    2. Find minimum separation window
    3. Fine optimization with scipy.optimize.minimize_scalar in that window
    """
    # Coarse scan
    times = [t_start + timedelta(seconds=i) for i in range(0, int((t_end-t_start).total_seconds()), resolution_seconds)]
    separations = [compute_separation(sat1, sat2, t) for t in times]
    min_idx = np.argmin(separations)
    
    # Refine around minimum
    if min_idx == 0 or min_idx == len(times) - 1:
        return times[min_idx], separations[min_idx]
    
    t_low = times[max(0, min_idx - 1)]
    t_high = times[min(len(times) - 1, min_idx + 1)]
    
    def objective(seconds_offset):
        t = t_low + timedelta(seconds=float(seconds_offset))
        return compute_separation(sat1, sat2, t)
    
    result = minimize_scalar(
        objective,
        bounds=(0, (t_high - t_low).total_seconds()),
        method='bounded'
    )
    
    tca = t_low + timedelta(seconds=float(result.x))
    return tca, float(result.fun)

def compute_pc_simplified(miss_distance_km: float, 
                           relative_velocity_km_s: float,
                           combined_radius_km: float = 0.01) -> float:
    """
    Simplified Pc calculation for demo purposes.
    Uses 1D Gaussian approximation.
    
    Real Pc requires covariance matrices (not available from TLE alone).
    For demo, we use a conservative position uncertainty of 1km (TLE typical accuracy).
    
    Returns Pc as float (0 to 1).
    """
    sigma = 1.0  # km, TLE position uncertainty (conservative)
    # 2D Gaussian encounter probability
    pc = np.exp(-0.5 * (miss_distance_km / sigma) ** 2) * (combined_radius_km / sigma) ** 2 * np.pi
    return min(max(pc, 0.0), 1.0)

# SCREENING THRESHOLDS
SCREENING_DISTANCE_KM = 5.0       # Initial screening: flag pairs within 5km
PC_ALERT_THRESHOLD = 1e-4         # Maneuver threshold (industry standard)
PC_SAFE_THRESHOLD = 1e-6          # Target Pc after maneuver

def screen_constellation(satellites: list, 
                          t_start: datetime,
                          t_end: datetime) -> list[ConjunctionEvent]:
    """
    Screen all satellite pairs for conjunctions.
    Returns list of ConjunctionEvent objects above PC_ALERT_THRESHOLD.
    
    OPTIMIZATION NOTE: For demo, only screen a subset (50-100 satellites).
    Full constellation screening takes minutes — not suitable for demo.
    """
```

### 8.4 Maneuver Calculator (Minimum Delta-V)

```python
# backend/orbital/maneuver.py

import numpy as np
from datetime import datetime, timedelta

def compute_minimum_delta_v(
    sat_maneuvering: Satrec,
    sat_other: Satrec,
    tca: datetime,
    target_pc: float = 1e-6,
    burn_lead_time_minutes: int = 60
) -> ManeuverProposal:
    """
    Calculate minimum delta-V for along-track burn to resolve conjunction.
    
    Method: Binary search on delta-V magnitude.
    Direction: Along-track (prograde or retrograde, whichever requires less delta-V).
    Burn time: `burn_lead_time_minutes` before TCA.
    
    Returns ManeuverProposal with minimum delta-V and expected post-maneuver metrics.
    
    Simplified model:
    - Apply velocity perturbation to sat_maneuvering at burn_time
    - Re-propagate to find new TCA and miss distance
    - Iterate until Pc < target_pc
    
    NOTE: This is NOT a precision maneuver planner. It is a negotiation input —
    the goal is to find a reasonable delta-V estimate that agents can bid on.
    """
    burn_time = tca - timedelta(minutes=burn_lead_time_minutes)
    
    # Get position and velocity at burn time
    pos_burn, vel_burn = propagate_at(sat_maneuvering, burn_time)
    if pos_burn is None:
        return None
    
    vel_array = np.array(vel_burn)
    vel_magnitude = np.linalg.norm(vel_array)
    prograde = vel_array / vel_magnitude  # Unit vector in velocity direction
    
    # Binary search on delta-V magnitude
    dv_min, dv_max = 0.001, 2.0  # m/s bounds
    
    def compute_pc_after_dv(dv_ms: float, direction: np.ndarray) -> tuple[float, float]:
        """Apply delta-V and compute new Pc."""
        # Convert m/s to km/s
        dv_km_s = dv_ms / 1000.0
        
        # Create perturbed satrec
        # APPROACH: Since we can't easily modify satrec mid-flight,
        # use relative motion approximation (Clohessy-Wiltshire).
        # For demo purposes, approximate using phase shift.
        
        # Simple approximation: along-track dV changes orbital period
        # Delta-T_phase = -(3 * pi * dV) / (n * V) where n = mean motion, V = velocity
        v_km_s = vel_magnitude  # km/s
        
        # Mean motion n = 2*pi/T (rad/s), for LEO roughly 0.00114 rad/s
        # Period T ≈ 2*pi*sqrt(a^3/mu), for 550km LEO ≈ 5730s
        T_orbit = 5730.0  # seconds, approximate for LEO
        n = 2 * np.pi / T_orbit
        
        # Phase shift at TCA from along-track burn
        lead_time_s = burn_lead_time_minutes * 60
        delta_pos_along = (dv_km_s / v_km_s) * (3/2) * n * lead_time_s * lead_time_s
        # This gives approximate range separation in km
        
        # Simplified: new miss distance is old miss distance + delta_pos_along (vector decomposition)
        # For demo: treat as additive to along-track component of miss
        # Real implementation would re-propagate with perturbed state
        new_miss_estimate = abs(delta_pos_along)  # Very simplified
        
        new_pc = compute_pc_simplified(new_miss_estimate, 0.0)
        return new_pc, new_miss_estimate
    
    # Find minimum dV for prograde burn
    for _ in range(20):  # Binary search iterations
        dv_mid = (dv_min + dv_max) / 2
        pc_after, miss_after = compute_pc_after_dv(dv_mid, prograde)
        if pc_after <= target_pc:
            dv_max = dv_mid
        else:
            dv_min = dv_mid
    
    best_dv = (dv_min + dv_max) / 2
    final_pc, final_miss = compute_pc_after_dv(best_dv, prograde)
    
    return {
        'delta_v_ms': best_dv,
        'burn_direction': 'prograde',
        'burn_time': burn_time,
        'post_maneuver_pc': final_pc,
        'post_maneuver_miss_km': final_miss,
    }
```

**IMPLEMENTATION NOTE FOR RAGHAV:** The `compute_pc_after_dv` function above is a placeholder approximation. The real implementation should use the Clohessy-Wiltshire equations for relative motion in the Hill frame. The CW equations give exact relative position/velocity evolution for a deputy satellite relative to a chief. This is Raghav's module. See Section 11 (Team Assignments) for the exact interface contract.

---

## 9. Agent System (LangGraph)

### 9.1 State Schema

```python
# backend/agents/state.py

from typing import TypedDict, Optional
from dataclasses import dataclass

class AgentState(TypedDict):
    # Lifecycle
    session_id: str
    phase: str  # "idle" | "ingesting" | "screening" | "negotiating" | "pending_hitl" | "resolved"
    
    # Data
    satellites: list[dict]          # List of Satellite dicts
    active_conjunctions: list[dict] # List of ConjunctionEvent dicts
    
    # Negotiation
    current_event_id: Optional[str]
    proposals: list[dict]           # List of ManeuverProposal dicts
    winning_proposal: Optional[dict]
    
    # HITL
    hitl_decision: Optional[str]    # "approve" | "veto" | None
    hitl_timeout: bool
    
    # Output
    messages: list[str]             # Human-readable log for EventFeed
    websocket_events: list[dict]    # Queued WS messages to broadcast
```

### 9.2 Graph Definition

```python
# backend/agents/graph.py

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import interrupt

from .nodes import (
    ingest_tle,
    detect_conjunctions,
    coordinate_negotiation,
    generate_operator_bid,
    await_hitl,
    execute_maneuver,
)
from .state import AgentState

def build_graph(checkpointer) -> CompiledGraph:
    graph = StateGraph(AgentState)
    
    # Add nodes
    graph.add_node("ingest_tle", ingest_tle)
    graph.add_node("detect_conjunctions", detect_conjunctions)
    graph.add_node("coordinate_negotiation", coordinate_negotiation)
    graph.add_node("generate_bids", generate_operator_bid)
    graph.add_node("await_hitl", await_hitl)
    graph.add_node("execute_maneuver", execute_maneuver)
    
    # Edges
    graph.add_edge(START, "ingest_tle")
    graph.add_edge("ingest_tle", "detect_conjunctions")
    graph.add_conditional_edges(
        "detect_conjunctions",
        lambda state: "coordinate_negotiation" if state["active_conjunctions"] else END,
    )
    graph.add_edge("coordinate_negotiation", "generate_bids")
    graph.add_edge("generate_bids", "await_hitl")
    graph.add_conditional_edges(
        "await_hitl",
        lambda state: "execute_maneuver" if state["hitl_decision"] == "approve" else END,
    )
    graph.add_edge("execute_maneuver", END)
    
    return graph.compile(checkpointer=checkpointer, interrupt_before=["await_hitl"])
```

### 9.3 Node Implementations

```python
# backend/agents/nodes/tle_ingestion.py

async def ingest_tle(state: AgentState) -> AgentState:
    """
    Fetch current Starlink TLE data from CelesTrak.
    For demo: fetch a subset (100 satellites max, filtered by orbital shell).
    Update state.satellites.
    Queue "system_status" WebSocket message.
    """
    ...

# backend/agents/nodes/conjunction_detector.py

async def detect_conjunctions(state: AgentState) -> AgentState:
    """
    Screen satellite pairs for conjunctions in the next 24 hours.
    For demo: screen only pairs from different simulated operators within 10km initial filter.
    Use find_tca() and compute_pc_simplified().
    If Pc > PC_ALERT_THRESHOLD: add to state.active_conjunctions.
    Queue "conjunction_detected" WebSocket message.
    """
    ...

# backend/agents/nodes/negotiation_coordinator.py

async def coordinate_negotiation(state: AgentState) -> AgentState:
    """
    For the most critical conjunction (highest Pc):
    1. Log which operators are involved
    2. Request bids from both operator agents
    3. Queue "negotiation_update" (stage: "bids_requested") WebSocket message
    """
    ...

# backend/agents/nodes/operator_agent.py

async def generate_operator_bid(state: AgentState) -> AgentState:
    """
    For each operator involved in the current conjunction:
    1. Call compute_minimum_delta_v() 
    2. Compute bid_score = delta_v_ms + (maneuver_count * 0.1)  # penalize frequent maneuverers
    3. Lower bid_score wins (operator with lower cost and fewer maneuvers goes first)
    4. Select winner (lowest bid_score)
    5. Queue "negotiation_update" (stage: "winner_selected") WebSocket message
    """
    ...

# backend/agents/nodes/hitl_node.py

async def await_hitl(state: AgentState) -> AgentState:
    """
    Uses LangGraph interrupt() to pause execution for human approval.
    Queue "hitl_request" WebSocket message with winning proposal.
    Human calls POST /api/hitl/{event_id}/approve or /veto.
    Resume via graph.update_state() with hitl_decision.
    """
    interrupt("Awaiting human approval for maneuver proposal")
    ...

# backend/agents/nodes/maneuver_executor.py

async def execute_maneuver(state: AgentState) -> AgentState:
    """
    Apply the winning maneuver to the maneuvering satellite's TLE.
    Recalculate Pc to confirm it drops below PC_SAFE_THRESHOLD.
    Queue "maneuver_executed" WebSocket message.
    Log resolution.
    """
    ...
```

### 9.4 Simulated Operators

For the demo, assign operator labels to satellite groups:

```python
OPERATOR_GROUPS = {
    "SpaceX": ["STARLINK-"],          # Starlink satellites
    "OneWeb": ["ONEWEB-"],            # OneWeb satellites  
    "Demo_A": ["DEMO-SAT-A"],         # Synthetic satellite for demo
    "Demo_B": ["DEMO-SAT-B"],         # Synthetic satellite for demo
}

# For demo injection (POST /api/demo/inject):
# Create two synthetic satellites with TLEs engineered to produce a
# conjunction at T+2 minutes from injection time. Use real orbital parameters
# but offset mean anomaly to create a near-miss at known time.
```

---

## 10. Frontend

### 10.1 Globe Component

```typescript
// frontend/src/components/Globe/Globe.tsx

// Use @react-three/fiber + Three.js
// Earth texture: use free NASA Blue Marble texture
// Reference: https://github.com/dsuarezv/satellite-tracker (Three.js + satellite.js)

// Key implementation:
// 1. Earth sphere with texture
// 2. Satellite positions from WebSocket updates (ECI coords → screen coords)  
// 3. Orbit trail lines (last 30 positions per satellite)
// 4. Conjunction zone: red pulsing sphere at midpoint between two satellites
// 5. Highlighted satellites (conjunction pair): bright white, larger dot

// satellite.js (npm) for ECI → geodetic conversion
import * as satellite from 'satellite.js';

// ECI to ECEF to lat/lon/alt
function eciToGlobe(pos: {x: number, y: number, z: number}, time: Date): [number, number, number] {
  const gmst = satellite.gstime(time);
  const ecef = satellite.eciToEcf(pos, gmst);
  const geodetic = satellite.eciToGeodetic(pos, gmst);
  // Convert to Three.js sphere coordinates
  const lat = satellite.radiansToDegrees(geodetic.latitude);
  const lon = satellite.radiansToDegrees(geodetic.longitude);
  const alt = geodetic.height;
  return latLonAltToXYZ(lat, lon, alt, 1.0 + alt/6371);
}
```

### 10.2 HITL Panel

```typescript
// frontend/src/components/HITLPanel/HITLPanel.tsx
// Appears when type === "hitl_request" WebSocket message received
// Shows:
//   - Satellite name and operator
//   - Current Pc (red number)
//   - Proposed delta-V in m/s
//   - Expected post-maneuver Pc (green number)
//   - "APPROVE MANEUVER" button (green, large)
//   - "VETO" button (red, smaller)
//   - Countdown timer (30 seconds)
```

### 10.3 Metrics Bar

Always visible at top of screen. Shows:
```
Active Satellites: [N]  |  Conjunctions Detected: [N]  |  Resolved: [N]  |  
Maneuvers Executed: [N]  |  Total delta-V saved: [X.XX m/s]  |  System: ACTIVE
```

### 10.4 Event Feed

Right sidebar. Scrolling log of agent actions. Each item has:
- Timestamp
- Agent icon (TLE Ingestion / Conjunction Detector / Operator A / Operator B / HITL / System)
- Message text
- Color coding by severity

---

## 11. Team Assignments

### Rishet (Tech Lead)
**Day 1-2:**
- Set up repo, README, .gitignore
- FastAPI app skeleton (main.py, routes, WebSocket handler)
- CelesTrak HTTP client (tle_client.py) — test with curl first
- LangGraph graph skeleton (graph.py, state.py, stub nodes)
- WebSocket broadcast system

**Day 3-4:**
- Conjunction detection integration (calling Raghav's module)
- LangGraph negotiation flow (coordinate_negotiation, generate_operator_bid)
- HITL interrupt + resume via API
- REST endpoints for HITL (approve/veto)
- Demo injection endpoint

**Day 5:**
- Frontend integration
- WebSocket message handling in React
- Demo rehearsal + bug fixes

**Day 6:**
- Pre-recorded demo video
- README polish
- GitHub commit hygiene check

### Raghav (Orbital Math)
**Owns:** `backend/orbital/` entirely.

**Interface contract (LOCKED — do not change):**

```python
# Input
@dataclass
class ConjunctionInput:
    sat1_satrec: Any       # sgp4 Satrec object
    sat2_satrec: Any       # sgp4 Satrec object  
    t_start: datetime      # Search window start (UTC)
    t_end: datetime        # Search window end (UTC)

# Output
@dataclass
class ConjunctionOutput:
    tca: datetime              # Time of Closest Approach
    miss_distance_km: float    # Miss distance at TCA
    pc: float                  # Collision probability
    relative_velocity_km_s: float

# Maneuver calculation input
@dataclass  
class ManeuverInput:
    sat_maneuvering_satrec: Any   # Satellite that will maneuver
    sat_other_satrec: Any         # Satellite that holds position
    tca: datetime                 # TCA from conjunction detection
    burn_lead_time_minutes: int   # Default: 60

# Maneuver calculation output
@dataclass
class ManeuverOutput:
    delta_v_ms: float             # Minimum delta-V in m/s
    burn_direction: str           # "prograde" | "retrograde"
    burn_time: datetime
    post_maneuver_pc: float
    post_maneuver_miss_km: float

# Functions Raghav implements:
def find_tca(input: ConjunctionInput) -> ConjunctionOutput: ...
def compute_minimum_delta_v(input: ManeuverInput) -> ManeuverOutput: ...
```

**Raghav's Day 1 task:** Implement `find_tca()` using python-sgp4 + binary search. Test with two Starlink TLEs from CelesTrak.

**Raghav's Day 2-3 task:** Implement `compute_minimum_delta_v()` using Clohessy-Wiltshire relative motion equations. Validate output is physically reasonable (expected range: 0.01 to 1.0 m/s for LEO conjunctions).

**CW equation reference:**
```
Hill's equations (CW) for relative motion:
x'' - 2n*y' - 3n²x = 0
y'' + 2n*x' = 0
z'' + n²z = 0

Where:
- (x,y,z) = relative position in Hill frame (radial, along-track, cross-track)
- n = mean motion of reference orbit (rad/s)
- ' = time derivative

For along-track burn at time t_burn, separation at t_CA:
Δx(t) = (4-3cos(n*t))*Δx₀ + sin(n*t)/n*Δvx₀ + 2*(1-cos(n*t))/n*Δvy₀
Δy(t) = 6*(sin(n*t)-n*t)*Δx₀ + ... + (4*sin(n*t)-3n*t)*Δvy₀/n
```

### Parv (Research + Agent Prompts)
**Day 1:** Write system prompts for operator agents and coordinator agent
**Day 2-3:** Build demo script + synthetic conjunction JSON
**Day 4-5:** Frontend (React components, WebSocket client, styling)

### Nilay (Deck)
**Day 1-4:** Build 15-slide deck (see Section 13)
**Day 5:** Hard lock — no changes after this

---

## 12. Demo Script (Exact 45-Second Sequence)

This is the canonical demo. Rehearse until flawless. Pre-record as backup.

```
SCREEN STATE AT START:
- Globe showing real Starlink satellites moving in real orbits
- ~150 satellites displayed as small dots
- Metrics bar: Active Satellites: 150 | Conjunctions: 0 | Resolved: 0

[0:00] POST /api/demo/inject
       → Two satellites (DEMO-SAT-A and DEMO-SAT-B) appear on globe
       → Both highlighted in yellow
       → Event Feed: "[TLE Ingestion] Synthetic conjunction pair injected"

[0:05] Globe zooms in automatically to the conjunction region
       → Both satellites visible with orbit trails
       → Distance counter between them: 847 km... 312 km... 127 km...

[0:10] WebSocket: conjunction_detected fires
       → Red alert appears: "CONJUNCTION DETECTED"
       → Display: Miss Distance: 0.3 km | Collision Probability: 1.2 × 10⁻³
       → Event Feed: "[Detector] Conjunction: DEMO-SAT-A / DEMO-SAT-B | Pc: 0.00120 | TCA: 4:23 UTC"
       → Both satellites turn RED

[0:15] WebSocket: negotiation_update (bids_requested)
       → Event Feed: "[Coordinator] Requesting maneuver bids from operators A and B"

[0:20] WebSocket: negotiation_update (bids_received)
       → Shows both proposals:
         Operator A: DEMO-SAT-A | ΔV: 0.087 m/s | Score: 0.087
         Operator B: DEMO-SAT-B | ΔV: 0.112 m/s | Score: 0.162  ← higher (more maneuvers)
       
[0:22] WebSocket: negotiation_update (winner_selected)
       → "DEMO-SAT-A selected: minimum cost maneuver"
       → Event Feed: "[Operator A] Won bid: 0.087 m/s prograde burn"

[0:25] HITL Panel slides in on right:
       MANEUVER PROPOSAL
       Satellite: DEMO-SAT-A | Operator: Demo Corp A
       Delta-V: 0.087 m/s (prograde)
       Burn Time: 4:23 UTC (in ~58 min)
       ┌────────────────────────────────┐
       │ BEFORE    Pc: 1.2 × 10⁻³      │
       │ AFTER     Pc: 3.1 × 10⁻⁷      │
       └────────────────────────────────┘
       [APPROVE MANEUVER ✓]    [VETO ✗]
       Countdown: 29s...28s...

[0:32] Presenter clicks "APPROVE MANEUVER"

[0:33] WebSocket: maneuver_executed fires
       → DEMO-SAT-A orbit trail CHANGES on globe (new trajectory visible)
       → Both satellites turn GREEN
       → Metrics update: Collision Probability: 3.1 × 10⁻⁷ (safe)
       → Large green text: "CONJUNCTION RESOLVED"
       → Event Feed: "[Maneuver] DEMO-SAT-A burn executed | Pc: 1.2×10⁻³ → 3.1×10⁻⁷"
       → Metrics bar: Resolved: 1 | Total ΔV: 0.087 m/s

[0:40] Zoom out back to full globe view
       → All 150 satellites continue orbiting normally
       → System: ACTIVE
```

---

## 13. Presentation Deck (15 Slides — Nilay's Domain)

| Slide | Title | Key Content |
|---|---|---|
| 1 | Title | SpaceATC — Autonomous Satellite Collision Negotiation |
| 2 | The Crisis | 144K maneuvers/5 months. $11.1B at risk. Kessler Syndrome. |
| 3 | Stargaze Launched Jan 2026 | SpaceX solved data visibility. Quote their exact gap. |
| 4 | The Gap | CDMs land simultaneously. No coordination. Both operators decide independently. |
| 5 | What We Built | Multi-agent negotiation layer. Contract-net protocol. HITL gate. |
| 6 | Architecture | Single clean diagram from Section 4 |
| 7 | How It Works | 4-step flow: Detect → Negotiate → Propose → Human Approves |
| 8 | LIVE DEMO | Full screen — embed or link demo video |
| 9 | The Numbers | Before/after: Pc 1.2×10⁻³ → 3.1×10⁻⁷. Delta-V: 0.087 m/s |
| 10 | Tech Stack | python-sgp4. LangGraph. Three.js. Real CelesTrak data. |
| 11 | Real World | How this complements Stargaze. LeoLabs integration path. |
| 12 | Why This Matters | Japan angle: JAXA, 12,000+ Japanese-made components at risk |
| 13 | Market | $400B+ space economy growing to $1T by 2032 |
| 14 | Future Scope | RL-based negotiation. Untracked debris (acknowledge gap). Multi-operator trust layer. |
| 15 | Team + Links | GitHub link. Demo link. Team. |

**Hard deck lock: Day 5, 6pm. No changes after.**

---

## 14. Environment Variables

```bash
# .env.example
CELESTRAK_BASE_URL=https://celestrak.org/NORAD/elements/gp.php
SPACE_TRACK_USERNAME=           # Optional backup (register at space-track.org NOW)
SPACE_TRACK_PASSWORD=           # Optional backup

OPENAI_API_KEY=                 # For LLM calls in agent prompts (Claude or GPT-4o)
ANTHROPIC_API_KEY=              # Alternative to OpenAI

SQLITE_PATH=./spaceatc.db
WEBSOCKET_PING_INTERVAL=5       # seconds
TLE_REFRESH_INTERVAL=3600       # seconds (refresh every hour)

DEMO_MODE=true                  # When true: enable /api/demo/* endpoints
SCREENING_DISTANCE_KM=5.0
PC_ALERT_THRESHOLD=0.0001
PC_SAFE_THRESHOLD=0.000001
```

---

## 15. Build Timeline (6 Days)

| Day | Date | Rishet | Raghav | Parv | Nilay |
|---|---|---|---|---|---|
| **1** | Jun 9 | FastAPI skeleton + CelesTrak client + WS handler | `find_tca()` + test with real TLEs | Operator/coordinator prompts | Slides 1-7 |
| **2** | Jun 10 | LangGraph graph + stub nodes + DB | `compute_minimum_delta_v()` draft | Frontend scaffold (Vite + Three.js globe) | Slides 8-12 |
| **3** | Jun 11 | Full agent pipeline (ingest→detect→negotiate) | DeltaV validation + integration | Globe rendering + satellite dots | Slides 13-15 |
| **4** | Jun 12 | HITL interrupt + API endpoints + WS messages | Integration testing with Rishet | HITL Panel + Event Feed UI | Deck polish |
| **5** | Jun 13 | Full demo flow integration + demo injection endpoint | Bug fixes | Demo script rehearsal + pre-record | **DECK LOCK** |
| **6** | Jun 14 | README polish + GitHub hygiene + **submit** | Final tests | Submit support | - |

**CRITICAL PATH:** Raghav's `find_tca()` is blocking the conjunction detector. He must deliver by end of Day 1.

**If Raghav is blocked:** Rishet uses the placeholder `compute_pc_simplified()` from Section 8.3. The demo will use injected synthetic conjunctions. Pipeline still works.

---

## 16. Testing Checklist

### Before Each Commit
- [ ] `python -m pytest backend/tests/` passes
- [ ] CelesTrak fetch returns >50 Starlink satellites
- [ ] WebSocket connects and receives messages
- [ ] Globe renders without errors in browser

### Day 5 Demo Rehearsal Checklist
- [ ] Demo injection creates visible satellites on globe
- [ ] Conjunction detection fires within 10 seconds of injection
- [ ] Negotiation flow completes and shows both bids
- [ ] HITL panel appears correctly
- [ ] Approve button triggers maneuver execution
- [ ] Orbit trail visibly changes on globe
- [ ] Pc drops to safe level and shows in UI
- [ ] Pre-recorded video backup is flawless (watch 3 times)
- [ ] README has setup instructions someone else can follow

### Known Demo Failure Points and Mitigations
| Risk | Mitigation |
|---|---|
| CelesTrak API down | Pre-download 48h of TLE data, serve from local file |
| WebSocket disconnects | Auto-reconnect logic in frontend hook |
| Conjunction not triggering | Demo injection endpoint forces a synthetic conjunction |
| Globe performance poor | Limit to 100 satellites max, use instanced mesh for dots |
| Raghav's module not ready | Use synthetic conjunction data + placeholder Pc values |

---

## 17. Acceptance Criteria (MVP)

The following must all work for a passing submission:

1. ✅ Real Starlink TLE data loads from CelesTrak with correct satellite names
2. ✅ 3D globe displays >50 satellites in real orbital positions, updating every 5 seconds
3. ✅ Demo injection creates a visible synthetic conjunction event
4. ✅ Conjunction detection triggers with Pc > threshold and fires WebSocket event
5. ✅ Two operator agents each generate a bid with different delta-V values
6. ✅ One agent wins the bid (lower score)
7. ✅ HITL panel appears with the winning proposal
8. ✅ Approve button resumes the agent pipeline
9. ✅ Orbit trail visibly changes after maneuver execution
10. ✅ Pc drops from >1e-4 to <1e-6 and displays in UI
11. ✅ GitHub commit history shows regular commits over 5+ days (not one big commit)
12. ✅ README has: problem, solution, architecture image, setup instructions, team

**Nice-to-have (if time allows):**
- Veto flow (HITL vetoes, system logs reason)
- Multiple simultaneous conjunction events
- Real conjunction detection on actual Starlink data (without demo injection)
- Space-Track.org integration as backup data source

---

## 18. Key Reference Links

### Data Sources
- **CelesTrak Starlink:** https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=TLE
- **CelesTrak Active Sats:** https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE
- **Space-Track.org:** https://www.space-track.org/ (register NOW)
- **CelesTrak OMM format docs:** https://celestrak.org/NORAD/documentation/gp-data-formats.php

### Libraries
- **python-sgp4:** https://github.com/brandon-rhodes/python-sgp4
- **satellite.js:** https://github.com/shashwatak/satellite-js
- **LangGraph docs:** https://langchain-ai.github.io/langgraph/
- **Three.js:** https://threejs.org/
- **@react-three/fiber:** https://docs.pmnd.rs/react-three-fiber

### Reference Implementations
- **Three.js satellite tracker:** https://github.com/dsuarezv/satellite-tracker
- **satellitetracker3d.com:** https://satellitetracker3d.com/ (performance reference)
- **AstriaGraph:** https://astria.tacc.utexas.edu/ (visualization reference)

### Context for Pitch
- **Stargaze announcement:** https://spaceflightnow.com/2026/01/30/ (key quote: reaction required human approval)
- **SpaceNews Stargaze:** https://spacenews.com/spacexs-unveils-space-traffic-management-system/
- **Stargaze gap:** "operators that submit ephemeris will receive CDMs" — still just CDMs, no negotiation

---

## 19. Critical Warning: Catalog Number Transition

CelesTrak will exhaust 5-digit NORAD catalog numbers around **July 12, 2026** (currently at ~69,500 of 69,999). After this point, new objects will have 6-digit catalog numbers (100000+) and will NOT be available in legacy TLE format.

**Action required:**
- Use JSON/OMM format everywhere in the backend
- For the frontend, use satellite.js's `json2satrec()` function which supports OMM JSON
- All CelesTrak queries should use `FORMAT=JSON` or `FORMAT=TLE` only until this is confirmed
- This affects data fetched after July 12 — within the hackathon window (deadline June 14), TLE format is fine

---

*SpaceATC PRD v1.0 | FAR AWAY 2026 | June 2026 | Internal*
