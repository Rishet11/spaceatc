"""
backend/agents/nodes/operator_agent.py — Node 4: Generate and score operator bids.
"""

import logging
import uuid
from datetime import datetime

from backend.agents.state import AgentState
from backend.api.schemas import WSMessage, WSMessageType
from backend.db.store import insert_proposal
from backend.orbital.conjunction import ManeuverInput, compute_minimum_delta_v

logger = logging.getLogger(__name__)

async def generate_operator_bid(state: AgentState) -> dict:
    """
    Generate a bid for both operators involved, score them, pick winner.
    """
    logger.info("Node: generate_operator_bid starting...")
    
    current_event_id = state.get("current_event_id")
    if not current_event_id:
        return {"phase": "resolved"}
        
    # 1. Get current conjunction
    active_conjunctions = state.get("active_conjunctions", [])
    current_event = next((c for c in active_conjunctions if c["event_id"] == current_event_id), None)
    
    if not current_event:
        return {"phase": "resolved"}
        
    sat1 = current_event["sat_primary_obj"]
    sat2 = current_event["sat_secondary_obj"]
    tca = datetime.fromisoformat(current_event["tca"])
    
    proposals = []
    
    # 2. Call compute_minimum_delta_v placeholder for each operator
    for i, (maneuvering_sat, other_sat) in enumerate([(sat1, sat2), (sat2, sat1)]):
        
        from backend.api.routes import sat_cache
        m_cache = sat_cache.get(maneuvering_sat["norad_id"], {})
        o_cache = sat_cache.get(other_sat["norad_id"], {})
        
        m_input = ManeuverInput(
            sat_maneuvering_satrec=m_cache.get("satrec"),
            sat_other_satrec=o_cache.get("satrec"),
            tca=tca,
            burn_lead_time_minutes=60
        )
        
        m_out = compute_minimum_delta_v(m_input)
        
        # Base dv is same for placeholder, let's slightly modify one to make a clear winner
        dv = m_out.delta_v_ms * (1.0 + (0.1 * i)) # Sat2 bid will be slightly worse for demo variety
        
        # 3. Compute bid_score = delta_v_ms + (maneuver_count * 0.1)
        maneuver_count = maneuvering_sat.get("maneuver_count", 0)
        bid_score = dv + (maneuver_count * 0.1)
        
        proposal = {
            "proposal_id": str(uuid.uuid4()),
            "event_id": current_event_id,
            "operator": maneuvering_sat["operator"],
            "satellite_name": maneuvering_sat["name"],
            "delta_v_ms": dv,
            "burn_direction": m_out.burn_direction,
            "burn_time": m_out.burn_time.isoformat(),
            "post_maneuver_pc": m_out.post_maneuver_pc,
            "post_maneuver_miss_km": m_out.post_maneuver_miss_km,
            "fuel_cost_units": dv * 1.5, # Fake multiplier for fuel
            "bid_score": bid_score,
            "maneuvering_sat_obj": maneuvering_sat # Store for executor
        }
        
        await insert_proposal({k: v for k, v in proposal.items() if k != "maneuvering_sat_obj"})
        proposals.append(proposal)
        
    # 4. Pick winner (lower score)
    winning_proposal = min(proposals, key=lambda x: x["bid_score"])
    
    msg = f"[Operator] Received {len(proposals)} bids. Selected {winning_proposal['operator']} ({winning_proposal['satellite_name']}) with score {winning_proposal['bid_score']:.3f}"
    
    # Queue negotiation_update (stage: "winner_selected")
    ws_event = WSMessage.now(
        type_=WSMessageType.negotiation_update,
        payload={
            "event_id": current_event_id,
            "stage": "winner_selected",
            "winner": winning_proposal["operator"],
            "winning_bid_score": winning_proposal["bid_score"]
        }
    ).model_dump()
    
    return {
        "phase": "pending_hitl",
        "proposals": state.get("proposals", []) + proposals,
        "winning_proposal": winning_proposal,
        "messages": state.get("messages", []) + [msg],
        "websocket_events": state.get("websocket_events", []) + [ws_event]
    }
