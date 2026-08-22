"""
backend/agents/nodes/maneuver_executor.py — Node 6: Execute the approved maneuver.
"""

import logging
import asyncio
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
    
    # Sleep to allow the frontend MathPanel to stream the computation trace (Prompt 5 requirement)
    await asyncio.sleep(3.5)

    winning_proposal = state.get("winning_proposal")
    hitl_decision = state.get("hitl_decision")
    
    if not winning_proposal or hitl_decision != "approve":
        msg = "[EXECUTOR] Maneuver execution skipped or vetoed."
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
        
        # Apply small mean motion perturbation
        # delta_v_ms = maneuver in m/s, orbital velocity ~7600 m/s
        dv_ratio = winning_proposal['delta_v_ms'] / 7600.0
        
        from backend.api.routes import sat_cache
        nid = maneuvering_sat["norad_id"]
        if nid in sat_cache:
            sat_cache[nid]["maneuver_offset"] = True
            sat_cache[nid]["offset_applied_at"] = datetime.utcnow()
            sat_cache[nid]["lon_offset_rate"] = dv_ratio * 0.1

    # Retrieve original conjunction info for pc_before / miss_km_before
    active_conjunctions = state.get("active_conjunctions", [])
    current_event = next((c for c in active_conjunctions if c["event_id"] == event_id), {})

    pc_before = current_event.get("pc", 0.0)
    pc_after = winning_proposal["post_maneuver_pc"]
    dv = winning_proposal["delta_v_ms"]
    sat_name = winning_proposal["satellite_name"]
    direction = winning_proposal["burn_direction"]

    exec_messages = [
        "[EXECUTOR] Maneuver approved and executed",
        f"[EXECUTOR] {sat_name} \u2014 burn: {dv:.3f} m/s {direction}",
        f"[EXECUTOR] Pc: {pc_before:.2e} \u2192 {pc_after:.2e} \u2713 SAFE",
        "[EXECUTOR] Conjunction RESOLVED",
    ]

    # 3. Queue maneuver_executed WS event
    ws_event = WSMessage.now(
        type_=WSMessageType.maneuver_executed,
        payload={
            "event_id": event_id,
            "satellite_name": sat_name,
            "operator": winning_proposal["operator"],
            "delta_v_ms": dv,
            "pc_before": pc_before,
            "pc_after": pc_after,
            "miss_km_before": current_event.get("miss_distance_km", 0.0),
            "miss_km_after": winning_proposal["post_maneuver_miss_km"],
            "burn_time": winning_proposal["burn_time"],
            "computation_trace": winning_proposal.get("computation_trace", []),
            "messages": exec_messages,
        }
    ).model_dump()

    return {
        "phase": "resolved",
        "messages": state.get("messages", []) + exec_messages,
        "websocket_events": state.get("websocket_events", []) + [ws_event]
    }
