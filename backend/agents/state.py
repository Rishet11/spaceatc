"""
backend/agents/state.py — LangGraph AgentState TypedDict.

Exactly matches PRD.md Section 9.1.  Do not add extra fields without
updating the graph and all node implementations.

Valid phase values:
  "idle" | "ingesting" | "screening" | "negotiating" | "pending_hitl" | "resolved"

Valid hitl_decision values:
  "approve" | "veto" | None
"""

from typing import Optional, TypedDict


class AgentState(TypedDict):
    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    session_id: str
    phase: str  # "idle" | "ingesting" | "screening" | "negotiating" | "pending_hitl" | "resolved"

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------
    satellites: list[dict]           # List of Satellite dicts (PRD §6.2)
    active_conjunctions: list[dict]  # List of ConjunctionEvent dicts (PRD §6.3)

    # ------------------------------------------------------------------
    # Negotiation
    # ------------------------------------------------------------------
    current_event_id: Optional[str]
    proposals: list[dict]            # List of ManeuverProposal dicts (PRD §6.4)
    winning_proposal: Optional[dict]

    # ------------------------------------------------------------------
    # HITL
    # ------------------------------------------------------------------
    hitl_decision: Optional[str]     # "approve" | "veto" | None
    hitl_timeout: bool

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------
    messages: list[str]              # Human-readable log lines for EventFeed
    websocket_events: list[dict]     # Queued WS envelope dicts to broadcast (PRD §6.5)


def initial_state(session_id: str) -> AgentState:
    """Return a fresh AgentState with all fields at their zero values.

    Use this when starting a new pipeline run to avoid missing-key errors.

    Args:
        session_id: Unique identifier for this run (e.g. a UUID string).

    Returns:
        Fully-initialised AgentState dict.
    """
    return AgentState(
        session_id=session_id,
        phase="idle",
        satellites=[],
        active_conjunctions=[],
        current_event_id=None,
        proposals=[],
        winning_proposal=None,
        hitl_decision=None,
        hitl_timeout=False,
        messages=[],
        websocket_events=[],
    )
