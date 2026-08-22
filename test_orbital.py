"""Regression tests for the orbital-mechanics layer.

These lock in the two properties that are easy to get wrong and impossible to
eyeball on a 3D globe: the absolute GMST angle, and the westward drift of a LEO
ground track between successive orbits.
"""

import math
from datetime import datetime, timezone

from backend.orbital.propagator import _gmst_rad, propagate_at, eci_to_geodetic
from backend.orbital.tle_client import parse_tle_block


def test_gmst_matches_textbook_value_at_j2000():
    """GMST at the J2000 epoch is 280.46061837 deg (Vallado, Meeus).

    A units slip in the Vallado polynomial (seconds of time vs arcseconds)
    yields exactly 1/15 of this, which leaves latitude and altitude correct and
    only corrupts longitude -- so it survives visual inspection.
    """
    gmst_deg = math.degrees(_gmst_rad(datetime(2000, 1, 1, 12, 0, 0)))
    assert abs(gmst_deg - 280.46061837) < 1e-4, gmst_deg


def test_gmst_advances_one_sidereal_day_per_day():
    """GMST advances ~360.9856 deg per solar day, not 24 deg."""
    a = math.degrees(_gmst_rad(datetime(2026, 3, 1, 0, 0, 0)))
    b = math.degrees(_gmst_rad(datetime(2026, 3, 2, 0, 0, 0)))
    advance = (b - a) % 360.0
    assert abs(advance - 0.9856) < 1e-2, advance


def _load_first_satellite():
    with open("backend/orbital/starlink_cache.tle") as fh:
        sats = parse_tle_block(fh.read())
    assert sats, "bundled TLE cache is empty"
    return sats[0]  # (name, Satrec)


def test_leo_ground_track_drifts_west_about_22_degrees_per_orbit():
    """A ~95 min LEO orbit sees the Earth turn ~23.8 deg beneath it.

    Because the orbit also precesses, the observed node-to-node shift is
    roughly -22 to -25 deg. A GMST scale error collapses this toward zero.
    """
    _name, satrec = _load_first_satellite()
    base = datetime(2026, 6, 23, 0, 0, 0, tzinfo=timezone.utc)

    # Sample a ~3.2h window and record ascending-node crossings (lat sign flip).
    crossings = []
    prev_lat = None
    for step in range(0, 11600, 10):
        t = base.fromtimestamp(base.timestamp() + step, tz=timezone.utc)
        pos, _ = propagate_at(satrec, t)
        if pos is None:
            continue
        lat, lon, _alt = eci_to_geodetic(pos, t)
        if prev_lat is not None and prev_lat < 0.0 <= lat:
            crossings.append(lon)
        prev_lat = lat

    assert len(crossings) >= 2, f"expected >=2 ascending nodes, got {len(crossings)}"

    shift = crossings[1] - crossings[0]
    # Normalise into [-180, 180]
    shift = (shift + 180.0) % 360.0 - 180.0
    assert -30.0 < shift < -15.0, f"node-to-node longitude shift {shift:.2f} deg"
