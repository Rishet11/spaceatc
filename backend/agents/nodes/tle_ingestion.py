"""
backend/agents/nodes/tle_ingestion.py — Node 1: Ingest TLEs and update DB.
"""

import logging

from backend.agents.state import AgentState
from backend.api.schemas import WSMessage, WSMessageType

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
    Build the pipeline's satellite list from ``sat_cache`` (already populated
    by main.py's boot-time ingest and by /api/demo/inject) instead of running
    a second, independent CelesTrak fetch. sat_cache is the single source the
    globe and the header count both read from, so this node's own "loaded N"
    count now always matches what is actually tracked and displayed.
    """
    logger.info("Node: ingest_tle starting...")

    from backend.api.routes import sat_cache

    # Operational attributes mirror what /api/demo/inject wrote to the DB:
    # DEMO-SAT-B has prior maneuver history, so the negotiation winner is
    # decided on a real attribute rather than an artificial delta-V
    # difference (the two craft are co-orbital).
    demo_meta = {
        "99001": {"name": "DEMO-SAT-A", "operator": "Demo_A", "fuel_units": 100.0, "maneuver_count": 0},
        "99002": {"name": "DEMO-SAT-B", "operator": "Demo_B", "fuel_units": 96.0, "maneuver_count": 2},
    }

    processed_sats = []

    # Demo sats first so they land in detect_conjunctions' first-20-pairs scan.
    for nid in ["99001", "99002"]:
        if nid in sat_cache:
            meta = demo_meta[nid]
            processed_sats.append({
                "norad_id": nid,
                "name": meta["name"],
                "operator": meta["operator"],
                "fuel_units": meta["fuel_units"],
                "maneuver_count": meta["maneuver_count"],
            })

    for nid, data in sat_cache.items():
        if nid in demo_meta:
            continue
        processed_sats.append({
            "norad_id": nid,
            "name": data["name"],
            "operator": data["operator"],
            "fuel_units": 100.0,
            "maneuver_count": 0,
        })

    msg = f"[TLE INGESTION] Using {len(processed_sats)} satellites from sat_cache (the tracked/displayed set)"
    msg2 = "[TLE INGESTION] Coverage: SpaceX Starlink constellation (low-Earth orbit)"
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
