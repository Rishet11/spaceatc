"""Tests for backend/orbital/propagator.propagate_two_body.

Covers closure/period properties of an unperturbed Keplerian orbit
(circular and eccentric), conservation laws, round-tripping, the t0==dt
identity, and a sanity-bound comparison against SGP4 over a short arc.
"""

import math
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from backend.orbital.propagator import propagate_at, propagate_two_body
from backend.orbital.tle_client import parse_tle_block

MU = 398600.4418  # km^3/s^2

T0 = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)


def _circular_state(r_km: float = 6928.0):
    """A circular LEO state: r along +x, v along +y at circular speed."""
    r0 = np.array([r_km, 0.0, 0.0])
    v_circ = math.sqrt(MU / r_km)
    v0 = np.array([0.0, v_circ, 0.0])
    a = r_km
    period = 2 * math.pi * math.sqrt(a**3 / MU)
    return r0, v0, period


def _eccentric_state(a_km: float = 7500.0, e: float = 0.2):
    """A state at perigee of an orbit with semi-major axis a and eccentricity e."""
    r_p = a_km * (1 - e)
    r0 = np.array([r_p, 0.0, 0.0])
    v_p = math.sqrt(MU * (2.0 / r_p - 1.0 / a_km))
    v0 = np.array([0.0, v_p, 0.0])
    period = 2 * math.pi * math.sqrt(a_km**3 / MU)
    return r0, v0, period


def test_t0_equals_dt_returns_input_unchanged():
    r0 = np.array([6928.0, 100.0, -50.0])
    v0 = np.array([0.1, 7.5, 0.2])
    r, v = propagate_two_body(r0, v0, T0, T0)
    assert np.allclose(r, r0)
    assert np.allclose(v, v0)


def test_circular_orbit_closure_after_one_period():
    r0, v0, period = _circular_state()
    dt = T0 + timedelta(seconds=period)
    r, v = propagate_two_body(r0, v0, T0, dt)
    pos_err_m = np.linalg.norm(r - r0) * 1000.0
    vel_err = np.linalg.norm(v - v0)
    assert pos_err_m < 1.0, f"position error {pos_err_m:.4f} m"
    assert vel_err < 1e-6, f"velocity error {vel_err:.3e} km/s"


def test_circular_orbit_half_period_is_antipodal():
    r0, v0, period = _circular_state()
    dt = T0 + timedelta(seconds=period / 2.0)
    r, v = propagate_two_body(r0, v0, T0, dt)
    pos_err_m = np.linalg.norm(r - (-r0)) * 1000.0
    vel_err = np.linalg.norm(v - (-v0))
    assert pos_err_m < 1.0, f"position error vs antipodal {pos_err_m:.4f} m"
    assert vel_err < 1e-6, f"velocity error vs antipodal {vel_err:.3e} km/s"


def test_energy_and_angular_momentum_conserved_circular():
    r0, v0, period = _circular_state()
    h0 = np.cross(r0, v0)
    e0 = np.dot(v0, v0) / 2.0 - MU / np.linalg.norm(r0)

    for frac in [0.1, 0.37, 0.5, 0.9, 1.3, 1.75, 2.6]:
        dt = T0 + timedelta(seconds=frac * period)
        r, v = propagate_two_body(r0, v0, T0, dt)
        h = np.cross(r, v)
        e = np.dot(v, v) / 2.0 - MU / np.linalg.norm(r)
        assert abs((e - e0) / e0) < 1e-9, f"energy drift at frac={frac}: {e} vs {e0}"
        rel_h_err = np.linalg.norm(h - h0) / np.linalg.norm(h0)
        assert rel_h_err < 1e-9, f"angular momentum drift at frac={frac}: {rel_h_err}"


def test_round_trip_forward_and_back():
    r0, v0, _ = _circular_state()
    mid = propagate_two_body(r0, v0, T0, T0 + timedelta(seconds=1800))
    r_back, v_back = propagate_two_body(mid[0], mid[1], T0 + timedelta(seconds=1800), T0)
    pos_err_m = np.linalg.norm(r_back - r0) * 1000.0
    vel_err = np.linalg.norm(v_back - v0)
    assert pos_err_m < 1.0, f"round-trip position error {pos_err_m:.4f} m"
    assert vel_err < 1e-6, f"round-trip velocity error {vel_err:.3e} km/s"


def test_eccentric_orbit_closure_after_one_period():
    r0, v0, period = _eccentric_state()
    dt = T0 + timedelta(seconds=period)
    r, v = propagate_two_body(r0, v0, T0, dt)
    pos_err_m = np.linalg.norm(r - r0) * 1000.0
    vel_err = np.linalg.norm(v - v0)
    assert pos_err_m < 1.0, f"eccentric position error {pos_err_m:.4f} m"
    assert vel_err < 1e-6, f"eccentric velocity error {vel_err:.3e} km/s"


def test_eccentric_orbit_energy_and_angular_momentum_conserved():
    r0, v0, period = _eccentric_state()
    h0 = np.cross(r0, v0)
    e0 = np.dot(v0, v0) / 2.0 - MU / np.linalg.norm(r0)

    for frac in [0.05, 0.25, 0.5, 0.75, 1.0, 1.6, 2.3]:
        dt = T0 + timedelta(seconds=frac * period)
        r, v = propagate_two_body(r0, v0, T0, dt)
        h = np.cross(r, v)
        e = np.dot(v, v) / 2.0 - MU / np.linalg.norm(r)
        assert abs((e - e0) / e0) < 1e-8, f"energy drift at frac={frac}: {e} vs {e0}"
        rel_h_err = np.linalg.norm(h - h0) / np.linalg.norm(h0)
        assert rel_h_err < 1e-8, f"angular momentum drift at frac={frac}: {rel_h_err}"


def test_agreement_with_sgp4_over_short_arc():
    """Two-body propagation should stay within ~50 km of SGP4 over 30 minutes.

    SGP4 includes J2 and drag, two-body does not, so they will diverge -- this
    is a sanity bound proving the same physical regime, not an equivalence test.
    """
    tle_path = os.path.join(
        os.path.dirname(__file__), "backend", "orbital", "starlink_cache.tle"
    )
    with open(tle_path, "r") as f:
        tle_text = f.read()
    satellites = parse_tle_block(tle_text)
    assert satellites, "no satellites parsed from bundled TLE cache"

    name, satrec = satellites[0]

    epoch_year = 2000 + satrec.epochyr if satrec.epochyr < 57 else 1900 + satrec.epochyr
    t0 = datetime(epoch_year, 1, 1, tzinfo=timezone.utc) + timedelta(
        days=satrec.epochdays - 1
    )

    r0_list, v0_list = propagate_at(satrec, t0)
    assert r0_list is not None, f"SGP4 failed at epoch for {name}"
    r0 = np.array(r0_list)
    v0 = np.array(v0_list)

    dt = t0 + timedelta(minutes=30)
    r_sgp4, v_sgp4 = propagate_at(satrec, dt)
    assert r_sgp4 is not None, f"SGP4 failed at t0+30min for {name}"
    r_sgp4 = np.array(r_sgp4)

    r_2body, _ = propagate_two_body(r0, v0, t0, dt)

    divergence_km = np.linalg.norm(r_2body - r_sgp4)
    print(
        f"\n[test_agreement_with_sgp4_over_short_arc] {name}: "
        f"two-body vs SGP4 divergence at +30 min = {divergence_km:.4f} km"
    )
    assert divergence_km < 50.0, f"divergence {divergence_km:.3f} km exceeds 50 km bound"
