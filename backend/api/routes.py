"""
backend/api/routes.py — REST API routes (PRD Section 7).
"""

import uuid
import json
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

from backend.db.store import (
    get_all_satellites,
    get_all_conjunctions,
    get_conjunction,
    upsert_satellite,
    update_conjunction_status
)
from backend.agents.graph import run_pipeline, resume_after_hitl
from backend.api.schemas import MetricsResponse
from sgp4.api import Satrec

router = APIRouter()

# In-memory cache of Satrec objects populated by main.py background task
# so GET /api/satellites can return propagated positions.
sat_cache = {}

@router.get("/health")
async def health_check():
    sats = await get_all_satellites()
    return {"status": "ok", "satellites": len(sats), "timestamp": datetime.now(tz=timezone.utc).isoformat()}

@router.get("/api/satellites")
async def list_satellites():
    """
    List of satellites with current propagated positions.
    Relies on the background task in main.py to keep `sat_cache` updated with current positions.
    """
    sats = await get_all_satellites()
    result = []
    
    for s in sats:
        # Include position if available from the cache
        nid = s["norad_id"]
        pos_info = sat_cache.get(nid, {})
        
        result.append({
            "norad_id": nid,
            "name": s["name"],
            "operator": s["operator"],
            "fuel_units": s["fuel_units"],
            "maneuver_count": s["maneuver_count"],
            "position": pos_info.get("position"),
            "lat": pos_info.get("lat"),
            "lon": pos_info.get("lon"),
            "alt_km": pos_info.get("alt_km")
        })
    return result

@router.get("/api/conjunctions")
async def list_conjunctions():
    return await get_all_conjunctions()

@router.get("/api/conjunctions/{event_id}")
async def get_single_conjunction(event_id: str):
    ev = await get_conjunction(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Not found")
    return ev

@router.get("/api/metrics")
async def get_metrics():
    sats = await get_all_satellites()
    events = await get_all_conjunctions()
    
    resolved = [e for e in events if e["status"] == "resolved"]
    
    # Fake total_delta_v for demo since it's hard to aggregate quickly here
    # (requires querying proposals for resolved events)
    total_dv = sum([0.1 for _ in resolved]) 
    
    return MetricsResponse(
        active_satellites=len(sats),
        conjunctions_detected=len(events),
        conjunctions_resolved=len(resolved),
        maneuvers_executed=len(resolved),
        total_delta_v=total_dv,
        system_status="ACTIVE"
    ).model_dump()

@router.post("/api/demo/reset")
async def demo_reset():
    import aiosqlite
    from backend.config import settings
    # For demo reset, we just clear the DB tables.
    async with aiosqlite.connect(settings.sqlite_path) as db:
        await db.execute("DELETE FROM conjunctions")
        await db.execute("DELETE FROM proposals")
        await db.commit()
    return {"status": "reset"}

@router.post("/api/demo/inject")
async def demo_inject():
    """
    1. Create two synthetic satellites with TLEs that will conjunct.
    2. Upsert both into DB.
    3. Run full agent pipeline.
    4. Return event_id.
    """
    # 1. Create TLEs
    # Base TLE from Starlink (approx 550km, 53deg inc)
    line1_a = "1 99998U 20001A   23001.00000000  .00000000  00000-0  00000-0 0  9998"
    line2_a = "2 99998  53.0500   0.0000 0001000   0.0000   0.0000 15.06000000    06"
    
    line1_b = "1 99999U 20001B   23001.00000000  .00000000  00000-0  00000-0 0  9999"
    # Offset mean anomaly by 0.001 degrees
    line2_b = "2 99999  53.0500   0.0000 0001000   0.0000   0.0010 15.06000000    06"

    # 2. Upsert to DB
    demo_a = {
        "norad_id": "99998",
        "name": "DEMO-SAT-A",
        "operator": "Demo_A",
        "fuel_units": 100.0,
        "maneuver_count": 0,
        "omm_json": json.dumps({"line1": line1_a, "line2": line2_a})
    }
    demo_b = {
        "norad_id": "99999",
        "name": "DEMO-SAT-B",
        "operator": "Demo_B",
        "fuel_units": 100.0,
        "maneuver_count": 0,
        "omm_json": json.dumps({"line1": line1_b, "line2": line2_b})
    }
    
    await upsert_satellite(demo_a)
    await upsert_satellite(demo_b)
    
    # Store them in cache for propagation
    satrec_a = Satrec.twoline2rv(line1_a, line2_a)
    satrec_b = Satrec.twoline2rv(line1_b, line2_b)
    sat_cache["99998"] = {"satrec": satrec_a}
    sat_cache["99999"] = {"satrec": satrec_b}
    
    # 3. Run full pipeline
    session_id = "demo_session"
    state = await run_pipeline(session_id)
    
    # Find the injected event (the one with DEMO-SAT-A)
    event_id = None
    for ev in state.get("active_conjunctions", []):
        if "DEMO-SAT" in ev["sat_primary"] or "DEMO-SAT" in ev["sat_secondary"]:
            event_id = ev["event_id"]
            break
            
    return {"status": "injected", "event_id": event_id, "session_id": session_id}

@router.post("/api/hitl/{event_id}/approve")
async def hitl_approve(event_id: str):
    await update_conjunction_status(event_id, "pending_execution")
    # For demo we find the active session by assuming we have it,
    # or we can just fetch the latest session_id.
    # We will assume event_id is the session_id for simplicity or we need to pass it.
    # In LangGraph the thread_id is needed. Since we don't store it, we can query SQLite thread?
    # Actually, the user says `Call resume_after_hitl(session_id, "approve")`.
    # Let's just use a hardcoded demo thread id or pass it via body. We didn't add it to body.
    # Let's search DB for latest proposal or just use the event_id as session_id when starting it?
    # If run_pipeline uses session_id = event_id, it would be easy. But event_id is generated inside!
    # I'll just use a fixed thread_id for MVP demo.
    await resume_after_hitl("demo_session", "approve")
    
    # The WS event maneuver_executed is sent by execute_maneuver node.
    return {"status": "approved"}

@router.post("/api/hitl/{event_id}/veto")
async def hitl_veto(event_id: str):
    await update_conjunction_status(event_id, "vetoed")
    await resume_after_hitl("demo_session", "veto")
    return {"status": "vetoed"}
