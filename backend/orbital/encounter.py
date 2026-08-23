"""
backend/orbital/encounter.py: separation-vs-time series and true-scale TCA
geometry for a conjunction, reusing the app's existing physics.

Pre-maneuver series: real SGP4 tracks for both craft (the same propagation
`api/routes.py`'s /paths endpoint uses), differenced at each sample.

Post-maneuver series: the SAME method `api/routes.py::_post_maneuver_track`
uses for the globe's post-burn trajectory -- SGP4 state at the burn epoch,
the winning proposal's delta-V applied as an along-track impulse, propagated
as a two-body DIFFERENTIAL and added back onto the SGP4 track. Absolute
two-body propagation is deliberately not used here: it drifts ~16 km over
30 minutes, which would swamp the few km a maneuver actually buys.

Does not touch `conjunction.py`'s Pc formula or `find_tca` -- this module
only reads a conjunction's already-computed TCA and proposal, and re-derives
separation from the propagator.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

from backend.orbital.propagator import propagate_at, propagate_two_body

# Sampling window centred on TCA. Coarse across the full window keeps the
# chart smooth without excessive points; fine near TCA captures the sharp
# turn of the separation curve where it matters most.
COARSE_HALF_WINDOW_S = 1800
COARSE_STEP_S = 30
FINE_HALF_WINDOW_S = 60
FINE_STEP_S = 2


def sample_offsets() -> list[int]:
    """Seconds relative to TCA to sample at, ascending, deduplicated."""
    coarse = range(-COARSE_HALF_WINDOW_S, COARSE_HALF_WINDOW_S + 1, COARSE_STEP_S)
    fine = range(-FINE_HALF_WINDOW_S, FINE_HALF_WINDOW_S + 1, FINE_STEP_S)
    return sorted(set(coarse) | set(fine))


@dataclass
class SeparationPoint:
    offset_s: int
    separation_km: float
    r_primary: np.ndarray
    r_secondary: np.ndarray
    v_primary: np.ndarray
    v_secondary: np.ndarray


def build_pre_maneuver_series(
    satrec_primary, satrec_secondary, tca: datetime
) -> list[SeparationPoint]:
    """Separation over time along the original (unaltered) SGP4 tracks."""
    points: list[SeparationPoint] = []
    for off in sample_offsets():
        t = tca + timedelta(seconds=off)
        r1, v1 = propagate_at(satrec_primary, t)
        r2, v2 = propagate_at(satrec_secondary, t)
        if r1 is None or r2 is None:
            continue
        r1 = np.asarray(r1, dtype=float)
        r2 = np.asarray(r2, dtype=float)
        v1 = np.asarray(v1, dtype=float)
        v2 = np.asarray(v2, dtype=float)
        points.append(
            SeparationPoint(off, float(np.linalg.norm(r1 - r2)), r1, r2, v1, v2)
        )
    return points


def build_post_maneuver_series(
    satrec_primary,
    satrec_secondary,
    maneuvering_is_primary: bool,
    tca: datetime,
    burn_time: datetime,
    delta_v_ms: float,
    burn_direction: str,
) -> list[SeparationPoint] | None:
    """Separation over time with the winning burn applied to whichever craft
    maneuvers, using the same SGP4 + two-body-differential method as
    `api/routes.py::_post_maneuver_track`. Returns None on propagation
    failure at the burn epoch, mirroring that function's contract.
    """
    if burn_time.tzinfo is None:
        burn_time = burn_time.replace(tzinfo=timezone.utc)

    satrec_maneuvering = satrec_primary if maneuvering_is_primary else satrec_secondary
    satrec_other = satrec_secondary if maneuvering_is_primary else satrec_primary

    r_burn, v_burn = propagate_at(satrec_maneuvering, burn_time)
    if r_burn is None or v_burn is None:
        return None
    r_burn = np.asarray(r_burn, dtype=float)
    v_burn = np.asarray(v_burn, dtype=float)

    speed = float(np.linalg.norm(v_burn))
    if speed <= 0:
        return None
    # Retrograde burns slow the craft down, so the impulse opposes velocity.
    sign = -1.0 if burn_direction == "retrograde" else 1.0
    dv_km_s = delta_v_ms / 1000.0
    v_burned = v_burn + sign * dv_km_s * (v_burn / speed)

    points: list[SeparationPoint] = []
    for off in sample_offsets():
        t = tca + timedelta(seconds=off)
        nominal, v_nominal = propagate_at(satrec_maneuvering, t)
        other_pos, other_vel = propagate_at(satrec_other, t)
        if nominal is None or other_pos is None:
            continue
        nominal = np.asarray(nominal, dtype=float)
        v_nominal = np.asarray(v_nominal, dtype=float)
        other_pos = np.asarray(other_pos, dtype=float)
        other_vel = np.asarray(other_vel, dtype=float)

        if t <= burn_time:
            pos_man, vel_man = nominal, v_nominal  # burn has not happened yet
        else:
            try:
                base, base_v = propagate_two_body(r_burn, v_burn, burn_time, t)
                bent, bent_v = propagate_two_body(r_burn, v_burned, burn_time, t)
            except ValueError:
                continue
            pos_man = nominal + (bent - base)
            vel_man = v_nominal + (bent_v - base_v)

        if maneuvering_is_primary:
            r_primary, v_primary = pos_man, vel_man
            r_secondary, v_secondary = other_pos, other_vel
        else:
            r_primary, v_primary = other_pos, other_vel
            r_secondary, v_secondary = pos_man, vel_man

        points.append(
            SeparationPoint(
                off,
                float(np.linalg.norm(r_primary - r_secondary)),
                r_primary,
                r_secondary,
                v_primary,
                v_secondary,
            )
        )
    return points or None


def min_point(points: list[SeparationPoint]) -> SeparationPoint:
    return min(points, key=lambda p: p.separation_km)


def local_frame_positions(point: SeparationPoint) -> tuple[dict, dict]:
    """Both craft's positions at ``point``, in a local encounter frame:
    origin at the midpoint between them, x along the miss vector (primary
    to secondary), z along the closing (relative-velocity) direction, y
    completing a right-handed frame. Kilometres, relative to the encounter
    point rather than ECI, so a frontend can plot a true-scale close-up
    without any orbital mechanics of its own.
    """
    r1, r2 = point.r_primary, point.r_secondary
    origin = (r1 + r2) / 2.0
    rel = r2 - r1
    rel_norm = float(np.linalg.norm(rel))
    x_hat = rel / rel_norm if rel_norm > 1e-9 else np.array([1.0, 0.0, 0.0])

    rel_vel = point.v_secondary - point.v_primary
    z_seed = rel_vel - float(np.dot(rel_vel, x_hat)) * x_hat
    z_norm = float(np.linalg.norm(z_seed))
    if z_norm > 1e-9:
        z_hat = z_seed / z_norm
    else:
        # Degenerate (closing velocity parallel to the miss vector, or zero
        # relative velocity): fall back to any axis orthogonal to x_hat.
        seed = np.array([0.0, 0.0, 1.0])
        if abs(float(np.dot(seed, x_hat))) > 0.99:
            seed = np.array([0.0, 1.0, 0.0])
        z_hat = np.cross(x_hat, seed)
        z_hat /= np.linalg.norm(z_hat)
    y_hat = np.cross(z_hat, x_hat)

    def _local(r: np.ndarray) -> dict:
        d = r - origin
        return {
            "x_km": float(np.dot(d, x_hat)),
            "y_km": float(np.dot(d, y_hat)),
            "z_km": float(np.dot(d, z_hat)),
        }

    return _local(r1), _local(r2)
