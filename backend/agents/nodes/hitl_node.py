"""
backend/agents/nodes/hitl_node.py — Node 5: Wait for human-in-the-loop approval.
"""

import logging

from backend.agents.state import AgentState
from backend.api.schemas import WSMessage, WSMessageType

logger = logging.getLogger(__name__)

async def await_hitl(state: AgentState) -> dict:
    """
    Queue hitl_request WS event and pause the graph execution until resumed.
    """
    logger.info("Node: await_hitl starting...")
    
    if state.get("hitl_decision"):
        logger.info(f"Resuming with decision: {state.get('hitl_decision')}")
        return {"phase": "hitl_resolved"}
        
    winning_proposal = state.get("winning_proposal")
    if not winning_proposal:
        return {"phase": "resolved"}
        
    msg = f"[HITL] Pausing for human approval on proposal {winning_proposal['proposal_id'][:8]}..."
    
    ws_event = WSMessage.now(
        type_=WSMessageType.hitl_request,
        payload={
            "event_id": winning_proposal["event_id"],
            "proposal": {k: v for k, v in winning_proposal.items() if k != "maneuvering_sat_obj"}
        }
    ).model_dump()
    
    # We yield the state updates *before* the interrupt
    updated_state = {
        "phase": "pending_hitl",
        "messages": state.get("messages", []) + [msg],
        "websocket_events": state.get("websocket_events", []) + [ws_event]
    }
    
    # In LangGraph, since we use interrupt_before=["await_hitl"], the graph pauses 
    # *before* entering this node. When we call astream(None) to resume, this node 
    # executes. We just return the updated state to pass through to execute_maneuver.
    return updated_state
