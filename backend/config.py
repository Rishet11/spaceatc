"""
backend/config.py — Application settings loaded from .env via pydantic-settings.

Usage:
    from backend.config import settings
    print(settings.celestrak_base_url)

LLM: all AI calls use Gemini via google-generativeai.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- CelesTrak ---
    celestrak_base_url: str = "https://celestrak.org/NORAD/elements/gp.php"

    # --- Space-Track.org (optional backup) ---
    space_track_username: str = ""
    space_track_password: str = ""

    # --- LLM API key (Gemini) ---
    gemini_api_key: str = ""

    # --- Database ---
    sqlite_path: str = "./spaceatc.db"

    # --- WebSocket / TLE refresh ---
    websocket_ping_interval: int = 5       # seconds
    tle_refresh_interval: int = 3600       # seconds

    # --- Conjunction screening thresholds ---
    screening_distance_km: float = 5.0
    pc_alert_threshold: float = 1e-4
    pc_safe_threshold: float = 1e-6


# Singleton — import this everywhere instead of constructing Settings() per call.
settings = Settings()
