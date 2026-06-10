"""
backend/orbital/conjunction.py — Conjunction detection and maneuver calculation.

⚠️  PLACEHOLDER FILE — Interface is LOCKED per PRD Section 11.
    Raghav owns the real implementations of find_tca() and compute_minimum_delta_v().
    Do NOT change the dataclass definitions or function signatures.

Public API:
  ConjunctionInput   — dataclass (PRD §11)
  ConjunctionOutput  — dataclass (PRD §11)
  ManeuverInput      — dataclass (PRD §11)
  ManeuverOutput     — dataclass (PRD §11)

  compute_pc_simplified(miss_distance_km, relative_velocity_km_s) -> float
  find_tca(input: ConjunctionInput) -> ConjunctionOutput     [PLACEHOLDER]
  compute_minimum_delta_v(input: ManeuverInput) -> ManeuverOutput  [PLACEHOLDER]

PRD references: Section 8.3, Section 11
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

# ---------------------------------------------------------------------------
# Screening thresholds (PRD §8.3)
# ---------------------------------------------------------------------------

SCREENING_DISTANCE_KM: float = 5.0    # Flag pairs closer than this
PC_ALERT_THRESHOLD: float = 1e-4      # Trigger maneuver negotiation
PC_SAFE_THRESHOLD: float = 1e-6       # Target Pc after maneuver

# ---------------------------------------------------------------------------
# Interface dataclasses — LOCKED (PRD §11 — do not change)
# ---------------------------------------------------------------------------


@dataclass
class ConjunctionInput:
    sat1_satrec: Any       # sgp4 Satrec object
    sat2_satrec: Any       # sgp4 Satrec object
    t_start: datetime      # Search window start (UTC)
    t_end: datetime        # Search window end (UTC)


@dataclass
class ConjunctionOutput:
    tca: datetime              # Time of Closest Approach
    miss_distance_km: float    # Miss distance at TCA
    pc: float                  # Collision probability
    relative_velocity_km_s: float


@dataclass
class ManeuverInput:
    sat_maneuvering_satrec: Any   # Satellite that will maneuver
    sat_other_satrec: Any         # Satellite that holds position
    tca: datetime                 # TCA from conjunction detection
    burn_lead_time_minutes: int   # Default: 60


@dataclass
class ManeuverOutput:
    delta_v_ms: float             # Minimum delta-V in m/s
    burn_direction: str           # "prograde" | "retrograde"
    burn_time: datetime
    post_maneuver_pc: float
    post_maneuver_miss_km: float


# ---------------------------------------------------------------------------
# Pc helper — exact formula from PRD §8.3
# ---------------------------------------------------------------------------


def compute_pc_simplified(
    miss_distance_km: float,
    relative_velocity_km_s: float,
    combined_radius_km: float = 0.01,
) -> float:
    """Simplified Pc calculation for demo purposes.

    Uses a 1-D Gaussian approximation.  Real Pc requires covariance matrices
    (not available from TLE alone).  For the demo we use a conservative
    position uncertainty of 1 km (typical TLE accuracy).

    Args:
        miss_distance_km:       Scalar miss distance at TCA (km).
        relative_velocity_km_s: Relative speed at TCA (km/s).  Not used in
                                 this simplified model but kept in the
                                 signature for API compatibility.
        combined_radius_km:     Sum of the hard-body radii of the two objects
                                 (default 0.01 km = 10 m).

    Returns:
        Collision probability as a float clamped to [0, 1].
    """
    sigma = 1.0  # km — TLE position uncertainty (conservative)
    # 2-D Gaussian encounter probability (PRD §8.3 formula verbatim)
    pc = (
        math.exp(-0.5 * (miss_distance_km / sigma) ** 2)
        * (combined_radius_km / sigma) ** 2
        * math.pi
    )
    return min(max(pc, 0.0), 1.0)


# ---------------------------------------------------------------------------
# find_tca — PLACEHOLDER (Raghav implements real SGP4 binary search)
# ---------------------------------------------------------------------------


def find_tca(input: ConjunctionInput) -> ConjunctionOutput:  # noqa: A002
    """Find Time of Closest Approach between two satellites.

    # PLACEHOLDER — Raghav implements real SGP4 binary search.
    # Real implementation: coarse time-step scan + scipy.optimize.minimize_scalar.
    # See PRD §8.3 and §11 for the full algorithm description.

    Returns a fixed synthetic conjunction that matches the demo script values
    (PRD §12):
      miss_distance_km = 0.3 km
      pc               = 1.2e-3
      relative_velocity_km_s = 14.2 km/s
      tca              = t_start + 2 hours
    """
    # PLACEHOLDER - Raghav implements real SGP4 binary search
    return ConjunctionOutput(
        tca=input.t_start + timedelta(hours=2),
        miss_distance_km=0.3,
        pc=0.0012,
        relative_velocity_km_s=14.2,
    )


# ---------------------------------------------------------------------------
# compute_minimum_delta_v — PLACEHOLDER (Raghav implements CW equations)
# ---------------------------------------------------------------------------


def compute_minimum_delta_v(input: ManeuverInput) -> ManeuverOutput:  # noqa: A002
    """Calculate the minimum delta-V maneuver to resolve a conjunction.

    # PLACEHOLDER — Raghav implements Clohessy-Wiltshire (CW) relative-motion
    # equations.  See PRD §8.4 and §11 for the CW equation reference and the
    # binary-search approach for finding minimum delta-V.

    Returns fixed synthetic maneuver values that match the demo script
    (PRD §12):
      delta_v_ms          = 0.087 m/s  (prograde burn)
      post_maneuver_pc    = 3.1e-7
      post_maneuver_miss_km = 0.8 km
      burn_time           = tca - burn_lead_time_minutes
    """
    burn_time = input.tca - timedelta(minutes=input.burn_lead_time_minutes)

    # PLACEHOLDER - Raghav implements CW equations
    return ManeuverOutput(
        delta_v_ms=0.087,
        burn_direction="prograde",
        burn_time=burn_time,
        post_maneuver_pc=3.1e-7,
        post_maneuver_miss_km=0.8,
    )
