"""
backend/agents/nodes/maneuver_executor.py — Node 6: Execute the approved maneuver.
"""

import logging
from datetime import datetime, timezone

from backend.agents.state import AgentState
from backend.api.schemas import WSMessage, WSMessageType
from backend.db.store import update_conjunction_status, upsert_satellite

logger = logging.getLogger(__name__)

async def execute_maneuver(state: AgentState) -> dict:
    """
    Execute the winning maneuver, update DB statuses, and send final WS event.
    """
    logger.info("Node: execute_maneuver starting...")
    
    winning_proposal = state.get("winning_proposal")
    hitl_decision = state.get("hitl_decision")
    
    if not winning_proposal or hitl_decision != "approve":
        msg = "[Executor] Maneuver execution skipped or vetoed."
        return {"phase": "resolved", "messages": state.get("messages", []) + [msg]}
        
    event_id = winning_proposal["event_id"]
    now = datetime.now(tz=timezone.utc).isoformat()
    
    # 1. Update conjunction status
    await update_conjunction_status(event_id, "resolved", resolved_at=now)
    
    # 2. Update satellite fuel and maneuver count
    maneuvering_sat = winning_proposal.get("maneuvering_sat_obj")
    if maneuvering_sat:
        maneuvering_sat["fuel_units"] -= winning_proposal["fuel_cost_units"]
        maneuvering_sat["maneuver_count"] += 1
        await upsert_satellite({
            "norad_id": maneuvering_sat["norad_id"],
            "name": maneuvering_sat["name"],
            "operator": maneuvering_sat["operator"],
            "fuel_units": maneuvering_sat["fuel_units"],
            "maneuver_count": maneuvering_sat["maneuver_count"]
        })
        
        # Inject artificial drift to visual globe (simulate delta-V)
        from backend.api.routes import sat_cache
        nid = maneuvering_sat["norad_id"]
        if nid in sat_cache:
            sat_cache[nid]["maneuver_time"] = datetime.now(tz=timezone.utc)
            sat_cache[nid]["lat_offset_rate"] = 0.005 # deg/sec
            sat_cache[nid]["alt_offset_rate"] = 0.5   # km/sec
        
    msg = f"[Executor] Executed maneuver for {winning_proposal['satellite_name']} (dv={winning_proposal['delta_v_ms']} m/s). Conjunction resolved."
    
    # Retrieve original conjunction info
    active_conjunctions = state.get("active_conjunctions", [])
    current_event = next((c for c in active_conjunctions if c["event_id"] == event_id), {})
    
    # 3. Queue maneuver_executed WS event
    ws_event = WSMessage.now(
        type_=WSMessageType.maneuver_executed,
        payload={
            "event_id": event_id,
            "satellite_name": winning_proposal["satellite_name"],
            "operator": winning_proposal["operator"],
            "delta_v_ms": winning_proposal["delta_v_ms"],
            "pc_before": current_event.get("pc", 0.0),
            "pc_after": winning_proposal["post_maneuver_pc"],
            "miss_km_before": current_event.get("miss_distance_km", 0.0),
            "miss_km_after": winning_proposal["post_maneuver_miss_km"],
            "burn_time": winning_proposal["burn_time"]
        }
    ).model_dump()
    
    return {
        "phase": "resolved",
        "messages": state.get("messages", []) + [msg],
        "websocket_events": state.get("websocket_events", []) + [ws_event]
    }
