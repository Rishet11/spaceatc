"""backend/llm.py — single Groq entrypoint for all LLM narrative calls.
Returns None on missing key or any error so callers keep their fallbacks."""
import logging

from backend.config import settings

logger = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        from groq import AsyncGroq
        _client = AsyncGroq(api_key=settings.groq_api_key)
    return _client


async def groq_chat(
    prompt: str, *, system: str | None = None, json_mode: bool = False,
    max_tokens: int = 256, reasoning_effort: str | None = None,
) -> str | None:
    if not settings.groq_api_key:
        return None
    try:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        kwargs = {"model": settings.groq_model, "messages": messages, "max_completion_tokens": max_tokens, "temperature": 0.3}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
        resp = await _get_client().chat.completions.create(**kwargs)
        text = resp.choices[0].message.content
        return text.strip() if text else None
    except Exception as e:  # noqa: BLE001
        logger.error("Groq call failed: %s", e)
        return None
