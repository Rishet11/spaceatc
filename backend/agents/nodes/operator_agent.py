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

    # 2. Call compute_minimum_delta_v for each operator — real CW math
    for i, (maneuvering_sat, other_sat) in enumerate([(sat1, sat2), (sat2, sat1)]):

        from backend.api.routes import sat_cache
        m_cache = sat_cache.get(maneuvering_sat["norad_id"], {})
        o_cache = sat_cache.get(other_sat["norad_id"], {})
        m_satrec = m_cache.get("satrec")
        o_satrec = o_cache.get("satrec")

        if m_satrec is None or o_satrec is None:
            logger.warning(
                "Missing satrec for %s or %s; aborting bid generation for event %s",
                maneuvering_sat.get("norad_id"), other_sat.get("norad_id"), current_event_id,
            )
            return {"phase": "resolved"}

        m_input = ManeuverInput(
            sat_maneuvering_satrec=m_satrec,
            sat_other_satrec=o_satrec,
            tca=tca,
            burn_lead_time_minutes=60
        )

        try:
            m_out = compute_minimum_delta_v(m_input)
        except ValueError as e:
            logger.error("compute_minimum_delta_v failed for event %s: %s", current_event_id, e)
            return {"phase": "resolved"}

        # Real per-satellite delta-V: each operator's CW computation uses its
        # own satellite's mean motion (derived from that satellite's TLE), so
        # the two bids differ on genuine orbital geometry rather than an
        # artificial offset.
        dv = m_out.delta_v_ms

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
            "fuel_cost_units": dv * 0.01,  # ~1% of delta-V in fuel units (realistic ratio)
            "bid_score": bid_score,
            "computation_trace": m_out.trace,
            "maneuvering_sat_obj": maneuvering_sat # Store for executor
        }

        proposals.append(proposal)

    # Both proposals computed successfully — persist them together.
    for proposal in proposals:
        await insert_proposal({k: v for k, v in proposal.items() if k not in ["maneuvering_sat_obj", "computation_trace"]})

    # Queue bids_received WS event
    bid_messages = []
    for p in proposals:
        fuel_remaining = max(0.0, p.get("fuel_cost_units", 0) * 100)  # rough % remaining
        # fuel_units start at 100, cost is delta_v * 0.01
        fuel_pct = 100.0 - (p["fuel_cost_units"] / 1.0) * 100  # each fuel_unit = 1%
        fuel_pct = max(0.0, min(100.0, 100.0 - p["delta_v_ms"] * 0.01 * 100))
        bid_messages.append(
            f"[OPERATOR {p['operator']}] Bid: \u0394V={p['delta_v_ms']:.3f} m/s | Score={p['bid_score']:.3f} | Fuel remaining: {100.0 - p['fuel_cost_units']:.0f}%"
        )

    ws_event_bids_received = WSMessage.now(
        type_=WSMessageType.negotiation_update,
        payload={
            "event_id": current_event_id,
            "stage": "bids_received",
            "proposals": [
                {"operator": p["operator"], "delta_v_ms": p["delta_v_ms"], "bid_score": p["bid_score"]}
                for p in proposals
            ],
            "messages": bid_messages,
        }
    ).model_dump()

    # 4. Pick winner (lower score)
    winning_proposal = min(proposals, key=lambda x: x["bid_score"])
    loser_proposal = max(proposals, key=lambda x: x["bid_score"])

    winner = winning_proposal["operator"]
    loser = loser_proposal["operator"]
    winner_dv = winning_proposal["delta_v_ms"]
    loser_dv = loser_proposal["delta_v_ms"]

    rationale = f"{winner} selected: \u0394V {winner_dv:.3f} m/s. Mission impact: LOW."
    from backend.llm import groq_chat
    prompt = f"In one sentence, explain why {winner} was selected over {loser} for this maneuver. Delta-V values: {winner_dv:.3f} m/s vs {loser_dv:.3f} m/s."
    rationale = await groq_chat(prompt) or rationale

    winner_msg = f"[COORDINATOR] Winner: {winner} \u2014 lowest cost maneuver selected"
    all_messages = bid_messages + [winner_msg]

    # Queue negotiation_update (stage: "winner_selected")
    ws_event = WSMessage.now(
        type_=WSMessageType.negotiation_update,
        payload={
            "event_id": current_event_id,
            "stage": "winner_selected",
            "winner": winning_proposal["operator"],
            "winning_bid_score": winning_proposal["bid_score"],
            "messages": [winner_msg],
        }
    ).model_dump()

    # Queue hitl_request
    hitl_messages = [
        "[HITL] Proposal sent to human operator for approval",
        "[HITL] Awaiting decision \u2014 30 second timeout",
    ]
    ws_event_hitl = WSMessage.now(
        type_=WSMessageType.hitl_request,
        payload={
            "event_id": current_event_id,
            "proposal": {k: v for k, v in winning_proposal.items() if k != "maneuvering_sat_obj"},
            "messages": hitl_messages,
        }
    ).model_dump()

    return {
        "phase": "pending_hitl",
        "proposals": state.get("proposals", []) + proposals,
        "winning_proposal": winning_proposal,
        "messages": state.get("messages", []) + all_messages + hitl_messages,
        "websocket_events": state.get("websocket_events", []) + [ws_event_bids_received, ws_event, ws_event_hitl]
    }
