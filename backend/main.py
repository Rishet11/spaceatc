"""
backend/main.py — FastAPI Application Entrypoint
"""

import os
import sys

# macOS OpenMP duplicate library crash fix: dynamically locate and preload PyTorch's libomp.dylib
if sys.platform == "darwin" and "DYLD_INSERT_LIBRARIES" not in os.environ:
    os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
    try:
        import torch
        torch_lib_dir = os.path.join(os.path.dirname(torch.__file__), "lib")
        torch_omp = os.path.join(torch_lib_dir, "libomp.dylib")
        if os.path.exists(torch_omp):
            os.environ["DYLD_INSERT_LIBRARIES"] = torch_omp
            os.execve(sys.executable, [sys.executable] + sys.argv, os.environ)
    except Exception:
        pass

# Ultralytics telemetry is silenced lazily in backend.api.reflex.lazy_load_models
# so this module does not import ultralytics (and pull the whole ML stack) at
# startup. Keeping startup light lets the server bind its port within seconds,
# which is what the deploy platform needs to promote a new build.

# Limit OpenMP, PyTorch and OpenCV threads to 1 to prevent system mutex overflows on macOS CPU
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import asyncio
import logging
import time as time_module
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager

# ---------------------------------------------------------------------------
# Simulation time warp
# ---------------------------------------------------------------------------
SIM_SPEED: float = 1.0         # default: real-time, so SIM TIME tracks real UTC (no drift); judges can fast-forward via the speed selector
SIM_START_REAL: float = 0.0    # set on startup
SIM_START_UTC: datetime = datetime.utcnow()  # set on startup


def get_sim_time() -> datetime:
    """Return the current simulation time (accelerated by SIM_SPEED)."""
    elapsed_real = time_module.time() - SIM_START_REAL
    elapsed_sim = elapsed_real * SIM_SPEED
    return SIM_START_UTC + timedelta(seconds=elapsed_sim)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.db.store import init_db, upsert_satellite
from backend.orbital.tle_client import fetch_and_parse, CELESTRAK_STARLINK_TLE
from backend.orbital.propagator import propagate_at, eci_to_geodetic
from backend.api.websocket import manager, websocket_endpoint
from backend.api.routes import router as api_router, sat_cache
from backend.api.reflex import router as reflex_router
from backend.api.schemas import WSMessage, WSMessageType
from backend.agents.graph import get_graph
from backend.agents.nodes.tle_ingestion import _assign_operator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def broadcast_satellite_positions():
    """Background task: propagate satellites every 2s and broadcast."""
    last_metrics_time = 0.0
    while True:
        try:
            await asyncio.sleep(2)
            if not sat_cache:
                continue

            # Use simulation time for SGP4 propagation
            now = get_sim_time().replace(tzinfo=timezone.utc)
            positions = []
            
            for nid, data in sat_cache.items():
                satrec = data["satrec"]
                pos, vel = propagate_at(satrec, now)
                
                if pos is not None:
                    lat, lon, alt = eci_to_geodetic(pos, now)
                    
                    if data.get("maneuver_offset") and data.get("offset_applied_at"):
                        elapsed = (datetime.utcnow() - data["offset_applied_at"]).total_seconds()
                        if elapsed < 60:
                            lon += data.get("lon_offset_rate", 0.0) * elapsed
                    
                    # Update cache so REST API sees it too
                    data["position"] = pos
                    data["lat"] = lat
                    data["lon"] = lon
                    data["alt_km"] = alt
                    
                    positions.append({
                        "norad_id": nid,
                        "name": data.get("name", nid),
                        "operator": data.get("operator", "Unknown"),
                        "position": pos,
                        "lat": lat,
                        "lon": lon,
                        "alt_km": alt,
                        "is_highlighted": False
                    })
            
            if positions:
                msg = WSMessage.now(
                    type_=WSMessageType.satellite_update,
                    payload={
                        "satellites": positions,
                        "sim_time": get_sim_time().isoformat(),
                        "sim_speed": SIM_SPEED,
                    }
                )
                try:
                    await manager.broadcast(msg.model_dump())
                except Exception as e:
                    logger.warning(f"Failed to broadcast satellite update: {e}")
            
            # Broadcast metrics every 5 seconds
            current_time = time_module.time()
            if current_time - last_metrics_time >= 5:
                last_metrics_time = current_time
                from backend.api.routes import get_metrics
                metrics = await get_metrics()
                metrics_msg = WSMessage.now(
                    type_=WSMessageType.metrics_update,
                    payload=metrics
                )
                try:
                    await manager.broadcast(metrics_msg.model_dump())
                except Exception as e:
                    logger.warning(f"Failed to broadcast metrics update: {e}")
                
        except Exception as e:
            logger.error(f"Error in satellite propagation task: {e}")

broadcast_queue: asyncio.Queue = asyncio.Queue()

async def drain_agent_ws_events():
    """Background task: drain websocket_events from global queue."""
    while True:
        try:
            message = broadcast_queue.get_nowait()
            try:
                await manager.broadcast(message)
            except Exception as e:
                logger.warning(f"Failed to broadcast queued agent event: {e}")
        except asyncio.QueueEmpty:
            pass
        await asyncio.sleep(0.1)

async def _ingest_sats(sats, source):
    """Upsert the top 100 satellites into the DB + sat_cache for propagation."""
    for name, satrec in sats[:100]:
        nid = str(satrec.satnum)
        op = _assign_operator(name)
        sat_dict = {
            "norad_id": nid,
            "name": name,
            "operator": op,
            "fuel_units": 100.0,
            "maneuver_count": 0,
            "omm_json": "{}",
        }
        await upsert_satellite(sat_dict)
        sat_cache[nid] = {"satrec": satrec, "name": name, "operator": op}
    logger.info(
        "TLE load complete: source=%s parsed=%d sat_cache=%d",
        source, len(sats), len(sat_cache),
    )


async def _load_satellites():
    """Populate the globe without blocking startup. Load the bundled cache first
    (fast, offline) so the globe is never empty, then attempt a live CelesTrak
    refresh (a no-op on egress-restricted hosts like the Space)."""
    from pathlib import Path
    from backend.orbital.tle_client import parse_tle_block
    cache_path = Path(__file__).parent / "orbital" / "starlink_cache.tle"
    try:
        if cache_path.exists():
            await _ingest_sats(parse_tle_block(cache_path.read_text(encoding="utf-8")), "local_cache")
    except Exception as e:
        logger.error("Bundled TLE cache load failed: %s", e, exc_info=True)
    try:
        sats, source = await fetch_and_parse(CELESTRAK_STARLINK_TLE, return_source=True)
        if sats and source == "network":
            await _ingest_sats(sats, "network")
    except Exception as e:
        logger.info("Live TLE refresh unavailable (%s); staying on bundled cache.", type(e).__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global SIM_START_REAL, SIM_START_UTC
    SIM_START_REAL = time_module.time()
    SIM_START_UTC = datetime.utcnow()

    logger.info("Initializing DB...")
    await init_db()

    # Load satellites in the background so the server binds its port within
    # seconds. The ML import is already deferred; this removes the last blocking
    # startup step (a network fetch that times out on egress-restricted hosts),
    # which is what kept the platform from promoting a new build.
    task0 = asyncio.create_task(_load_satellites())
    task1 = asyncio.create_task(broadcast_satellite_positions())
    task2 = asyncio.create_task(drain_agent_ws_events())

    yield

    task0.cancel()
    task1.cancel()
    task2.cancel()

app = FastAPI(title="SpaceATC Backend", lifespan=lifespan)

# CORS — defaults to any origin (the SPA is also served same-origin below, where
# CORS is moot). Override with ALLOWED_ORIGINS="https://a.com,https://b.com".
_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.add_api_websocket_route("/ws", websocket_endpoint)
app.include_router(api_router, prefix="")
app.include_router(reflex_router, prefix="")

# Serve the built frontend in single-container deploys. Registered last, so the
# API routes and /ws above always win; everything else falls back to the SPA.
_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.isdir(_DIST):
    _ASSETS = os.path.join(_DIST, "assets")
    if os.path.isdir(_ASSETS):
        app.mount("/assets", StaticFiles(directory=_ASSETS), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        candidate = os.path.join(_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_DIST, "index.html"))
