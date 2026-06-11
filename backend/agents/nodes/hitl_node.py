"""
backend/agents/nodes/hitl_node.py — Node 5: Wait for human-in-the-loop approval.
"""

import logging

from langgraph.types import interrupt

from backend.agents.state import AgentState
from backend.api.schemas import WSMessage, WSMessageType

logger = logging.getLogger(__name__)

async def await_hitl(state: AgentState) -> dict:
    """
    Queue hitl_request WS event and pause the graph execution until resumed.
    """
    logger.info("Node: await_hitl starting...")
    
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
    
    # In LangGraph 0.1+, interrupt() pauses execution. 
    # When resumed, the graph continues from the *next* node or returns here based on how we structure it.
    # Usually you yield state, then call interrupt(), but inside a node function 
    # we just call it. LangGraph captures the exception and pauses.
    interrupt("Awaiting human approval")
    
    return updated_state
