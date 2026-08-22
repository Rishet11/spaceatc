"""
backend/orbital/propagator.py — SGP4 propagation and coordinate conversion.

Two public functions:
  propagate_at(satrec, dt) -> (pos_eci, vel_eci) or (None, None) on SGP4 error
  eci_to_geodetic(pos_eci, dt) -> (lat_deg, lon_deg, alt_km)

PRD reference: Section 8.2
"""

import asyncio
import logging
import math
from datetime import datetime, timezone

from sgp4.api import Satrec, jday

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# WGS-84 constants
# ---------------------------------------------------------------------------
_RE_KM = 6378.137          # Earth equatorial radius, km
_F = 1.0 / 298.257223563   # WGS-84 flattening
_E2 = 2 * _F - _F * _F     # first eccentricity squared

# Earth rotation rate rad/s (IERS)
_EARTH_ROT_RAD_S = 7.2921150e-5

# J2000 epoch in Julian Date
_J2000_JD = 2451545.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def propagate_at(
    satrec: Satrec, dt: datetime
) -> tuple[list[float] | None, list[float] | None]:
    """Propagate satellite position and velocity to the given UTC datetime.

    Uses the SGP4 model via python-sgp4's ``Satrec.sgp4(jd, fr)`` method.

    Args:
        satrec: Parsed satellite record (from ``Satrec.twoline2rv``).
        dt:     Target UTC datetime.  If naive, assumed to be UTC.

    Returns:
        ``(position_km_ECI, velocity_km_s_ECI)`` — each a 3-element ``[x, y, z]``
        list in the ECI (Earth-Centred Inertial, TEME frame) coordinate system.
        Returns ``(None, None)`` if the SGP4 propagator returns a non-zero error
        code (e.g. satellite has decayed or the epoch is too far out-of-range).
    """
    # Ensure UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    # Compute Julian date split into integer + fraction for numerical precision
    jd, fr = jday(
        dt.year,
        dt.month,
        dt.day,
        dt.hour,
        dt.minute,
        dt.second + dt.microsecond / 1_000_000.0,
    )

    error_code, r, v = satrec.sgp4(jd, fr)

    if error_code != 0:
        logger.warning(
            "SGP4 propagation error %d for NORAD %s",
            error_code,
            getattr(satrec, "satnum", "?"),
        )
        return None, None

    return list(r), list(v)


def eci_to_geodetic(
    pos_eci: list[float], dt: datetime
) -> tuple[float, float, float]:
    """Convert an ECI (TEME) position vector to geodetic lat/lon/alt.

    Algorithm:
      1. Compute Greenwich Mean Sidereal Time (GMST) at ``dt``.
      2. Rotate ECI → ECEF via GMST.
      3. Convert ECEF → geodetic (WGS-84 iterative Bowring method).

    Args:
        pos_eci: ``[x, y, z]`` position in km (TEME/ECI frame).
        dt:      UTC datetime corresponding to the position.

    Returns:
        ``(lat_deg, lon_deg, alt_km)`` — geodetic latitude in degrees
        (−90 to +90), longitude in degrees (−180 to +180), altitude above
        the WGS-84 ellipsoid in km.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    # --- Step 1: GMST ---
    gmst = _gmst_rad(dt)

    # --- Step 2: ECI (TEME) → ECEF via Z-rotation by GMST ---
    x_eci, y_eci, z_eci = pos_eci
    cos_g = math.cos(gmst)
    sin_g = math.sin(gmst)

    x_ecef =  cos_g * x_eci + sin_g * y_eci
    y_ecef = -sin_g * x_eci + cos_g * y_eci
    z_ecef =  z_eci

    # --- Step 3: ECEF → geodetic (WGS-84) ---
    lat_deg, lon_deg, alt_km = _ecef_to_geodetic(x_ecef, y_ecef, z_ecef)

    return lat_deg, lon_deg, alt_km


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _gmst_rad(dt: datetime) -> float:
    """Return Greenwich Mean Sidereal Time in radians for a UTC datetime.

    Uses the IAU 1982 formula (accurate to ~0.1 arc-second over ±50 years).
    """
    jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute,
                  dt.second + dt.microsecond / 1_000_000.0)

    # Julian centuries from J2000.0
    t = ((jd - _J2000_JD) + fr) / 36525.0

    # GMST in SECONDS OF TIME (polynomial from Vallado, "Fundamentals of
    # Astrodynamics"). Note the unit: this is seconds of time, not arcseconds.
    # The 876600.0 * 3600.0 term is 876600 hours expressed in seconds.
    theta_sec = (
        67310.54841
        + (876600.0 * 3600.0 + 8640184.812866) * t
        + 0.093104 * t * t
        - 6.2e-6 * t * t * t
    )

    # Seconds of time → degrees: a full 360 deg turn takes 86400 s, so divide
    # by 240. (Dividing by 3600 would treat the value as arcseconds and yield
    # exactly 1/15 of the true angle, making the Earth appear to rotate once
    # per ~15 days and putting every sub-satellite longitude in the wrong place.)
    theta_deg = (theta_sec / 240.0) % 360.0
    return math.radians(theta_deg)


def _ecef_to_geodetic(
    x: float, y: float, z: float
) -> tuple[float, float, float]:
    """Bowring iterative method: ECEF (km) → geodetic (deg, deg, km)."""
    p = math.sqrt(x * x + y * y)          # distance from Z-axis

    # Longitude — exact
    lon_rad = math.atan2(y, x)

    # Latitude — iterate (3 iterations is sufficient for < 1 mm error)
    lat_rad = math.atan2(z, p * (1.0 - _E2))  # initial estimate
    for _ in range(4):
        sin_lat = math.sin(lat_rad)
        N = _RE_KM / math.sqrt(1.0 - _E2 * sin_lat * sin_lat)  # radius of curvature
        lat_rad = math.atan2(z + _E2 * N * sin_lat, p)

    # Altitude
    sin_lat = math.sin(lat_rad)
    cos_lat = math.cos(lat_rad)
    N = _RE_KM / math.sqrt(1.0 - _E2 * sin_lat * sin_lat)

    if abs(cos_lat) > 1e-10:
        alt_km = p / cos_lat - N
    else:
        # Near poles
        alt_km = abs(z) / abs(sin_lat) - N * (1.0 - _E2)

    return math.degrees(lat_rad), math.degrees(lon_rad), alt_km


# ---------------------------------------------------------------------------
# __main__ smoke test
# ---------------------------------------------------------------------------

async def _main() -> None:
    """Propagate the first Starlink satellite in the cache to now and print its position."""
    from backend.orbital.tle_client import fetch_and_parse

    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)-8s %(name)-20s %(message)s",
    )

    now = datetime.now(tz=timezone.utc)

    print(f"\nFetching Starlink TLE data…")
    satellites = await fetch_and_parse()
    if not satellites:
        print("ERROR: No satellites parsed.")
        return

    name, satrec = satellites[0]
    print(f"\nPropagating: {name}  (NORAD #{satrec.satnum})")
    print(f"  At UTC: {now.isoformat()}")

    pos, vel = propagate_at(satrec, now)
    if pos is None:
        print("  SGP4 error — satellite may have decayed or epoch is stale.")
        return

    lat, lon, alt = eci_to_geodetic(pos, now)

    print(f"\n  ECI position (km):    x={pos[0]:+.3f}  y={pos[1]:+.3f}  z={pos[2]:+.3f}")
    print(f"  ECI velocity (km/s):  x={vel[0]:+.5f}  y={vel[1]:+.5f}  z={vel[2]:+.5f}")
    print(f"\n  Geodetic:")
    print(f"    Latitude:   {lat:+.4f}°")
    print(f"    Longitude:  {lon:+.4f}°")
    print(f"    Altitude:   {alt:.2f} km\n")

    # Show all 10 cached satellites
    print(f"All {len(satellites)} parsed satellites:")
    for sat_name, sat in satellites:
        p, v = propagate_at(sat, now)
        if p is None:
            print(f"  {sat_name:30s}  → SGP4 error")
            continue
        slat, slon, salt = eci_to_geodetic(p, now)
        print(f"  {sat_name:30s}  lat={slat:+7.2f}°  lon={slon:+8.2f}°  alt={salt:.1f} km")


if __name__ == "__main__":
    asyncio.run(_main())
