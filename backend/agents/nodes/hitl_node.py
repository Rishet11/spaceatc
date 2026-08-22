"""
backend/agents/nodes/hitl_node.py — Node 5: Wait for human-in-the-loop approval.
"""

import logging

from backend.agents.state import AgentState

logger = logging.getLogger(__name__)

async def await_hitl(state: AgentState) -> dict:
    """
    Pause the graph execution until resumed.
    """
    logger.info("Node: await_hitl starting...")
    
    if state.get("hitl_decision"):
        logger.info(f"Resuming with decision: {state.get('hitl_decision')}")
        return {"phase": "hitl_resolved"}
        
    winning_proposal = state.get("winning_proposal")
    if not winning_proposal:
        return {"phase": "resolved"}

    return {"phase": "pending_hitl"}
