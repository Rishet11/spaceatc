"""
backend/agents/graph.py — LangGraph definition (PRD Section 9.2).
"""

import logging
import aiosqlite

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from backend.agents.nodes.conjunction_detector import detect_conjunctions
from backend.agents.nodes.hitl_node import await_hitl
from backend.agents.nodes.maneuver_executor import execute_maneuver
from backend.agents.nodes.negotiation_coordinator import coordinate_negotiation
from backend.agents.nodes.operator_agent import generate_operator_bid
from backend.agents.nodes.tle_ingestion import ingest_tle
from backend.agents.state import AgentState, initial_state
from backend.config import settings

logger = logging.getLogger(__name__)

def route_after_detection(state: AgentState) -> str:
    """Route after detect_conjunctions."""
    if state.get("active_conjunctions"):
        return "coordinate_negotiation"
    return END

def route_after_hitl(state: AgentState) -> str:
    """Route after human intervention."""
    decision = state.get("hitl_decision")
    if decision == "approve":
        return "execute_maneuver"
    return END

_checkpointer_cm = None
_compiled_graph = None

async def get_graph() -> CompiledStateGraph:
    """
    Build and compile the StateGraph.
    Uses AsyncSqliteSaver for checkpointing state across interrupts.
    """
    global _compiled_graph, _checkpointer_cm
    if _compiled_graph is not None:
        return _compiled_graph

    # Properly enter the context manager to let it manage connections and setup
    _checkpointer_cm = AsyncSqliteSaver.from_conn_string(settings.sqlite_path)
    checkpointer = await _checkpointer_cm.__aenter__()
    
    workflow = StateGraph(AgentState)
    
    # Add nodes
    workflow.add_node("ingest_tle", ingest_tle)
    workflow.add_node("detect_conjunctions", detect_conjunctions)
    workflow.add_node("coordinate_negotiation", coordinate_negotiation)
    workflow.add_node("generate_bids", generate_operator_bid)
    workflow.add_node("await_hitl", await_hitl)
    workflow.add_node("execute_maneuver", execute_maneuver)
    
    # Wire edges
    workflow.add_edge(START, "ingest_tle")
    workflow.add_edge("ingest_tle", "detect_conjunctions")
    
    workflow.add_conditional_edges(
        "detect_conjunctions",
        route_after_detection,
        {"coordinate_negotiation": "coordinate_negotiation", END: END}
    )
    
    workflow.add_edge("coordinate_negotiation", "generate_bids")
    workflow.add_edge("generate_bids", "await_hitl")
    
    workflow.add_conditional_edges(
        "await_hitl",
        route_after_hitl,
        {"execute_maneuver": "execute_maneuver", END: END}
    )
    
    workflow.add_edge("execute_maneuver", END)
    
    _compiled_graph = workflow.compile(
        checkpointer=checkpointer,
        interrupt_before=["await_hitl"]
    )
    return _compiled_graph

async def run_pipeline(session_id: str) -> AgentState:
    """
    Start a fresh pipeline run.
    """
    logger.info(f"Starting pipeline for session: {session_id}")
    app = await get_graph()
    state = initial_state(session_id)
    config = {"configurable": {"thread_id": session_id}}
    
    from backend.main import broadcast_queue

    # Initialize the graph
    await app.aupdate_state(config, state)

    # Stream state values after each node and broadcast only newly appended
    # websocket events. Nodes append to state["websocket_events"] cumulatively,
    # so a cursor over the growing list emits each event exactly once. We do not
    # clear the channel via aupdate_state: it is written by multiple nodes, so a
    # manual update is ambiguous under LangGraph 1.x and raises
    # "Ambiguous update, specify as_node".
    broadcast_count = 0
    async for chunk in app.astream(None, config=config, stream_mode="values"):
        events = chunk.get("websocket_events", [])
        for event in events[broadcast_count:]:
            await broadcast_queue.put(event)
        broadcast_count = len(events)

    final_state = await app.aget_state(config)
    return final_state.values

async def resume_after_hitl(session_id: str, decision: str) -> AgentState:
    """
    Resume a paused pipeline after receiving human approval/veto.
    """
    logger.info(f"Resuming pipeline for session {session_id} with decision: {decision}")
    app = await get_graph()
    config = {"configurable": {"thread_id": session_id}}
    
    # Events broadcast during the pre-HITL run are already in the checkpoint.
    # Seed the cursor past them so the resume only broadcasts new events.
    pre = await app.aget_state(config)
    broadcast_count = len((pre.values or {}).get("websocket_events", []))

    update_data = {"hitl_decision": decision}
    await app.aupdate_state(config, update_data)

    from backend.main import broadcast_queue

    async for chunk in app.astream(None, config=config, stream_mode="values"):
        events = chunk.get("websocket_events", [])
        for event in events[broadcast_count:]:
            await broadcast_queue.put(event)
        broadcast_count = len(events)
            
    final_state = await app.aget_state(config)
    return final_state.values
