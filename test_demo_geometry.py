"""Regression tests for the demo conjunction geometry and the TCA basin search.

Two things are pinned here:

1. ``find_tca`` must refine *every* coarse local minimum, not just the smallest
   coarse sample.  At a 60 s coarse step a pair closing at ~14 km/s moves ~840 km
   between samples, so a sub-kilometre crossing encounter can read as a larger
   coarse sample than a slower, genuinely more distant pass elsewhere in the
   window.  Refining only the global coarse minimum locks onto the wrong basin.

2. The injected demo pair must produce the *same* encounter every run, in two
   different orbital planes, above the Pc alert threshold -- otherwise the demo
   is not reproducible take to take.

Runs fully offline.
"""
from datetime import datetime, timedelta, timezone

import pytest
from sgp4.api import Satrec

from backend.api.routes import ENCOUNTER_LEAD_S, generate_conjunction_tle_pair
from backend.orbital.conjunction import (
    PC_ALERT_THRESHOLD,
    ConjunctionInput,
    ManeuverInput,
    compute_minimum_delta_v,
    find_tca,
)

# Epochs spread across days and times of day: the geometry is solved from the
# plane intersection at call time, so none of these should behave differently.
EPOCHS = [
    datetime(2026, 8, 22, 12, 0, 0, tzinfo=timezone.utc),
    datetime(2026, 8, 22, 23, 0, 0, tzinfo=timezone.utc),
    datetime(2026, 8, 25, 3, 30, 0, tzinfo=timezone.utc),
    datetime(2026, 9, 14, 18, 45, 0, tzinfo=timezone.utc),
    datetime(2027, 1, 2, 6, 15, 0, tzinfo=timezone.utc),
]


def _pair(epoch):
    (_, l1a, l2a), (_, l1b, l2b) = generate_conjunction_tle_pair(epoch)
    return Satrec.twoline2rv(l1a, l2a), Satrec.twoline2rv(l1b, l2b)


@pytest.mark.parametrize("epoch", EPOCHS)
def test_demo_pair_conjuncts_on_schedule(epoch):
    """The engineered encounter lands ~ENCOUNTER_LEAD_S out, every time."""
    sat_a, sat_b = _pair(epoch)
    out = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(days=3)))
    lead = (out.tca - epoch).total_seconds()
    assert abs(lead - ENCOUNTER_LEAD_S) < 30, (
        f"encounter at +{lead:.1f}s, expected ~{ENCOUNTER_LEAD_S}s"
    )


@pytest.mark.parametrize("epoch", EPOCHS)
def test_demo_pair_trips_the_alert_threshold(epoch):
    """Miss distance is a near miss, and Pc clears the negotiation trigger."""
    sat_a, sat_b = _pair(epoch)
    out = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(days=3)))
    assert 0.05 < out.miss_distance_km < 2.0, f"miss {out.miss_distance_km:.3f} km"
    assert out.pc > PC_ALERT_THRESHOLD, f"Pc {out.pc:.2e} would not trigger negotiation"


@pytest.mark.parametrize("epoch", EPOCHS)
def test_demo_pair_is_a_crossing_encounter(epoch):
    """Different orbital planes, so the two tracks are visibly distinct.

    A same-plane pair closes at ~1 km/s; a crossing encounter closes far faster.
    This is the property that makes the two trajectories legible on the globe,
    and it is also the dangerous case operationally (Iridium-Cosmos: 11.7 km/s).
    """
    sat_a, sat_b = _pair(epoch)
    out = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(days=3)))
    assert out.relative_velocity_km_s > 8.0, (
        f"relative velocity {out.relative_velocity_km_s:.2f} km/s is co-orbital, "
        "the tracks will overlap on screen"
    )


def test_long_window_finds_the_same_encounter_as_a_short_one():
    """The basin-search fix: a 3-day scan must not miss the +180 s encounter.

    Before the fix the 60 s coarse scan reported a 3.15 km pass ~1.7 days out
    and lost the 0.46 km pass entirely, because the coarse sample nearest the
    real TCA was hundreds of km wide at 13.7 km/s closing speed.
    """
    epoch = EPOCHS[0]
    sat_a, sat_b = _pair(epoch)
    short = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(minutes=8)))
    long = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(days=3)))

    assert abs((long.tca - short.tca).total_seconds()) < 1.0
    assert long.miss_distance_km == pytest.approx(short.miss_distance_km, rel=1e-3)


def test_encounter_is_reproducible_across_epochs():
    """Same miss distance regardless of when the demo is triggered.

    The recording depends on this: every take must show the same numbers.
    """
    results = []
    for epoch in EPOCHS:
        sat_a, sat_b = _pair(epoch)
        out = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(days=3)))
        results.append(out.miss_distance_km)
    spread = max(results) - min(results)
    assert spread < 0.05, f"miss distance varies by {spread:.4f} km across epochs"


@pytest.mark.parametrize("epoch", EPOCHS[:2])
def test_both_satellites_can_solve_a_maneuver(epoch):
    """Both operators must be able to bid, and the burns stay symmetric.

    Symmetry is deliberate: with equal delta-V the negotiation is decided by
    operational cost (fuel and maneuver history), not by an artificial physics
    difference between the two craft.
    """
    sat_a, sat_b = _pair(epoch)
    out = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(days=3)))

    man_a = compute_minimum_delta_v(ManeuverInput(sat_a, sat_b, out.tca, 60))
    man_b = compute_minimum_delta_v(ManeuverInput(sat_b, sat_a, out.tca, 60))

    for man in (man_a, man_b):
        assert 0.001 <= man.delta_v_ms <= 500
        assert man.post_maneuver_miss_km > out.miss_distance_km
        assert man.post_maneuver_pc < out.pc

    assert man_a.delta_v_ms == pytest.approx(man_b.delta_v_ms, rel=0.05)


def test_propagated_burn_agrees_with_the_clohessy_wiltshire_solver():
    """Cross-validate the maneuver two independent ways.

    ``compute_minimum_delta_v`` sizes the burn analytically with the
    Clohessy-Wiltshire relative-motion equations and predicts the resulting
    miss distance.  Here we take that delta-V, apply it as a real impulse to
    the real SGP4 state at the burn epoch, propagate the burned and un-burned
    states with two-body motion, and add the difference to the SGP4 track --
    the same differential method the /paths endpoint serves to the globe.

    Two independent routes to the same number is the check that matters: it is
    what lets us say the green post-burn trajectory on screen is the maneuver
    the solver actually chose, not an animation.
    """
    import numpy as np

    from backend.orbital.propagator import propagate_at, propagate_two_body

    epoch = EPOCHS[0]
    sat_a, sat_b = _pair(epoch)
    conj = find_tca(ConjunctionInput(sat_a, sat_b, epoch, epoch + timedelta(days=3)))
    man = compute_minimum_delta_v(ManeuverInput(sat_a, sat_b, conj.tca, 60))

    burn_time = man.burn_time
    if burn_time.tzinfo is None:
        burn_time = burn_time.replace(tzinfo=timezone.utc)

    r_burn, v_burn = propagate_at(sat_a, burn_time)
    r_burn = np.asarray(r_burn, dtype=float)
    v_burn = np.asarray(v_burn, dtype=float)

    sign = -1.0 if man.burn_direction == "retrograde" else 1.0
    v_burned = v_burn + sign * (man.delta_v_ms / 1000.0) * (
        v_burn / np.linalg.norm(v_burn)
    )

    base, _ = propagate_two_body(r_burn, v_burn, burn_time, conj.tca)
    bent, _ = propagate_two_body(r_burn, v_burned, burn_time, conj.tca)

    nominal_a, _ = propagate_at(sat_a, conj.tca)
    pos_b, _ = propagate_at(sat_b, conj.tca)
    moved_a = np.asarray(nominal_a, dtype=float) + (bent - base)

    propagated_miss = float(np.linalg.norm(moved_a - np.asarray(pos_b, dtype=float)))

    # The two methods are independent, so they will not agree exactly: CW is a
    # linearised model and assumes the shift is orthogonal to the miss vector.
    # Agreement within 25% means the picture and the arithmetic tell one story.
    assert propagated_miss == pytest.approx(man.post_maneuver_miss_km, rel=0.25), (
        f"CW predicted {man.post_maneuver_miss_km:.3f} km, "
        f"propagation gives {propagated_miss:.3f} km"
    )
    # And the burn must actually help.
    assert propagated_miss > conj.miss_distance_km * 3
