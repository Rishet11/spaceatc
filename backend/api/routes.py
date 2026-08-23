"""
backend/api/routes.py — REST API routes (PRD Section 7).
"""

import math
import uuid
import json
import logging
import time as time_module
from datetime import datetime, timezone, timedelta

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.db.store import (
    get_all_satellites,
    get_all_conjunctions,
    get_conjunction,
    get_session_for_event,
    get_proposals_for_event,
    upsert_satellite,
    update_conjunction_status
)
from backend.agents.graph import run_pipeline, resume_after_hitl
from backend.api.schemas import MetricsResponse
from backend.orbital.propagator import propagate_at, propagate_two_body, eci_to_geodetic
from sgp4.api import Satrec

# Seconds between injecting the demo pair and their closest approach. Also
# returned to the frontend so it can pace the countdown. Long enough to narrate
# the detection and negotiation, short enough that the encounter stays on screen.
ENCOUNTER_LEAD_S: int = 180

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory cache of Satrec objects populated by main.py background task
# so GET /api/satellites can return propagated positions.
sat_cache = {}
latest_session_id = "demo_session"

# Set by main.py's _load_satellites: "live" when the last CelesTrak fetch
# succeeded, "cache" when it fell back to the bundled TLE file.
DATA_SOURCE = "cache"


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
        "data_source": DATA_SOURCE,
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

    payload = {
        "event_id": event_id,
        "tca": tca.isoformat(),
        "tca_index": tca_index,
        "primary": {"name": name_primary, "points": primary_pts},
        "secondary": {"name": name_secondary, "points": secondary_pts},
    }

    post = await _post_maneuver_track(event_id, offsets, tca, _find_satrec)
    if post is not None:
        payload["post_maneuver"] = post
    return payload


async def _post_maneuver_track(event_id, offsets, tca, find_satrec):
    """The maneuvering satellite's real trajectory after the winning burn.

    Method, and its limits, stated plainly because we quote this on camera:

    1. Take the *real* SGP4 state (r, v) at the burn epoch.
    2. Apply the winning proposal's delta-V as an impulse along the velocity
       vector -- which is exactly the along-track impulse the Clohessy-Wiltshire
       solver sized, so the drawing and the arithmetic agree.
    3. Propagate the burned and un-burned states forward with the same two-body
       model and take the DIFFERENCE, then add that difference to the real SGP4
       track.

    Step 3 is the important one. Two-body propagation drifts from SGP4 by ~16 km
    over 30 minutes because it ignores J2 and drag -- far more than the ~3 km the
    maneuver itself buys. Propagating the post-burn state absolutely would bury
    the signal in model error. Differencing two two-body runs that start 0.24 m/s
    apart cancels that shared error almost entirely, leaving just the effect of
    the burn, which is then applied to the trajectory SGP4 actually predicts.

    Returns None when there is no winning proposal yet (pre-decision), or when
    propagation fails. Displacements are in kilometres, true scale, unexaggerated.
    """
    proposals = await get_proposals_for_event(event_id)
    if not proposals:
        return None
    winner = proposals[0]          # ORDER BY bid_score ASC -- lowest cost wins

    satrec = find_satrec(winner["satellite_name"])
    if satrec is None:
        return None

    try:
        burn_time = datetime.fromisoformat(winner["burn_time"])
    except (KeyError, ValueError):
        return None
    if burn_time.tzinfo is None:
        burn_time = burn_time.replace(tzinfo=timezone.utc)

    r_burn, v_burn = propagate_at(satrec, burn_time)
    if r_burn is None or v_burn is None:
        return None
    # propagate_at hands back plain sequences; the vector arithmetic below needs arrays.
    r_burn = np.asarray(r_burn, dtype=float)
    v_burn = np.asarray(v_burn, dtype=float)

    speed = float(np.linalg.norm(v_burn))
    if speed <= 0:
        return None
    # Retrograde burns slow the craft down, so the impulse opposes velocity.
    sign = -1.0 if winner["burn_direction"] == "retrograde" else 1.0
    dv_km_s = winner["delta_v_ms"] / 1000.0
    v_burned = v_burn + sign * dv_km_s * (v_burn / speed)

    points, max_sep_km = [], 0.0
    for off in offsets:
        t = tca + timedelta(seconds=off)
        nominal, _ = propagate_at(satrec, t)
        if nominal is None:
            continue
        nominal = np.asarray(nominal, dtype=float)
        if t <= burn_time:
            pos = nominal                      # burn has not happened yet
        else:
            try:
                base, _ = propagate_two_body(r_burn, v_burn, burn_time, t)
                bent, _ = propagate_two_body(r_burn, v_burned, burn_time, t)
            except ValueError:
                return None
            displacement = bent - base
            max_sep_km = max(max_sep_km, float(np.linalg.norm(displacement)))
            pos = nominal + displacement
        lat, lon, alt = eci_to_geodetic(pos, t)
        points.append({"lat": lat, "lon": lon, "alt_km": alt})

    if not points:
        return None
    return {
        "satellite": winner["satellite_name"],
        "delta_v_ms": winner["delta_v_ms"],
        "burn_direction": winner["burn_direction"],
        "burn_time": burn_time.isoformat(),
        # Peak true separation from the original track, so the client can decide
        # how much to exaggerate it to make a few km legible on a 6371 km globe.
        # NOTE: this is displacement from where the satellite *would have been*,
        # NOT the miss distance to the other object. They are different numbers
        # (4.2 km vs 3.4 km here) and must not be shown interchangeably.
        "max_separation_km": max_sep_km,
        # Miss distance to the other satellite after the burn -- the number that
        # belongs next to "before" in any user-facing before/after readout.
        "post_maneuver_miss_km": winner["post_maneuver_miss_km"],
        "post_maneuver_pc": winner["post_maneuver_pc"],
        "points": points,
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
    
    # ------------------------------------------------------------------
    # Two DIFFERENT orbital planes that genuinely intersect.
    # ------------------------------------------------------------------
    # A same-plane pair (which this used to be) has coincident ground
    # tracks, so on a globe the two trajectories draw over each other and
    # read as a single line -- and a co-orbital encounter is the *benign*
    # kind, closing at ~1 km/s.  The dangerous, and visually legible, case
    # is a crossing encounter between different planes: Iridium-Cosmos
    # closed at 11.7 km/s.  Sat A sits in a Starlink-like 53.05 deg shell;
    # sat B crosses it from a 74 deg plane with its node on the far side,
    # giving a ~13.7 km/s head-on geometry.
    #
    # Rather than hardcode mean anomalies (which would only be correct for
    # one epoch), we solve for them: the two orbit planes intersect along
    # d = n_A x n_B, and we phase each satellite so it arrives at that
    # intersection ENCOUNTER_LEAD_S after the epoch.  SGP4 then finds the
    # real TCA -- we place the geometry, we do not fake the result.
    inc_a, raan_a = 53.05, 0.0
    inc_b, raan_b = 74.0, 179.981667
    ecc = "0001000"
    argp = 0.0
    mm = "15.30000000"
    mm_rev_day = 15.30000000

    # Small empirical phase bias on B.  Mean anomaly is not exactly the
    # argument of latitude (eccentricity is small but nonzero) and SGP4
    # applies J2 over the lead time, so the analytic placement lands a few
    # km off a dead-centre hit.  This bias tunes the encounter to a
    # ~0.4-0.5 km miss: close enough to clear the Pc alert threshold,
    # far enough to be a near miss rather than a contact.
    ma_b_bias = 0.219964

    def plane_normal(inc_deg: float, raan_deg: float):
        i, om = math.radians(inc_deg), math.radians(raan_deg)
        return [math.sin(i) * math.sin(om), -math.sin(i) * math.cos(om), math.cos(i)]

    def arg_of_lat(d, inc_deg: float, raan_deg: float) -> float:
        """Argument of latitude (deg) of direction `d` within the given plane."""
        om = math.radians(raan_deg)
        node = [math.cos(om), math.sin(om), 0.0]          # ascending node
        w = plane_normal(inc_deg, raan_deg)
        perp = [                                           # 90 deg past the node
            w[1] * node[2] - w[2] * node[1],
            w[2] * node[0] - w[0] * node[2],
            w[0] * node[1] - w[1] * node[0],
        ]
        dot = lambda p, q: sum(x * y for x, y in zip(p, q))  # noqa: E731
        return math.degrees(math.atan2(dot(d, perp), dot(d, node))) % 360.0

    na, nb = plane_normal(inc_a, raan_a), plane_normal(inc_b, raan_b)
    d = [
        na[1] * nb[2] - na[2] * nb[1],
        na[2] * nb[0] - na[0] * nb[2],
        na[0] * nb[1] - na[1] * nb[0],
    ]
    dnorm = math.sqrt(sum(x * x for x in d)) or 1.0
    d = [x / dnorm for x in d]

    # Degrees of mean anomaly swept during the lead time.
    sweep_deg = mm_rev_day * 360.0 / 86400.0 * ENCOUNTER_LEAD_S
    ma_a = (arg_of_lat(d, inc_a, raan_a) - sweep_deg) % 360.0
    ma_b = (arg_of_lat(d, inc_b, raan_b) - sweep_deg + ma_b_bias) % 360.0

    def format_angle(deg):
        return f"{deg % 360.0:8.4f}".rjust(8, ' ')

    line1_a = f"1 99001U 24001A   {epoch_str}  .00000000  00000-0  00000-0 0  9999"
    line2_a = f"2 99001  {inc_a:7.4f} {format_angle(raan_a)} {ecc} {format_angle(argp)} {format_angle(ma_a)} {mm}    00"

    line1_b = f"1 99002U 24001B   {epoch_str}  .00000000  00000-0  00000-0 0  9999"
    line2_b = f"2 99002  {inc_b:7.4f} {format_angle(raan_b)} {ecc} {format_angle(argp)} {format_angle(ma_b)} {mm}    00"

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

    return {"status": "injected", "event_id": event_id, "expected_tca_seconds": ENCOUNTER_LEAD_S}

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
