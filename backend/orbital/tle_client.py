"""
backend/orbital/tle_client.py — CelesTrak HTTP client.

Fetches 3LE (name + TLE line 1 + TLE line 2) blocks from CelesTrak and
parses them into sgp4 Satrec objects.

PRD reference: Section 8.1
"""

import asyncio
import logging

import httpx
from sgp4.api import Satrec

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# URL constants (PRD Section 8.1)
# ---------------------------------------------------------------------------

CELESTRAK_STARLINK_TLE = (
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=TLE"
)
CELESTRAK_ACTIVE_TLE = (
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE"
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def fetch_tle_group(url: str) -> tuple[str, str]:
    """Fetch a 3LE block from CelesTrak.

    Args:
        url: Full CelesTrak endpoint URL (FORMAT=TLE).

    Returns:
        ``(raw_tle_text, source)`` where ``source`` is ``"network"`` when the
        data came from CelesTrak or ``"local_cache"`` when it came from the
        bundled fallback file. Knowing the source lets callers log honestly.

    Raises:
        httpx.HTTPStatusError: on non-2xx responses if cache fallback fails.
        httpx.TimeoutException:  if the request times out and cache fallback fails.
    """
    from pathlib import Path

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    # Bounded timeout: CelesTrak either answers quickly or is unreachable
    # (egress-blocked / rate-limited). A short connect+read budget means we fall
    # back to the local cache in seconds instead of hanging ~30 s, which is what
    # made the INJECT button feel dead on restricted networks.
    timeout = httpx.Timeout(8.0, connect=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            logger.info("Fetching TLE data from %s", url)
            response = await client.get(url)
            response.raise_for_status()
            text = response.text
            # Debug-level: this is a raw pre-truncation parse count, not the
            # number of satellites actually ingested/tracked/displayed.
            logger.debug(
                "Fetched %.1f kB, approx %d satellites (pre-filter parse count)",
                len(text) / 1024,
                text.strip().count("\n") // 3,
            )
            return text, "network"
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        reason = str(exc) or exc.__class__.__name__
        logger.warning(
            "CelesTrak unreachable (%s); using bundled local cache.",
            reason,
        )
        cache_path = Path(__file__).parent / "starlink_cache.tle"
        if cache_path.exists():
            text = cache_path.read_text(encoding="utf-8")
            # Debug-level: this is a raw pre-truncation parse count, not the
            # number of satellites actually ingested/tracked/displayed.
            logger.debug(
                "Loaded TLE data from bundled local cache (%s), approx %d satellites (pre-filter parse count)",
                cache_path.name,
                text.strip().count("\n") // 3,
            )
            return text, "local_cache"
        else:
            logger.error("Local TLE cache not found at %s", cache_path)
            raise


def parse_tle_block(tle_text: str) -> list[tuple[str, Satrec]]:
    """Parse a multi-satellite 3LE text block into (name, Satrec) pairs.

    Each satellite occupies exactly 3 lines:
        Line 0 — common name  (e.g. "STARLINK-1234")
        Line 1 — TLE line 1   (starts with "1 ")
        Line 2 — TLE line 2   (starts with "2 ")

    Malformed triplets are skipped with a warning rather than raising.

    Args:
        tle_text: Raw 3LE text as returned by :func:`fetch_tle_group`.

    Returns:
        List of (satellite_name, Satrec) tuples in the order they appear.
    """
    lines = [ln.strip() for ln in tle_text.strip().splitlines()]

    # Drop any completely blank lines that might pad the block.
    lines = [ln for ln in lines if ln]

    satellites: list[tuple[str, Satrec]] = []

    for i in range(0, len(lines) - 2, 3):
        name = lines[i]
        line1 = lines[i + 1]
        line2 = lines[i + 2]

        # Basic sanity check — TLE lines start with their line number.
        if not (line1.startswith("1 ") and line2.startswith("2 ")):
            logger.warning(
                "Skipping malformed TLE triplet at index %d: %r / %r / %r",
                i, name, line1, line2,
            )
            continue

        try:
            satrec = Satrec.twoline2rv(line1, line2)
        except Exception:
            logger.warning(
                "sgp4 failed to parse TLE for %r — skipping", name, exc_info=True
            )
            continue

        satellites.append((name, satrec))

    logger.info("Parsed %d satellites from TLE block", len(satellites))
    return satellites


# ---------------------------------------------------------------------------
# Convenience helper: fetch + parse in one call
# ---------------------------------------------------------------------------


async def fetch_and_parse(
    url: str = CELESTRAK_STARLINK_TLE, return_source: bool = False
):
    """Fetch raw TLE text and parse it in one step.

    Args:
        url: CelesTrak endpoint. Defaults to Starlink constellation.
        return_source: when True, also return the data source so callers can
            log honestly (``"network"`` / ``"local_cache"`` / ``"unavailable"``).

    Returns:
        List of ``(name, Satrec)`` tuples, or ``(satellites, source)`` when
        ``return_source`` is True.
    """
    try:
        tle_text, source = await fetch_tle_group(url)
        satellites = parse_tle_block(tle_text)
    except Exception as e:
        logger.error(f"Failed to fetch and parse TLEs: {e}")
        satellites, source = [], "unavailable"
    if return_source:
        return satellites, source
    return satellites


# ---------------------------------------------------------------------------
# __main__ — quick smoke test: python -m backend.orbital.tle_client
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s  %(name)s  %(message)s",
    )

    async def _main() -> None:
        print(f"\nFetching from:\n  {CELESTRAK_STARLINK_TLE}\n")
        satellites = await fetch_and_parse()

        print(f"Total satellites parsed: {len(satellites)}\n")
        print("First 5 satellite names:")
        for name, satrec in satellites[:5]:
            print(f"  {name}  (NORAD #{satrec.satnum})")

    asyncio.run(_main())
