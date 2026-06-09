# SpaceATC — Instructions

## What we're building
Multi-agent satellite collision avoidance system.
Full spec is in PRD.md. Follow it exactly.
Do not invent schemas, endpoints, or data formats.
When in doubt, check PRD.md Section 6 (schemas) first.

## Non-negotiables
- All schemas are defined in PRD.md Section 6. Use them verbatim.
- All API endpoints are in PRD.md Section 7. No additions.
- Tech stack is locked in PRD.md Section 3. No substitutions.
- The demo script is in PRD.md Section 12. Every build decision 
  serves that script.

## Build order
1. backend/orbital/tle_client.py
2. backend/orbital/propagator.py
3. backend/agents/state.py
4. backend/agents/graph.py (wired with stub nodes first)
5. backend/api/websocket.py
6. backend/api/routes.py (demo injection endpoint first)
7. backend/agents/nodes/ (one by one)
8. frontend/ (after backend pipeline runs end-to-end)

## Interface contract (DO NOT CHANGE)
Raghav owns backend/orbital/conjunction.py and backend/orbital/maneuver.py.
The I/O contracts for those files are in PRD.md Section 11.
Never modify those function signatures.

## Critical path
The demo injection endpoint (POST /api/demo/inject) must work 
before any frontend work begins. It is the fallback if real 
conjunction detection breaks.

## Running the project
Backend: uvicorn backend.main:app --reload
Frontend: cd frontend && npm run dev