"""
backend/agents/nodes/conjunction_detector.py — Node 2: Screen for conjunctions.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta

from backend.agents.state import AgentState
from backend.api.schemas import WSMessage, WSMessageType
from backend.db.store import insert_conjunction
from backend.orbital.conjunction import ConjunctionInput, find_tca, PC_ALERT_THRESHOLD

logger = logging.getLogger(__name__)

async def detect_conjunctions(state: AgentState) -> dict:
    """
    Take first 20 pairs from different operators, run TCA placeholder.
    If pc > alert_threshold, save to DB and queue WS event.
    """
    logger.info("Node: detect_conjunctions starting...")
    
    satellites = state.get("satellites", [])
    if not satellites:
        return {"phase": "resolved"}
        
    pairs_checked = 0
    active_conjunctions = list(state.get("active_conjunctions", []))
    ws_events = list(state.get("websocket_events", []))
    
    now = datetime.now(tz=timezone.utc)
    t_end = now + timedelta(days=3)
    
    # 1. Take first 20 pairs from different operators
    for i, sat1 in enumerate(satellites):
        for j, sat2 in enumerate(satellites[i+1:]):
            if sat1["operator"] == sat2["operator"]:
                continue
                
            if pairs_checked >= 20:
                break
                
            pairs_checked += 1
            
            # 2. Call find_tca — real SGP4 coarse scan + scipy refinement
            from backend.api.routes import sat_cache
            sat1_cache = sat_cache.get(sat1["norad_id"])
            sat2_cache = sat_cache.get(sat2["norad_id"])
            if not sat1_cache or not sat2_cache:
                continue
                
            c_input = ConjunctionInput(
                sat1_satrec=sat1_cache["satrec"],
                sat2_satrec=sat2_cache["satrec"],
                t_start=now,
                t_end=t_end
            )
            
            c_out = await asyncio.to_thread(find_tca, c_input)
            
            # 3. Check threshold
            if c_out.pc > PC_ALERT_THRESHOLD:
                event_id = str(uuid.uuid4())
                
                event_dict = {
                    "event_id": event_id,
                    "sat_primary": sat1["name"],
                    "sat_secondary": sat2["name"],
                    "tca": c_out.tca.isoformat(),
                    "miss_distance_km": c_out.miss_distance_km,
                    "pc": c_out.pc,
                    "relative_velocity_km_s": c_out.relative_velocity_km_s,
                    "status": "detected",
                    "created_at": now.isoformat(),
                    
                    # Store objects for next nodes
                    "sat_primary_obj": sat1,
                    "sat_secondary_obj": sat2,
                }
                
                # Save to DB (only fields that map to columns)
                await insert_conjunction({
                    "event_id": event_id,
                    "sat_primary": sat1["name"],
                    "sat_secondary": sat2["name"],
                    "tca": c_out.tca.isoformat(),
                    "miss_distance_km": c_out.miss_distance_km,
                    "pc": c_out.pc,
                    "relative_velocity_km_s": c_out.relative_velocity_km_s,
                    "status": "detected",
                    "created_at": now.isoformat(),
                    "session_id": state["session_id"],
                })
                
                active_conjunctions.append(event_dict)
                
                # Queue WS event
                ws_payload = {
                    "event_id": event_id,
                    "sat_primary": sat1["name"],
                    "sat_secondary": sat2["name"],
                    "tca_iso": c_out.tca.isoformat(),
                    "miss_distance_km": c_out.miss_distance_km,
                    "pc": c_out.pc,
                    "relative_velocity_km_s": c_out.relative_velocity_km_s
                }
                
                ws_events.append(WSMessage.now(
                    type_=WSMessageType.conjunction_detected,
                    payload={
                        **ws_payload,
                        "messages": [
                            f"[DETECTOR] Conjunction: {sat1['name']} / {sat2['name']}",
                            f"[DETECTOR] Miss distance: {c_out.miss_distance_km:.3f} km | Pc: 1 in {int(1/c_out.pc)} | TCA: {c_out.tca.strftime('%H:%M:%S')} UTC",
                            "[DETECTOR] Status: ALERT \u2014 Pc exceeds 1\u00d710\u207b\u2074 threshold",
                        ]
                    }
                ).model_dump())
                
        if pairs_checked >= 20:
            break
            
    new_conj = len(active_conjunctions) - len(state.get('active_conjunctions', []))
    msg = f"[DETECTOR] Screened {pairs_checked} pairs. Found {new_conj} conjunction(s) requiring attention."
    next_phase = "negotiating" if active_conjunctions else "resolved"

    return {
        "phase": next_phase,
        "active_conjunctions": active_conjunctions,
        "messages": state.get("messages", []) + [msg],
        "websocket_events": ws_events
    }
