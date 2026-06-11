"""
backend/api/schemas.py — Pydantic v2 request/response models.

All types match PRD.md Sections 6.3, 6.4, 6.5 and the REST endpoint
specs in Section 7.  Do not add fields without updating the PRD.

Models
------
WSMessageType   Enum of all valid WebSocket message type strings (PRD §6.5)
WSMessage       WebSocket envelope sent over /ws
SatellitePosition  Satellite position payload inside satellite_update
ConjunctionEventResponse  REST response for GET /api/conjunctions
ManeuverProposalResponse  Bid/proposal detail
HITLDecision    POST body for /api/hitl/{event_id}/approve|veto
MetricsResponse GET /api/metrics response
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# WebSocket message type enum — PRD §6.5
# ---------------------------------------------------------------------------


class WSMessageType(str, Enum):
    satellite_update    = "satellite_update"
    conjunction_detected = "conjunction_detected"
    negotiation_update  = "negotiation_update"
    hitl_request        = "hitl_request"
    maneuver_executed   = "maneuver_executed"
    metrics_update      = "metrics_update"
    system_status       = "system_status"


class WSMessage(BaseModel):
    """WebSocket envelope — PRD §6.5.

    All outbound WebSocket messages use this wrapper so the frontend
    can dispatch on ``type`` without inspecting ``payload``.
    """

    type: WSMessageType
    timestamp: str = Field(
        description="ISO 8601 UTC timestamp, e.g. '2026-06-12T11:00:00Z'"
    )
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description="Message-type-specific payload (see PRD §6.5 for shape per type)",
    )

    @classmethod
    def now(cls, type_: WSMessageType, payload: dict[str, Any]) -> "WSMessage":
        """Convenience factory — stamps timestamp as current UTC ISO string."""
        return cls(
            type=type_,
            timestamp=datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            payload=payload,
        )


# ---------------------------------------------------------------------------
# Satellite position — payload element inside satellite_update (PRD §6.5)
# ---------------------------------------------------------------------------


class ECIPosition(BaseModel):
    """ECI Cartesian coordinates in km."""

    x: float
    y: float
    z: float


class SatellitePosition(BaseModel):
    """Single satellite entry in a satellite_update payload (PRD §6.5)."""

    norad_id: str
    name: str
    operator: str = Field(description="e.g. 'SpaceX', 'OneWeb', 'Demo_A'")
    position: ECIPosition = Field(description="ECI position in km")
    lat: float = Field(description="Geodetic latitude in degrees")
    lon: float = Field(description="Geodetic longitude in degrees")
    alt_km: float = Field(description="Altitude above WGS-84 ellipsoid in km")
    is_highlighted: bool = Field(
        default=False,
        description="True when this satellite is part of an active conjunction pair",
    )


# ---------------------------------------------------------------------------
# Conjunction event — PRD §6.3  (REST response)
# ---------------------------------------------------------------------------


class ConjunctionEventResponse(BaseModel):
    """Response model for GET /api/conjunctions and GET /api/conjunctions/{event_id}.

    Maps the internal ConjunctionEvent dataclass to a JSON-serialisable form
    suitable for the REST API.  PRD §6.3.
    """

    event_id: str = Field(description="UUID")
    sat_primary: str = Field(description="Primary satellite name")
    sat_secondary: str = Field(description="Secondary satellite name")
    operator_primary: str
    operator_secondary: str
    tca: datetime = Field(description="Time of Closest Approach (UTC)")
    tca_iso: str = Field(description="TCA as ISO 8601 string for frontend convenience")
    miss_distance_km: float
    pc: float = Field(description="Collision probability 0-1")
    relative_velocity_km_s: float
    status: str = Field(
        description="'detected' | 'negotiating' | 'pending_hitl' | 'resolved' | 'vetoed'"
    )
    created_at: datetime
    resolved_at: datetime | None = None


# ---------------------------------------------------------------------------
# Maneuver proposal — PRD §6.4  (REST response)
# ---------------------------------------------------------------------------


class ManeuverProposalResponse(BaseModel):
    """Response model for a maneuver bid.  PRD §6.4."""

    proposal_id: str = Field(description="UUID")
    event_id: str
    operator: str
    satellite_name: str
    delta_v_ms: float = Field(description="Minimum delta-V in m/s")
    burn_direction: str = Field(description="'prograde' | 'retrograde' | 'radial'")
    burn_time: datetime
    post_maneuver_pc: float = Field(description="Expected Pc after maneuver")
    post_maneuver_miss_km: float
    fuel_cost_units: float = Field(description="Fuel units consumed")
    bid_score: float = Field(
        description="Lower is better — combines delta_v + maneuver_count penalty"
    )


# ---------------------------------------------------------------------------
# HITL decision — POST /api/hitl/{event_id}/approve|veto  (request body)
# ---------------------------------------------------------------------------


class HITLDecisionEnum(str, Enum):
    approve = "approve"
    veto    = "veto"


class HITLDecision(BaseModel):
    """Request body for POST /api/hitl/{event_id}/approve and /veto."""

    event_id: str
    decision: HITLDecisionEnum = Field(description="'approve' | 'veto'")


# ---------------------------------------------------------------------------
# Metrics — GET /api/metrics  (response)
# ---------------------------------------------------------------------------


class MetricsResponse(BaseModel):
    """Response for GET /api/metrics — always-visible top bar data (PRD §10.3)."""

    active_satellites: int = Field(description="Number of satellites currently tracked")
    conjunctions_detected: int = Field(description="Total conjunction events detected")
    resolved: int = Field(description="Conjunctions resolved by approved maneuver")
    maneuvers_executed: int = Field(description="Total burns executed")
    total_delta_v: float = Field(description="Sum of all delta-V executed (m/s)")
    system_status: str = Field(
        description="'ACTIVE' | 'IDLE' | 'ERROR'",
        default="ACTIVE",
    )
