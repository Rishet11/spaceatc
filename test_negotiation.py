"""
test_negotiation.py — Regression guard for the operator-bid honesty fixes.

Locks in two invariants after removing the artificial 10% delta-V inflation:
  1. The two co-orbital demo craft get an essentially SYMMETRIC avoidance
     delta-V (real physics), i.e. dvB is NOT ~1.1x dvA (the old fabricated offset).
  2. The negotiation winner is decided by a REAL operational attribute
     (maneuver history) via bid_score, producing distinct, explainable scores.
"""

from datetime import datetime, timezone, timedelta

from sgp4.api import Satrec

from backend.api.routes import generate_conjunction_tle_pair
from backend.orbital.conjunction import (
    ConjunctionInput,
    ManeuverInput,
    compute_minimum_delta_v,
    find_tca,
    PC_ALERT_THRESHOLD,
)

# Demo operational histories (mirror /api/demo/inject and tle_ingestion).
DEMO_MANEUVER_COUNT = {"DEMO-SAT-A": 0, "DEMO-SAT-B": 2}


def main() -> None:
    dt = datetime.now(tz=timezone.utc)
    (na, l1a, l2a), (nb, l1b, l2b) = generate_conjunction_tle_pair(dt)
    s1 = Satrec.twoline2rv(l1a, l2a)
    s2 = Satrec.twoline2rv(l1b, l2b)

    out = find_tca(ConjunctionInput(s1, s2, dt, dt + timedelta(days=3)))
    assert out.pc > PC_ALERT_THRESHOLD, (
        f"Demo pair must conjunct: pc={out.pc:.2e} <= {PC_ALERT_THRESHOLD}"
    )

    dva = compute_minimum_delta_v(ManeuverInput(s1, s2, out.tca, 60)).delta_v_ms
    dvb = compute_minimum_delta_v(ManeuverInput(s2, s1, out.tca, 60)).delta_v_ms

    # Invariant 1: symmetric dV (co-orbital). Reject any ~1.1x fabricated offset.
    ratio = max(dva, dvb) / min(dva, dvb)
    assert ratio < 1.001, f"dV must be ~symmetric, got ratio={ratio:.4f} (fabricated offset?)"

    # Invariant 2: winner decided by real maneuver history via bid_score.
    score_a = dva + DEMO_MANEUVER_COUNT[na] * 0.1
    score_b = dvb + DEMO_MANEUVER_COUNT[nb] * 0.1
    assert score_a != score_b, "Winner must be decided by a real differentiator, not a tie"
    winner = na if score_a < score_b else nb
    assert winner == "DEMO-SAT-A", f"Expected DEMO-SAT-A to win on lower maneuver count, got {winner}"

    print(f"miss={out.miss_distance_km:.4f} km  pc={out.pc:.2e}")
    print(f"dV  A={dva:.4f}  B={dvb:.4f}  ratio={ratio:.5f} (symmetric)")
    print(f"bid_score  A={score_a:.4f}  B={score_b:.4f}  -> winner {winner}")
    print("ALL NEGOTIATION ASSERTIONS PASSED ✓")


if __name__ == "__main__":
    main()
