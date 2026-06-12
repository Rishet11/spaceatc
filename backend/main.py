"""
backend/main.py — FastAPI Application Entrypoint
"""

import asyncio
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.db.store import init_db, upsert_satellite
from backend.orbital.tle_client import fetch_and_parse, CELESTRAK_STARLINK_TLE
from backend.orbital.propagator import propagate_at, eci_to_geodetic
from backend.api.websocket import manager, websocket_endpoint
from backend.api.routes import router as api_router, sat_cache
from backend.api.schemas import WSMessage, WSMessageType
from backend.agents.graph import get_graph
from backend.agents.nodes.tle_ingestion import _assign_operator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def broadcast_satellite_positions():
    """Background task: propagate satellites every 5s and broadcast."""
    while True:
        try:
            await asyncio.sleep(5)
            if not sat_cache:
                continue
                
            now = datetime.now(tz=timezone.utc)
            positions = []
            
            for nid, data in sat_cache.items():
                satrec = data["satrec"]
                pos, vel = propagate_at(satrec, now)
                
                if pos is not None:
                    lat, lon, alt = eci_to_geodetic(pos, now)
                    
                    if "maneuver_time" in data:
                        dt = (now - data["maneuver_time"]).total_seconds()
                        lat += data.get("lat_offset_rate", 0.0) * dt
                        lon += data.get("lon_offset_rate", 0.0) * dt
                        alt += data.get("alt_offset_rate", 0.0) * dt
                    
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
                    payload={"satellites": positions}
                )
                await manager.broadcast(msg.model_dump())
        except Exception as e:
            logger.error(f"Error in satellite propagation task: {e}")

broadcast_queue: asyncio.Queue = asyncio.Queue()

async def drain_agent_ws_events():
    """Background task: drain websocket_events from global queue."""
    while True:
        try:
            message = broadcast_queue.get_nowait()
            await manager.broadcast(message)
        except asyncio.QueueEmpty:
            pass
        await asyncio.sleep(0.1)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. init_db()
    logger.info("Initializing DB...")
    await init_db()
    
    # 2. fetch TLEs and store top 100 satellites
    logger.info("Fetching TLEs...")
    try:
        sats = await fetch_and_parse(CELESTRAK_STARLINK_TLE)
        top_100 = sats[:100]
        for name, satrec in top_100:
            nid = str(satrec.satnum)
            op = _assign_operator(name)
            
            # Simple fake TLE lines for MVP reconstruction 
            # (since we didn't fetch raw lines, we can just use the satrec to build a dict)
            # However, for propagation, we just cache the satrec directly!
            
            sat_dict = {
                "norad_id": nid,
                "name": name,
                "operator": op,
                "fuel_units": 100.0,
                "maneuver_count": 0,
                "omm_json": "{}"
            }
            await upsert_satellite(sat_dict)
            sat_cache[nid] = {
                "satrec": satrec,
                "name": name,
                "operator": op,
            }
            
        logger.info(f"Loaded {len(top_100)} satellites into DB and cache.")
    except Exception as e:
        logger.error(f"Failed to fetch TLEs: {e}")
        
    # 3. start background tasks
    task1 = asyncio.create_task(broadcast_satellite_positions())
    task2 = asyncio.create_task(drain_agent_ws_events())
    
    yield
    
    # cleanup
    task1.cancel()
    task2.cancel()

app = FastAPI(title="SpaceATC Backend", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.add_api_websocket_route("/ws", websocket_endpoint)
app.include_router(api_router, prefix="")
