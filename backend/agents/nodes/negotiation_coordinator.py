"""
backend/agents/nodes/negotiation_coordinator.py — Node 3: Coordinate maneuver bidding.
"""

import logging

from backend.agents.state import AgentState
from backend.api.schemas import WSMessage, WSMessageType

logger = logging.getLogger(__name__)

async def coordinate_negotiation(state: AgentState) -> dict:
    """
    Pick highest Pc conjunction, set current event, and request bids.
    """
    logger.info("Node: coordinate_negotiation starting...")
    
    active_conjunctions = state.get("active_conjunctions", [])
    
    if not active_conjunctions:
        return {"phase": "resolved"}
        
    # 1. Pick highest Pc conjunction
    # In a real system we'd process all of them, but the demo focuses on one
    highest_pc_event = max(active_conjunctions, key=lambda x: x["pc"])
    
    # 2. Set current_event_id
    current_event_id = highest_pc_event["event_id"]
    
    msg = f"[Negotiation] Started bidding for event {current_event_id[:8]}... (Pc={highest_pc_event['pc']:.2e})"
    
    # 3. Queue negotiation_update
    ws_event = WSMessage.now(
        type_=WSMessageType.negotiation_update,
        payload={
            "event_id": current_event_id,
            "stage": "bids_requested",
            "message": "Operators are formulating maneuver proposals"
        }
    ).model_dump()
    
    return {
        "current_event_id": current_event_id,
        "messages": state.get("messages", []) + [msg],
        "websocket_events": state.get("websocket_events", []) + [ws_event]
    }
