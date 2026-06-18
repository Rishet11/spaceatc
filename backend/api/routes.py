"""
backend/api/routes.py — REST API routes (PRD Section 7).
"""

import uuid
import json
import logging
import time as time_module
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.db.store import (
    get_all_satellites,
    get_all_conjunctions,
    get_conjunction,
    get_session_for_event,
    upsert_satellite,
    update_conjunction_status
)
from backend.agents.graph import run_pipeline, resume_after_hitl
from backend.api.schemas import MetricsResponse
from backend.orbital.propagator import propagate_at, eci_to_geodetic
from sgp4.api import Satrec

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory cache of Satrec objects populated by main.py background task
# so GET /api/satellites can return propagated positions.
sat_cache = {}
latest_session_id = "demo_session"


class SimSpeedBody(BaseModel):
    speed: float


@router.get("/api/sim/speed")
async def get_sim_speed():
    """Return current simulation speed and time."""
    import backend.main as _main
    return {
        "speed": _main.SIM_SPEED,
        "sim_time": _main.get_sim_time().isoformat(),
    }


@router.post("/api/sim/speed")
async def set_sim_speed(body: SimSpeedBody):
    """Set simulation speed. Valid values: 1, 10, 60, 300, 600.
    
    Resets the sim clock reference point to prevent time jumps on speed change.
    """
    import backend.main as _main
    valid = {1.0, 10.0, 60.0, 300.0, 600.0}
    speed = float(body.speed)
    if speed not in valid:
        raise HTTPException(status_code=400, detail=f"Speed must be one of {valid}")

    # Capture current sim time before changing speed to prevent jump
    current_sim_time = _main.get_sim_time()

    # Reset reference point
    _main.SIM_START_REAL = time_module.time()
    _main.SIM_START_UTC = current_sim_time
    _main.SIM_SPEED = speed

    return {
        "speed": _main.SIM_SPEED,
        "sim_time": _main.get_sim_time().isoformat(),
    }

@router.get("/health")
async def health_check():
    sats = await get_all_satellites()
    return {
        "status": "ok",
        "satellites": len(sats),
        "sat_cache": len(sat_cache),
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
    }

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

@router.get("/api/conjunctions/{event_id}/paths")
async def get_conjunction_paths(event_id: str):
    """Real SGP4-propagated ground tracks for the two satellites in a conjunction.

    Samples each satellite's actual position across a window centred on the
    predicted TCA so the frontend can render the true orbital paths instead of
    geometric great-circle arcs. Returns ~120 lat/lon/alt points per satellite.
    """
    ev = await get_conjunction(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Conjunction not found")

    try:
        tca = datetime.fromisoformat(ev["tca"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=400, detail="Conjunction has no valid TCA")
    if tca.tzinfo is None:
        tca = tca.replace(tzinfo=timezone.utc)

    # Resolve satrecs by name from the shared cache (populated for every
    # cached satellite by the main.py background task and demo injection).
    def _find_satrec(name):
        for data in sat_cache.values():
            if data.get("name") == name:
                return data.get("satrec")
        return None

    name_primary = ev["sat_primary"]
    name_secondary = ev["sat_secondary"]
    satrec_primary = _find_satrec(name_primary)
    satrec_secondary = _find_satrec(name_secondary)
    if satrec_primary is None or satrec_secondary is None:
        raise HTTPException(status_code=404, detail="Satellite propagation data unavailable")

    window_s = 30 * 60   # +/- 30 minutes around TCA
    step_s = 30          # 30 s cadence -> ~120 points
    offsets = range(-window_s, window_s + 1, step_s)

    def _track(satrec):
        pts = []
        tca_index = 0
        for off in offsets:
            t = tca + timedelta(seconds=off)
            pos, _ = propagate_at(satrec, t)
            if pos is None:
                continue
            lat, lon, alt = eci_to_geodetic(pos, t)
            if off <= 0:
                tca_index = len(pts)  # last sample at or before TCA
            pts.append({"lat": lat, "lon": lon, "alt_km": alt})
        return pts, tca_index

    primary_pts, tca_index = _track(satrec_primary)
    secondary_pts, _ = _track(satrec_secondary)
    if not primary_pts or not secondary_pts:
        raise HTTPException(status_code=404, detail="Propagation produced no points")

    return {
        "event_id": event_id,
        "tca": tca.isoformat(),
        "tca_index": tca_index,
        "primary": {"name": name_primary, "points": primary_pts},
        "secondary": {"name": name_secondary, "points": secondary_pts},
    }

@router.get("/api/metrics")
async def get_metrics():
    import aiosqlite
    from backend.config import settings
    async with aiosqlite.connect(settings.sqlite_path) as db:
        # Active satellites: count from DB
        async with db.execute("SELECT COUNT(*) FROM satellites") as c:
            active_sats = (await c.fetchone())[0]
        
        # Total conjunctions detected ever
        async with db.execute("SELECT COUNT(*) FROM conjunctions") as c:
            total_conjunctions = (await c.fetchone())[0]
        
        # Resolved conjunctions
        async with db.execute(
            "SELECT COUNT(*) FROM conjunctions WHERE status='resolved'"
        ) as c:
            resolved = (await c.fetchone())[0]
        
        # Maneuvers executed (winning proposals on resolved conjunctions)
        async with db.execute(
            "SELECT COUNT(*) FROM proposals p "
            "INNER JOIN conjunctions c ON p.event_id = c.event_id "
            "WHERE c.status = 'resolved' "
            "AND p.bid_score = ("
            "SELECT MIN(bid_score) FROM proposals p2 "
            "WHERE p2.event_id = p.event_id"
            ")"
        ) as c:
            maneuvers = (await c.fetchone())[0]
        
        # Total delta-V: SUM of all winning proposal delta_v_ms values
        async with db.execute("""
            SELECT COALESCE(SUM(p.delta_v_ms), 0) 
            FROM proposals p
            INNER JOIN conjunctions c ON p.event_id = c.event_id
            WHERE c.status = 'resolved'
            AND p.bid_score = (
                SELECT MIN(bid_score) FROM proposals p2 
                WHERE p2.event_id = p.event_id
            )
        """) as c:
            total_dv_ms = (await c.fetchone())[0]
        
        return {
            "active_satellites": active_sats,
            "conjunctions_detected": total_conjunctions,
            "resolved": resolved,
            "maneuvers_executed": maneuvers,
            "total_delta_v_ms": round(total_dv_ms, 3),
            "system_status": "ACTIVE"
        }

@router.post("/api/demo/reset")
async def demo_reset():
    import aiosqlite
    from backend.config import settings
    # For demo reset, we clear DB tables and LangGraph checkpoints
    async with aiosqlite.connect(settings.sqlite_path) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM conjunctions WHERE status='pending_hitl'"
        ) as c:
            pending = (await c.fetchone())[0]
        if pending:
            raise HTTPException(
                status_code=409,
                detail="Cannot reset while a conjunction is awaiting human approval",
            )
        await db.execute("DELETE FROM conjunctions")
        await db.execute("DELETE FROM proposals")
        await db.execute("DELETE FROM checkpoints")
        await db.execute("DELETE FROM writes")
        await db.commit()
    return {"status": "reset"}

def generate_conjunction_tle_pair(epoch_dt: datetime) -> tuple[tuple[str, str, str], tuple[str, str, str]]:
    # Year: 2 digit. e.g., 2026 -> 26
    year_str = str(epoch_dt.year)[-2:]
    
    # Day of year and fraction.
    jan1 = datetime(epoch_dt.year, 1, 1, tzinfo=timezone.utc)
    delta = epoch_dt - jan1
    day_frac = delta.total_seconds() / 86400.0 + 1.0
    
    # Format: YY + day_frac (000.00000000 format, total 14 characters)
    epoch_str = f"{year_str}{day_frac:012.8f}"
    
    # Base elements:
    inc = "53.0500"
    raan_a = 0.0
    ecc = "0001000"
    argp = 0.0
    ma_a = 0.0
    # Same orbital shell for both satellites: two co-orbital craft need an
    # essentially symmetric avoidance delta-V (real physics). The negotiation
    # winner is therefore decided by operational cost (maneuver history / fuel),
    # not by an artificial delta-V difference. See demo_inject / tle_ingestion.
    mm = "15.30000000"

    def format_angle(deg):
        return f"{deg:8.4f}".rjust(8, ' ')

    line1_a = f"1 99001U 24001A   {epoch_str}  .00000000  00000-0  00000-0 0  9999"
    line2_a = f"2 99001  {inc} {format_angle(raan_a)} {ecc} {format_angle(argp)} {format_angle(ma_a)} {mm}    00"

    raan_b = raan_a + 0.01
    ma_b = ma_a - 0.005
    if ma_b < 0: ma_b += 360.0

    line1_b = f"1 99002U 24001B   {epoch_str}  .00000000  00000-0  00000-0 0  9999"
    line2_b = f"2 99002  {inc} {format_angle(raan_b)} {ecc} {format_angle(argp)} {format_angle(ma_b)} {mm}    00"
    
    return ("DEMO-SAT-A", line1_a, line2_a), ("DEMO-SAT-B", line1_b, line2_b)

@router.post("/api/demo/inject")
async def demo_inject():
    """
    1. Create two synthetic satellites with TLEs that will conjunct.
    2. Upsert both into DB.
    3. Run full agent pipeline.
    4. Return event_id.
    """
    # 1. Create TLEs
    dt = datetime.now(tz=timezone.utc)
    (name_a, line1_a, line2_a), (name_b, line1_b, line2_b) = generate_conjunction_tle_pair(dt)

    # 2. Upsert to DB
    # The two demo craft are co-orbital, so their avoidance delta-V is
    # symmetric. They differ in operational history instead: DEMO-SAT-B has
    # already spent fuel on prior maneuvers, so the coordinator prefers
    # DEMO-SAT-A to take this burn (load-balancing on a real attribute).
    demo_a = {
        "norad_id": "99001",
        "name": name_a,
        "operator": "Demo_A",
        "fuel_units": 100.0,
        "maneuver_count": 0,
        "omm_json": json.dumps({"line1": line1_a, "line2": line2_a})
    }
    demo_b = {
        "norad_id": "99002",
        "name": name_b,
        "operator": "Demo_B",
        "fuel_units": 96.0,
        "maneuver_count": 2,
        "omm_json": json.dumps({"line1": line1_b, "line2": line2_b})
    }
    
    await upsert_satellite(demo_a)
    await upsert_satellite(demo_b)
    
    # Store them in cache for propagation
    satrec_a = Satrec.twoline2rv(line1_a, line2_a)
    satrec_b = Satrec.twoline2rv(line1_b, line2_b)
    sat_cache["99001"] = {"satrec": satrec_a, "name": name_a, "operator": demo_a["operator"]}
    sat_cache["99002"] = {"satrec": satrec_b, "name": name_b, "operator": demo_b["operator"]}
    
    # 3. Run full pipeline (wrapped: a pipeline exception must surface as a clean
    # error response, not an unhandled 500 the frontend silently swallows).
    global latest_session_id
    latest_session_id = str(uuid.uuid4())
    try:
        state = await run_pipeline(latest_session_id)
    except Exception as e:
        logger.error("demo_inject pipeline failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Conjunction pipeline failed: {e}")

    # Find the injected event (the one with DEMO-SAT-A)
    event_id = None
    for ev in state.get("active_conjunctions", []):
        if "DEMO-SAT" in ev["sat_primary"] or "DEMO-SAT" in ev["sat_secondary"]:
            event_id = ev["event_id"]
            break

    if event_id is None:
        # Pipeline completed but produced no conjunction (e.g. screening found no
        # close approach). Report it honestly instead of a misleading "injected".
        logger.warning("demo_inject completed but no conjunction was detected")
        return {
            "status": "no_conjunction",
            "event_id": None,
            "detail": "Pipeline ran but no conjunction was detected.",
        }

    return {"status": "injected", "event_id": event_id, "expected_tca_seconds": 120}

@router.post("/api/hitl/{event_id}/approve")
async def hitl_approve(event_id: str):
    await update_conjunction_status(event_id, "pending_execution")
    global latest_session_id
    session_id = await get_session_for_event(event_id) or latest_session_id
    await resume_after_hitl(session_id, "approve")
    return {"status": "approved"}

@router.post("/api/hitl/{event_id}/veto")
async def hitl_veto(event_id: str):
    await update_conjunction_status(event_id, "vetoed")
    global latest_session_id
    session_id = await get_session_for_event(event_id) or latest_session_id
    await resume_after_hitl(session_id, "veto")
    return {"status": "vetoed"}
