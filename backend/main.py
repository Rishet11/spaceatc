"""
backend/main.py — FastAPI Application Entrypoint
"""

import asyncio
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
                
                if pos:
                    lat, lon, alt = eci_to_geodetic(pos, now)
                    
                    # Update cache so REST API sees it too
                    data["position"] = pos
                    data["lat"] = lat
                    data["lon"] = lon
                    data["alt_km"] = alt
                    
                    positions.append({
                        "norad_id": nid,
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

async def drain_agent_ws_events():
    """Background task: drain websocket_events from agent state."""
    seen_events = 0
    config = {"configurable": {"thread_id": "demo_session"}}
    
    while True:
        try:
            await asyncio.sleep(1)
            app = await get_graph()
            
            # Use get_state to peek at the current state of the demo session
            state_snapshot = await app.aget_state(config)
            if state_snapshot and state_snapshot.values:
                events = state_snapshot.values.get("websocket_events", [])
                
                # Broadcast any new events
                if len(events) > seen_events:
                    for ev in events[seen_events:]:
                        await manager.broadcast(ev)
                    seen_events = len(events)
                    
        except Exception as e:
            # Graph might not be initialized yet or session doesn't exist
            pass

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
            sat_cache[nid] = {"satrec": satrec}
            
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
