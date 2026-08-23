"""Tests for backend/orbital/encounter.py -- the separation-vs-time series
and true-scale TCA geometry that back GET /api/conjunctions/{event_id}/encounter.

Runs fully offline, using the same deterministic demo TLE pair as
test_demo_geometry.py.
"""
from datetime import datetime, timedelta, timezone

import pytest
from sgp4.api import Satrec

from backend.api.routes import generate_conjunction_tle_pair
from backend.orbital.conjunction import (
    ConjunctionInput,
    ManeuverInput,
    compute_minimum_delta_v,
    find_tca,
)
from backend.orbital.encounter import (
    FINE_HALF_WINDOW_S,
    FINE_STEP_S,
    build_post_maneuver_series,
    build_pre_maneuver_series,
    local_frame_positions,
    min_point,
)

EPOCH = datetime(2026, 8, 22, 12, 0, 0, tzinfo=timezone.utc)


def _pair(epoch):
    (_, l1a, l2a), (_, l1b, l2b) = generate_conjunction_tle_pair(epoch)
    return Satrec.twoline2rv(l1a, l2a), Satrec.twoline2rv(l1b, l2b)


def _demo_conjunction(epoch):
    sat_a, sat_b = _pair(epoch)
    conj = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(days=3)))
    return sat_a, sat_b, conj


def test_pre_maneuver_minimum_matches_the_known_demo_geometry():
    """The known demo geometry: ~0.463 km miss, TCA ~180 s after injection."""
    sat_a, sat_b, conj = _demo_conjunction(EPOCH)
    lead_s = (conj.tca - EPOCH).total_seconds()
    assert abs(lead_s - 180) < 30, f"TCA at +{lead_s:.1f}s, expected ~180s"

    points = build_pre_maneuver_series(sat_a, sat_b, conj.tca)
    best = min_point(points)

    assert best.separation_km == pytest.approx(0.463, abs=0.01)
    # The series' own minimum must agree with find_tca's independently
    # computed miss distance -- same SGP4 propagator, same instant.
    assert best.separation_km == pytest.approx(conj.miss_distance_km, rel=1e-6)


def test_post_maneuver_minimum_is_materially_larger():
    """The post-maneuver separation series must show the burn actually helping,
    consistent with the existing CW post_maneuver_miss_km to within the
    tolerance the codebase already accepts (CW 3.391 km vs propagated 3.496 km,
    a few percent -- see test_demo_geometry.py's cross-validation test)."""
    sat_a, sat_b, conj = _demo_conjunction(EPOCH)
    man = compute_minimum_delta_v(ManeuverInput(sat_a, sat_b, conj.tca, 60))

    pre_points = build_pre_maneuver_series(sat_a, sat_b, conj.tca)
    pre_best = min_point(pre_points)

    post_points = build_post_maneuver_series(
        sat_a, sat_b, True, conj.tca, man.burn_time, man.delta_v_ms, man.burn_direction
    )
    assert post_points is not None
    post_best = min_point(post_points)

    assert post_best.separation_km > pre_best.separation_km * 3
    assert post_best.separation_km == pytest.approx(
        man.post_maneuver_miss_km, rel=0.1
    ), (
        f"CW predicted {man.post_maneuver_miss_km:.3f} km, "
        f"series minimum gives {post_best.separation_km:.3f} km"
    )


def test_pre_maneuver_series_approaches_then_recedes():
    """Near TCA, separation must decrease monotonically into the minimum and
    increase monotonically out of it -- a real close approach, not a noisy
    curve. (Farther out the two LEO orbits cross more than once per window,
    so the full ±30 min series is not globally monotonic -- only the basin
    right around the minimum has to be.)"""
    sat_a, sat_b, conj = _demo_conjunction(EPOCH)
    points = build_pre_maneuver_series(sat_a, sat_b, conj.tca)
    points = [p for p in points if abs(p.offset_s) <= FINE_HALF_WINDOW_S]
    points.sort(key=lambda p: p.offset_s)

    seps = [p.separation_km for p in points]
    min_idx = min(range(len(points)), key=lambda i: seps[i])

    approach = seps[: min_idx + 1]
    recession = seps[min_idx:]
    assert all(a >= b for a, b in zip(approach, approach[1:])), (
        "separation did not decrease monotonically into the minimum"
    )
    assert all(a <= b for a, b in zip(recession, recession[1:])), (
        "separation did not increase monotonically out of the minimum"
    )


def test_series_is_dense_near_tca():
    """The sample cadence near TCA must be dense enough for a smooth chart
    where the curve turns sharply, not just the coarse whole-window cadence."""
    sat_a, sat_b, conj = _demo_conjunction(EPOCH)
    points = build_pre_maneuver_series(sat_a, sat_b, conj.tca)
    offsets = sorted(p.offset_s for p in points)

    near_tca = [o for o in offsets if abs(o) <= FINE_HALF_WINDOW_S]
    # Every fine step within the dense window must be present.
    expected = set(range(-FINE_HALF_WINDOW_S, FINE_HALF_WINDOW_S + 1, FINE_STEP_S))
    assert expected.issubset(set(near_tca))
    assert len(near_tca) >= len(expected)

    # And it must actually be denser than the coarse cadence elsewhere.
    gaps_near_tca = [b - a for a, b in zip(near_tca, near_tca[1:])]
    far_from_tca = [o for o in offsets if o < -FINE_HALF_WINDOW_S]
    gaps_far = [b - a for a, b in zip(far_from_tca, far_from_tca[1:])]
    assert max(gaps_near_tca) < min(gaps_far)


def test_local_frame_positions_reproduce_the_true_miss_distance():
    """The local encounter frame is a rigid transform of ECI: the distance
    between the two craft's positions in that frame must equal the true
    miss distance, so a true-scale close-up plotted from it is not distorted.
    """
    import numpy as np

    sat_a, sat_b, conj = _demo_conjunction(EPOCH)
    points = build_pre_maneuver_series(sat_a, sat_b, conj.tca)
    best = min_point(points)

    primary_local, secondary_local = local_frame_positions(best)
    d = np.array(
        [
            secondary_local[k] - primary_local[k]
            for k in ("x_km", "y_km", "z_km")
        ]
    )
    assert float(np.linalg.norm(d)) == pytest.approx(best.separation_km, rel=1e-6)


def test_post_maneuver_series_works_regardless_of_which_craft_maneuvers():
    """maneuvering_is_primary must correctly route the burn -- either craft
    can win the negotiation, and the series it produces must still show the
    same improvement over the pre-maneuver minimum either way."""
    sat_a, sat_b, conj = _demo_conjunction(EPOCH)

    man_a = compute_minimum_delta_v(ManeuverInput(sat_a, sat_b, conj.tca, 60))
    man_b = compute_minimum_delta_v(ManeuverInput(sat_b, sat_a, conj.tca, 60))

    pre_points = build_pre_maneuver_series(sat_a, sat_b, conj.tca)
    pre_min = min_point(pre_points).separation_km

    post_a = build_post_maneuver_series(
        sat_a, sat_b, True, conj.tca, man_a.burn_time, man_a.delta_v_ms, man_a.burn_direction
    )
    post_b = build_post_maneuver_series(
        sat_a, sat_b, False, conj.tca, man_b.burn_time, man_b.delta_v_ms, man_b.burn_direction
    )
    assert post_a is not None and post_b is not None
    assert min_point(post_a).separation_km > pre_min * 3
    assert min_point(post_b).separation_km > pre_min * 3
