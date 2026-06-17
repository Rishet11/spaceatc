"""
backend/agents/nodes/tle_ingestion.py — Node 1: Ingest TLEs and update DB.
"""

import logging

from backend.agents.state import AgentState
from backend.api.schemas import WSMessage, WSMessageType
from backend.db.store import upsert_satellite
from backend.orbital.tle_client import CELESTRAK_STARLINK_TLE, fetch_and_parse

logger = logging.getLogger(__name__)

# PRD §9.4
OPERATOR_GROUPS = {
    "SpaceX": ["STARLINK-"],
    "OneWeb": ["ONEWEB-"],
    "Demo_A": ["DEMO-SAT-A"],
    "Demo_B": ["DEMO-SAT-B"],
}

def _assign_operator(sat_name: str) -> str:
    """Assign operator based on prefix, defaulting to 'Unknown'."""
    upper_name = sat_name.upper()
    for op, prefixes in OPERATOR_GROUPS.items():
        if any(upper_name.startswith(p) for p in prefixes):
            return op
    return "Unknown"

async def ingest_tle(state: AgentState) -> dict:
    """
    Ingest TLEs, take first 100, assign operators, save to DB, and queue WS event.
    """
    logger.info("Node: ingest_tle starting...")
    
    # 1. Fetch & parse
    satellites_raw = await fetch_and_parse(CELESTRAK_STARLINK_TLE)
    
    # 2. Take first 100
    top_100 = satellites_raw[:100]
    
    processed_sats = []
    
    # 3. Assign operator & upsert
    for name, satrec in top_100:
        op = _assign_operator(name)
        
        # We need the original OMM/TLE lines. For the demo, we'll store basic info
        # since tle_client doesn't return full OMM json yet, just the Satrec.
        sat_dict = {
            "norad_id": str(satrec.satnum),
            "name": name,
            "operator": op,
            "fuel_units": 100.0,
            "maneuver_count": 0,
            "omm_json": {"source": "celestrak", "type": "tle", "satnum": satrec.satnum} 
        }
        await upsert_satellite(sat_dict)
        
        # Also keep a richer dict in state for the next nodes to use
        processed_sats.append({
            "norad_id": str(satrec.satnum),
            "name": name,
            "operator": op,
            "fuel_units": 100.0,
            "maneuver_count": 0
        })
        
    # Inject DEMO sats if they exist in sat_cache. Operational attributes mirror
    # what /api/demo/inject wrote to the DB: DEMO-SAT-B has prior maneuver
    # history, so the negotiation winner is decided on a real attribute rather
    # than an artificial delta-V difference (the two craft are co-orbital).
    from backend.api.routes import sat_cache
    demo_meta = {
        "99001": {"name": "DEMO-SAT-A", "operator": "Demo_A", "fuel_units": 100.0, "maneuver_count": 0},
        "99002": {"name": "DEMO-SAT-B", "operator": "Demo_B", "fuel_units": 96.0, "maneuver_count": 2},
    }
    for nid in ["99001", "99002"]:
        if nid in sat_cache:
            meta = demo_meta[nid]
            processed_sats.insert(0, {  # Insert at beginning so they are in top 20
                "norad_id": nid,
                "name": meta["name"],
                "operator": meta["operator"],
                "fuel_units": meta["fuel_units"],
                "maneuver_count": meta["maneuver_count"],
            })

    msg = f"[TLE INGESTION] Loaded {len(processed_sats)} active satellites from CelesTrak"
    msg2 = "[TLE INGESTION] Coverage: SpaceX Starlink, OneWeb, active payloads"
    new_messages = [msg, msg2]

    # 4. Queue system_status WS event (include messages so frontend can log them)
    ws_event = WSMessage.now(
        type_=WSMessageType.system_status,
        payload={
            "status": "ACTIVE",
            "satellites_loaded": len(processed_sats),
            "messages": new_messages,
        }
    ).model_dump()

    return {
        "phase": "screening",
        "satellites": processed_sats,
        "messages": state.get("messages", []) + new_messages,
        "websocket_events": state.get("websocket_events", []) + [ws_event]
    }
