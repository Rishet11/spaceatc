"""
backend/db/store.py — Async SQLite persistence layer using aiosqlite.

Three tables (schema matches PRD Section 6 internal models):
  - satellites    — one row per tracked satellite
  - conjunctions  — one row per detected conjunction event
  - proposals     — one row per maneuver bid (many-per-conjunction)

All datetimes are stored as ISO 8601 TEXT; JSON blobs as TEXT.

Usage:
    from backend.db.store import init_db, upsert_satellite, ...

    await init_db()          # call once at startup
    await upsert_satellite(sat_dict)
"""

from __future__ import annotations

import json
import logging
from typing import Any

import aiosqlite

from backend.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DDL — table definitions
# ---------------------------------------------------------------------------

_CREATE_SATELLITES = """
CREATE TABLE IF NOT EXISTS satellites (
    norad_id       TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    operator       TEXT NOT NULL,
    omm_json       TEXT,
    fuel_units     REAL NOT NULL DEFAULT 100.0,
    maneuver_count INTEGER NOT NULL DEFAULT 0
);
"""

_CREATE_CONJUNCTIONS = """
CREATE TABLE IF NOT EXISTS conjunctions (
    event_id               TEXT PRIMARY KEY,
    sat_primary            TEXT NOT NULL,
    sat_secondary          TEXT NOT NULL,
    tca                    TEXT NOT NULL,
    miss_distance_km       REAL NOT NULL,
    pc                     REAL NOT NULL,
    relative_velocity_km_s REAL NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'detected',
    created_at             TEXT NOT NULL,
    resolved_at            TEXT,
    session_id             TEXT
);
"""

_ADD_SESSION_ID_COLUMN = """
ALTER TABLE conjunctions ADD COLUMN session_id TEXT;
"""

_CREATE_PROPOSALS = """
CREATE TABLE IF NOT EXISTS proposals (
    proposal_id           TEXT PRIMARY KEY,
    event_id              TEXT NOT NULL,
    operator              TEXT NOT NULL,
    satellite_name        TEXT NOT NULL,
    delta_v_ms            REAL NOT NULL,
    burn_direction        TEXT NOT NULL,
    burn_time             TEXT NOT NULL,
    post_maneuver_pc      REAL NOT NULL,
    post_maneuver_miss_km REAL NOT NULL,
    fuel_cost_units       REAL NOT NULL DEFAULT 0.0,
    bid_score             REAL NOT NULL,
    FOREIGN KEY (event_id) REFERENCES conjunctions(event_id)
);
"""

_CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_proposals_event_id ON proposals(event_id);",
    "CREATE INDEX IF NOT EXISTS idx_conjunctions_status ON conjunctions(status);",
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _db_path() -> str:
    return settings.sqlite_path


def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    return dict(row)


async def _configure(conn: aiosqlite.Connection) -> None:
    """Apply connection-level settings inside an open connection."""
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL;")
    await conn.execute("PRAGMA foreign_keys=ON;")


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------


async def init_db() -> None:
    """Create all tables and indexes if they do not yet exist.

    Call once at application startup (e.g. in FastAPI's lifespan handler).
    Safe to call multiple times — uses CREATE IF NOT EXISTS.
    """
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        await conn.execute(_CREATE_SATELLITES)
        await conn.execute(_CREATE_CONJUNCTIONS)
        await conn.execute(_CREATE_PROPOSALS)
        for idx_sql in _CREATE_INDEXES:
            await conn.execute(idx_sql)
        # Migrate older DBs created before session_id existed.
        async with conn.execute("PRAGMA table_info(conjunctions)") as cursor:
            columns = {row[1] for row in await cursor.fetchall()}
        if "session_id" not in columns:
            await conn.execute(_ADD_SESSION_ID_COLUMN)
        await conn.commit()
    logger.info("Database initialised at %s", _db_path())


# ---------------------------------------------------------------------------
# Satellites
# ---------------------------------------------------------------------------


async def upsert_satellite(sat: dict) -> None:
    """Insert or replace a satellite record.

    Args:
        sat: Dict with keys matching the satellites table columns.
             ``omm_json`` may be a dict — it will be serialised to JSON text.
    """
    omm = sat.get("omm_json") or sat.get("omm", {})
    if isinstance(omm, dict):
        omm = json.dumps(omm)

    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        await conn.execute(
            """
            INSERT INTO satellites (norad_id, name, operator, omm_json, fuel_units, maneuver_count)
            VALUES (:norad_id, :name, :operator, :omm_json, :fuel_units, :maneuver_count)
            ON CONFLICT(norad_id) DO UPDATE SET
                name           = excluded.name,
                operator       = excluded.operator,
                omm_json       = excluded.omm_json,
                fuel_units     = excluded.fuel_units,
                maneuver_count = excluded.maneuver_count
            """,
            {
                "norad_id":       str(sat["norad_id"]),
                "name":           sat["name"],
                "operator":       sat.get("operator", "Unknown"),
                "omm_json":       omm,
                "fuel_units":     sat.get("fuel_units", 100.0),
                "maneuver_count": sat.get("maneuver_count", 0),
            },
        )
        await conn.commit()


async def get_all_satellites() -> list[dict]:
    """Return all satellite records as a list of dicts."""
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        async with conn.execute("SELECT * FROM satellites ORDER BY name") as cursor:
            rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Conjunctions
# ---------------------------------------------------------------------------


async def insert_conjunction(event: dict) -> None:
    """Insert a new conjunction event.  Ignores duplicates (event_id conflict).

    Args:
        event: Dict with keys matching the conjunctions table columns.
               ``tca`` and ``created_at`` should be ISO 8601 strings.
    """
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        await conn.execute(
            """
            INSERT OR IGNORE INTO conjunctions
                (event_id, sat_primary, sat_secondary, tca,
                 miss_distance_km, pc, relative_velocity_km_s,
                 status, created_at, resolved_at, session_id)
            VALUES
                (:event_id, :sat_primary, :sat_secondary, :tca,
                 :miss_distance_km, :pc, :relative_velocity_km_s,
                 :status, :created_at, :resolved_at, :session_id)
            """,
            {
                "event_id":               event["event_id"],
                "sat_primary":            event["sat_primary"],
                "sat_secondary":          event["sat_secondary"],
                "tca":                    event["tca"],
                "miss_distance_km":       float(event["miss_distance_km"]),
                "pc":                     float(event["pc"]),
                "relative_velocity_km_s": float(event["relative_velocity_km_s"]),
                "status":                 event.get("status", "detected"),
                "created_at":             event["created_at"],
                "resolved_at":            event.get("resolved_at"),
                "session_id":             event.get("session_id"),
            },
        )
        await conn.commit()


async def get_session_for_event(event_id: str) -> str | None:
    """Return the LangGraph thread_id (session_id) that produced this conjunction."""
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        async with conn.execute(
            "SELECT session_id FROM conjunctions WHERE event_id=?", (event_id,)
        ) as cursor:
            row = await cursor.fetchone()
    return row["session_id"] if row else None


async def update_conjunction_status(
    event_id: str,
    status: str,
    resolved_at: str | None = None,
) -> None:
    """Update the status (and optionally resolved_at) of a conjunction event.

    Args:
        event_id:    UUID of the event to update.
        status:      New status string ('negotiating', 'pending_hitl',
                     'resolved', 'vetoed', …).
        resolved_at: ISO 8601 string; set when status becomes 'resolved' or
                     'vetoed'.  Pass None to leave unchanged.
    """
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        if resolved_at is not None:
            await conn.execute(
                "UPDATE conjunctions SET status=?, resolved_at=? WHERE event_id=?",
                (status, resolved_at, event_id),
            )
        else:
            await conn.execute(
                "UPDATE conjunctions SET status=? WHERE event_id=?",
                (status, event_id),
            )
        await conn.commit()


async def get_all_conjunctions() -> list[dict]:
    """Return all conjunction records, newest first."""
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        async with conn.execute(
            "SELECT * FROM conjunctions ORDER BY created_at DESC"
        ) as cursor:
            rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_conjunction(event_id: str) -> dict | None:
    """Return a single conjunction record by event_id, or None if not found."""
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        async with conn.execute(
            "SELECT * FROM conjunctions WHERE event_id=?", (event_id,)
        ) as cursor:
            row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


# ---------------------------------------------------------------------------
# Proposals
# ---------------------------------------------------------------------------


async def insert_proposal(proposal: dict) -> None:
    """Insert a maneuver proposal/bid.  Ignores duplicates (proposal_id conflict).

    Args:
        proposal: Dict with keys matching the proposals table columns.
    """
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        await conn.execute(
            """
            INSERT OR IGNORE INTO proposals
                (proposal_id, event_id, operator, satellite_name,
                 delta_v_ms, burn_direction, burn_time,
                 post_maneuver_pc, post_maneuver_miss_km,
                 fuel_cost_units, bid_score)
            VALUES
                (:proposal_id, :event_id, :operator, :satellite_name,
                 :delta_v_ms, :burn_direction, :burn_time,
                 :post_maneuver_pc, :post_maneuver_miss_km,
                 :fuel_cost_units, :bid_score)
            """,
            {
                "proposal_id":           proposal["proposal_id"],
                "event_id":              proposal["event_id"],
                "operator":              proposal["operator"],
                "satellite_name":        proposal["satellite_name"],
                "delta_v_ms":            float(proposal["delta_v_ms"]),
                "burn_direction":        proposal["burn_direction"],
                "burn_time":             proposal["burn_time"],
                "post_maneuver_pc":      float(proposal["post_maneuver_pc"]),
                "post_maneuver_miss_km": float(proposal["post_maneuver_miss_km"]),
                "fuel_cost_units":       float(proposal.get("fuel_cost_units", 0.0)),
                "bid_score":             float(proposal["bid_score"]),
            },
        )
        await conn.commit()


async def get_proposals_for_event(event_id: str) -> list[dict]:
    """Return all proposals for a given conjunction event, sorted by bid_score."""
    async with aiosqlite.connect(_db_path()) as conn:
        await _configure(conn)
        async with conn.execute(
            "SELECT * FROM proposals WHERE event_id=? ORDER BY bid_score ASC",
            (event_id,),
        ) as cursor:
            rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]
