"""
backend/orbital/conjunction.py — Conjunction detection and maneuver calculation.

Public API:
  ConjunctionInput   — dataclass (PRD §11)
  ConjunctionOutput  — dataclass (PRD §11)
  ManeuverInput      — dataclass (PRD §11)
  ManeuverOutput     — dataclass (PRD §11)

  compute_pc_simplified(miss_distance_km, relative_velocity_km_s) -> float
  find_tca(input: ConjunctionInput) -> ConjunctionOutput
  screen_pairs(satellites, t_start, t_end) -> list[dict]
  compute_minimum_delta_v(input: ManeuverInput) -> ManeuverOutput

PRD references: Section 8.3, Section 11
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import numpy as np
from scipy.optimize import minimize_scalar
from sgp4.api import jday

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
# SGP4 propagation helper
# ---------------------------------------------------------------------------


def _propagate(satrec, dt: datetime):
    """Propagate a satellite to the given datetime using SGP4.

    Args:
        satrec: sgp4 Satrec object.
        dt:     Target datetime (UTC).

    Returns:
        (pos_km, vel_km_s) as numpy arrays in TEME (ECI) frame.
        Returns (None, None) if sgp4 returns a non-zero error code.
    """
    jd, fr = jday(
        dt.year, dt.month, dt.day,
        dt.hour, dt.minute,
        dt.second + dt.microsecond / 1e6,
    )
    e, r, v = satrec.sgp4(jd, fr)
    if e != 0:
        return None, None
    return np.array(r), np.array(v)


# ---------------------------------------------------------------------------
# Pc helper — exact formula from PRD §8.3
# ---------------------------------------------------------------------------


def compute_pc_simplified(
    miss_distance_km: float,
    relative_velocity_km_s: float,
    combined_radius_km: float = 0.01,
) -> float:
    """Simplified Pc calculation for demo purposes.

    Uses a 2-D Gaussian peak-density approximation.  Real Pc requires
    covariance matrices (Akella-Alfriend 2000 / Foster 1992), which are
    not available from TLE alone.  For the demo we use a conservative
    position uncertainty of 1 km (typical TLE accuracy).

    The formula treats the encounter as a random miss vector drawn from a
    2-D isotropic Gaussian with standard deviation *sigma* in each
    encounter-plane direction.  The collision probability is the Gaussian
    density at the miss distance times the hard-body cross-section area:

        Pc = (π · r_combined² / σ²) · exp(−d² / 2σ²)

    This is the formula specified verbatim in PRD §8.3.

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
# find_tca — Real SGP4 coarse-scan + scipy bounded minimisation
# ---------------------------------------------------------------------------


def find_tca(input: ConjunctionInput) -> ConjunctionOutput:  # noqa: A002
    """Find Time of Closest Approach between two satellites.

    Algorithm (PRD §8.3 / Section 11):
        1. **Coarse scan** — evaluate separation every 60 s across the
           [t_start, t_end] window and locate the time-step with minimum
           distance.
        2. **Fine search** — refine within ±1 coarse step using
           ``scipy.optimize.minimize_scalar`` (bounded method).
        3. **Relative velocity** — compute |v1 − v2| at TCA.
        4. **Collision probability** — simplified 2-D Gaussian model
           (no covariance available from TLEs; assumed σ = 1.0 km).

    Args:
        input: ConjunctionInput with two satrec objects and a time window.

    Returns:
        ConjunctionOutput with tca, miss_distance_km, pc, and
        relative_velocity_km_s.
    """
    sat1 = input.sat1_satrec
    sat2 = input.sat2_satrec

    # ------------------------------------------------------------------
    # Step 1 — coarse scan every 60 seconds
    # ------------------------------------------------------------------
    total_seconds = int((input.t_end - input.t_start).total_seconds())
    times = [
        input.t_start + timedelta(seconds=i)
        for i in range(0, total_seconds, 60)
    ]

    separations: list[float] = []
    for t in times:
        r1, _ = _propagate(sat1, t)
        r2, _ = _propagate(sat2, t)
        if r1 is None or r2 is None:
            separations.append(float('inf'))
        else:
            separations.append(float(np.linalg.norm(r1 - r2)))

    min_idx = int(np.argmin(separations))

    # Guard boundary cases: widen to ±1 coarse step around the minimum
    lo_idx = max(0, min_idx - 1)
    hi_idx = min(len(times) - 1, min_idx + 1)
    t_lo = times[lo_idx]
    t_hi = times[hi_idx]

    # ------------------------------------------------------------------
    # Step 2 — fine search with scipy.optimize.minimize_scalar
    # ------------------------------------------------------------------
    def objective(offset_s):
        t = t_lo + timedelta(seconds=float(offset_s))
        r1, _ = _propagate(sat1, t)
        r2, _ = _propagate(sat2, t)
        if r1 is None or r2 is None:
            return float('inf')
        return float(np.linalg.norm(r1 - r2))

    span = (t_hi - t_lo).total_seconds()
    result = minimize_scalar(
        objective,
        bounds=(0, span),
        method='bounded',
    )

    tca = t_lo + timedelta(seconds=float(result.x))
    miss_km = float(result.fun)

    # ------------------------------------------------------------------
    # Step 3 — relative velocity at TCA
    # ------------------------------------------------------------------
    r1_tca, v1_tca = _propagate(sat1, tca)
    r2_tca, v2_tca = _propagate(sat2, tca)
    if v1_tca is None or v2_tca is None:
        rel_v = 14.0  # fallback for typical LEO relative velocity
    else:
        rel_v = float(np.linalg.norm(v1_tca - v2_tca))

    # ------------------------------------------------------------------
    # Step 4 — Pc (simplified, no covariance available from TLEs)
    # ------------------------------------------------------------------
    # This is an approximation.  Real Pc needs covariance matrices
    # (Akella-Alfriend 2000).  Since TLEs don't carry covariance,
    # we use assumed sigma = 1.0 km (typical TLE position error).
    sigma = 1.0        # km — TLE 1-sigma position uncertainty
    r_combined = 0.01  # km — combined hard body radius (~10 m each)

    pc = (
        np.pi * r_combined**2 / sigma**2
        * np.exp(-0.5 * (miss_km / sigma) ** 2)
    )
    pc = float(np.clip(pc, 0.0, 1.0))

    return ConjunctionOutput(
        tca=tca,
        miss_distance_km=miss_km,
        pc=pc,
        relative_velocity_km_s=rel_v,
    )


# ---------------------------------------------------------------------------
# screen_pairs — used by conjunction_detector.py
# ---------------------------------------------------------------------------


def screen_pairs(
    satellites: list,
    t_start: datetime,
    t_end: datetime,
) -> list:
    """Screen satellite pairs for conjunctions above the Pc threshold.

    Args:
        satellites: List of (name, operator, satrec) tuples.
        t_start:    Screening window start (UTC).
        t_end:      Screening window end (UTC).

    Returns:
        List of dicts (one per flagged conjunction) with keys:
        sat_primary, sat_secondary, tca, miss_distance_km, pc,
        relative_velocity_km_s.

    Only pairs from **different** operators are screened.  A quick
    mid-window pre-filter (500 km threshold) is applied first to
    avoid expensive full-window scans on widely separated pairs.
    """
    results: list[dict] = []
    for i in range(len(satellites)):
        for j in range(i + 1, len(satellites)):
            name_i, op_i, sat_i = satellites[i]
            name_j, op_j, sat_j = satellites[j]
            if op_i == op_j:
                continue  # skip same-operator pairs

            # Quick prefilter at midpoint to save compute
            t_mid = t_start + (t_end - t_start) / 2
            r1, _ = _propagate(sat_i, t_mid)
            r2, _ = _propagate(sat_j, t_mid)
            if r1 is None or r2 is None:
                continue
            if np.linalg.norm(r1 - r2) > 500:  # coarse filter (km)
                continue

            out = find_tca(ConjunctionInput(sat_i, sat_j, t_start, t_end))
            if out.pc > PC_ALERT_THRESHOLD:
                results.append({
                    'sat_primary': name_i,
                    'sat_secondary': name_j,
                    'tca': out.tca,
                    'miss_distance_km': out.miss_distance_km,
                    'pc': out.pc,
                    'relative_velocity_km_s': out.relative_velocity_km_s,
                })
    return results


# ---------------------------------------------------------------------------
# compute_minimum_delta_v — CW relative-motion equations
# ---------------------------------------------------------------------------


def compute_minimum_delta_v(input: ManeuverInput) -> ManeuverOutput:  # noqa: A002
    """Calculate the minimum along-track delta-V to resolve a conjunction.

    Uses the Clohessy-Wiltshire (CW) relative-motion equations
    (Clohessy & Wiltshire 1960) in the Hill frame to predict how an
    impulsive along-track burn shifts the maneuvering satellite's
    position at TCA.  A binary search finds the minimum delta-V that
    drives Pc below ``target_pc = 1e-6``.

    Hill frame axes:
        x — radial (outward)
        y — along-track (in velocity direction)
        z — cross-track (completes right-hand frame)

    CW position response to a pure along-track impulse Δv_y applied
    at t = 0, evaluated at elapsed time τ:

        dx(τ) = 2·(1 − cos(nτ)) / n · Δv_y       (radial coupling)
        dy(τ) = (4·sin(nτ) − 3·n·τ) / n · Δv_y   (along-track drift)

    where n = 2π / T is the mean motion of the reference orbit.

    Args:
        input: ManeuverInput with maneuvering satrec, other satrec,
               TCA, and burn lead time.

    Returns:
        ManeuverOutput with minimum delta-V (m/s), burn direction,
        burn time, and post-maneuver Pc / miss distance.

    Raises:
        ValueError: If propagation fails, or the result is physically
                    unreasonable.
    """
    sat_maneuvering = input.sat_maneuvering_satrec
    sat_other = input.sat_other_satrec
    tca = input.tca

    burn_time = tca - timedelta(minutes=input.burn_lead_time_minutes)
    tau = input.burn_lead_time_minutes * 60.0  # seconds

    # ------------------------------------------------------------------
    # LEO orbital parameters (~550 km altitude)
    # ------------------------------------------------------------------
    T_orbit = 5730.0            # orbital period in seconds
    n = 2 * np.pi / T_orbit     # mean motion in rad/s

    # ------------------------------------------------------------------
    # Original miss distance at TCA
    # ------------------------------------------------------------------
    r1_tca, v1_tca = _propagate(sat_maneuvering, tca)
    r2_tca, v2_tca = _propagate(sat_other, tca)
    if r1_tca is None or r2_tca is None:
        raise ValueError("Propagation failed at TCA")

    original_miss = float(np.linalg.norm(r1_tca - r2_tca))
    if v1_tca is not None and v2_tca is not None:
        rel_v = float(np.linalg.norm(v1_tca - v2_tca))
    else:
        rel_v = 14.0  # fallback for typical LEO

    # ------------------------------------------------------------------
    # CW displacement from an along-track impulse
    # ------------------------------------------------------------------
    def get_shift(dv_km_s: float) -> float:
        """Total position shift at TCA from an along-track burn.

        Uses CW state-transition matrix elements for velocity → position:
            dy(τ) = (4·sin(nτ) − 3·n·τ) / n · Δv_y   [along-track]
            dx(τ) = 2·(1 − cos(nτ)) / n · Δv_y        [radial coupling]

        Source: Clohessy & Wiltshire 1960, Hill frame dynamics.
        """
        dy = (4 * np.sin(n * tau) - 3 * n * tau) / n * dv_km_s
        dx = 2 * (1 - np.cos(n * tau)) / n * dv_km_s
        return float(np.sqrt(dx**2 + dy**2))

    def new_miss_and_pc(dv_km_s: float) -> tuple:
        """Compute post-maneuver miss distance and Pc.

        Approximation: the CW shift vector is treated as orthogonal to
        the original miss vector, so new_miss = √(old² + shift²).  This
        is conservative (the actual miss can only be larger if the shift
        has a component along the original miss direction).
        """
        shift = get_shift(abs(dv_km_s))
        new_miss = float(np.sqrt(original_miss**2 + shift**2))
        sigma = 1.0        # km — TLE 1-sigma position uncertainty
        r_combined = 0.01  # km — combined hard-body radius (~10 m each)
        new_pc = float(np.clip(
            np.pi * r_combined**2 / sigma**2
            * np.exp(-0.5 * (new_miss / sigma) ** 2),
            0.0, 1.0,
        ))
        return new_miss, new_pc

    # ------------------------------------------------------------------
    # Binary search for minimum delta-V that achieves target Pc
    # ------------------------------------------------------------------
    target_pc = 1e-6

    def find_min_dv() -> tuple:
        """Binary search returning (min_dv_km_s, final_miss_km, final_pc)."""
        dv_lo, dv_hi = 1e-5, 0.002  # km/s search bounds
        for _ in range(25):          # 25 iterations → precision ~6e-8 km/s
            dv_mid = (dv_lo + dv_hi) / 2
            _, pc_mid = new_miss_and_pc(dv_mid)
            if pc_mid <= target_pc:
                dv_hi = dv_mid
            else:
                dv_lo = dv_mid
        best_dv = (dv_lo + dv_hi) / 2
        final_miss, final_pc = new_miss_and_pc(best_dv)
        return best_dv, final_miss, final_pc

    # CW shift magnitude is symmetric for prograde / retrograde.
    # The binary search finds the same |Δv| for both directions.
    best_dv_km_s, final_miss, final_pc = find_min_dv()

    # ------------------------------------------------------------------
    # Determine burn direction from CW along-track coefficient sign
    # ------------------------------------------------------------------
    # The along-track CW coefficient is (4·sin(nτ) − 3·n·τ) / n.
    # If it is negative (nτ > π, i.e. burn lead time > half an orbit
    # period ≈ 2865 s), a prograde burn produces a *negative*
    # along-track shift, so retrograde is the physically meaningful
    # direction.  For 60-minute lead time: nτ ≈ 3.95 rad > π,
    # hence retrograde.
    cw_coefficient = (4 * np.sin(n * tau) - 3 * n * tau) / n
    burn_direction = "retrograde" if cw_coefficient < 0 else "prograde"

    delta_v_ms = best_dv_km_s * 1000  # convert km/s → m/s

    # ------------------------------------------------------------------
    # Sanity checks
    # ------------------------------------------------------------------
    if not (0.001 <= delta_v_ms <= 500):
        raise ValueError(f"Unreasonable delta-V: {delta_v_ms:.4f} m/s")
    if final_pc > 1e-4:
        raise ValueError(f"Failed to reach safe Pc: {final_pc:.2e}")
    if final_miss <= original_miss:
        raise ValueError("Miss distance did not increase after maneuver")

    return ManeuverOutput(
        delta_v_ms=delta_v_ms,
        burn_direction=burn_direction,
        burn_time=burn_time,
        post_maneuver_pc=final_pc,
        post_maneuver_miss_km=final_miss,
    )


# ---------------------------------------------------------------------------
# __main__ test block
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from sgp4.api import Satrec
    from datetime import timezone

    # Two TLEs engineered to conjunct — same orbital shell,
    # slightly offset mean anomaly
    tle_a = (
        "DEMO-SAT-A",
        "1 99001U 26001A   26163.50000000  .00001000  00000-0  10000-3 0  9991",
        "2 99001  53.0000 100.0000 0001000  90.0000  270.0000 15.30000000000011",
    )
    tle_b = (
        "DEMO-SAT-B",
        "1 99002U 26001B   26163.50000000  .00001000  00000-0  10000-3 0  9992",
        "2 99002  53.0000 100.0000 0001000  90.0010  270.0010 15.30000000000012",
    )

    sat_a = Satrec.twoline2rv(tle_a[1], tle_a[2])
    sat_b = Satrec.twoline2rv(tle_b[1], tle_b[2])

    now = datetime(2026, 6, 12, 12, 0, 0, tzinfo=timezone.utc)
    inp = ConjunctionInput(sat_a, sat_b, now, now + timedelta(hours=6))

    # ----- Test 1: find_tca -----
    print("=" * 50)
    print("TEST 1: find_tca")
    print("=" * 50)

    conj = find_tca(inp)
    print(f"TCA:          {conj.tca}")
    print(f"Miss dist:    {conj.miss_distance_km:.4f} km")
    print(f"Pc:           {conj.pc:.2e}")
    print(f"Rel velocity: {conj.relative_velocity_km_s:.4f} km/s")

    assert conj.miss_distance_km > 0, "miss distance must be positive"
    assert 0.0 <= conj.pc <= 1.0, "Pc must be between 0 and 1"
    assert conj.relative_velocity_km_s > 0, "velocity must be positive"
    print("find_tca ASSERTIONS PASSED ✓\n")

    # ----- Test 2: compute_minimum_delta_v -----
    print("=" * 50)
    print("TEST 2: compute_minimum_delta_v")
    print("=" * 50)
    print(f"Original miss: {conj.miss_distance_km:.4f} km")
    print(f"Original Pc:   {conj.pc:.2e}")

    man_inp = ManeuverInput(
        sat_maneuvering_satrec=sat_a,
        sat_other_satrec=sat_b,
        tca=conj.tca,
        burn_lead_time_minutes=60,
    )
    result = compute_minimum_delta_v(man_inp)

    print(f"Delta-V:          {result.delta_v_ms:.4f} m/s")
    print(f"Direction:        {result.burn_direction}")
    print(f"Burn time:        {result.burn_time}")
    print(f"Post-maneuver Pc: {result.post_maneuver_pc:.2e}")
    print(f"Post miss dist:   {result.post_maneuver_miss_km:.4f} km")

    assert 0.001 <= result.delta_v_ms <= 500, (
        f"delta-V out of range: {result.delta_v_ms}"
    )
    assert result.post_maneuver_pc < 1e-4, (
        f"Pc not safe: {result.post_maneuver_pc:.2e}"
    )
    assert result.post_maneuver_miss_km > conj.miss_distance_km, (
        "miss distance did not increase"
    )
    print("compute_minimum_delta_v ASSERTIONS PASSED ✓\n")

    print("=" * 50)
    print("ALL ASSERTIONS PASSED ✓")
    print("=" * 50)
