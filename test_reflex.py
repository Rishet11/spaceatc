"""
test_reflex.py — Regression guard for the OrbitMind reflex decision engine.

Verifies the parts that replaced the old hardcoded if/elif decision:
  1. Threat classification stays deterministic on the documented range bands.
  2. RAG retrieval selects the correct play per band.
  3. The safety guardrail clamps/validates any proposed thruster command.
  4. The orchestrator (no API key -> rule-based fallback) emits a live range
     header, a single retrieved-play line, and a validated command when CRITICAL.

The CV pose pipeline is untouched and not exercised here.
"""

import asyncio
import json

import pytest

from backend.api.reflex_playbook import (
    classify_threat,
    retrieve_plays,
    validate_dodge_command,
    reflex_decision,
    reset_decision_cache,
    swept_range,
    DELTA_V_MIN_CM_S,
    DELTA_V_MAX_CM_S,
    _DECISION_CACHE,
)


def test_classification():
    assert classify_threat(False, 9.9) == ("SCANNING", "LOW")
    assert classify_threat(True, 3.0) == ("MONITORING", "LOW")
    assert classify_threat(True, 1.8) == ("WARNING", "AMBER")
    assert classify_threat(True, 0.9) == ("CRITICAL", "RED")


def test_retrieval():
    assert retrieve_plays(False, 0.0)[0]["id"] == "scan"
    assert retrieve_plays(True, 3.0)[0]["id"] == "monitor"
    assert retrieve_plays(True, 1.8)[0]["id"] == "prime"
    assert retrieve_plays(True, 0.9)[0]["id"] == "evade"


def test_guardrail():
    # Out-of-range magnitude is clamped; bad axis defaults to Y.
    cmd = validate_dodge_command({"axis": "Q", "delta_v_cm_s": 9999})
    assert cmd["axis"] == "Y" and cmd["delta_v_cm_s"] == DELTA_V_MAX_CM_S
    cmd = validate_dodge_command({"axis": "x", "delta_v_cm_s": -5})
    assert cmd["axis"] == "X" and cmd["delta_v_cm_s"] == DELTA_V_MIN_CM_S
    assert validate_dodge_command(None) is None


def test_replay_sweep():
    # Decision-Loop Replay sweeps the range so the agent walks every band.
    total = 100
    ranges = [swept_range(i, total) for i in range(total)]
    # Monotonic non-increasing far -> near.
    assert all(ranges[i] >= ranges[i + 1] for i in range(total - 1))
    # Starts safe (MONITORING), ends in evasion (CRITICAL).
    assert classify_threat(True, ranges[0])[0] == "MONITORING"
    assert classify_threat(True, ranges[-1])[0] == "CRITICAL"
    # Passes through every band so the demo shows the full autonomous policy.
    bands = {classify_threat(True, r)[0] for r in ranges}
    assert {"MONITORING", "WARNING", "CRITICAL"} <= bands


async def _orchestrator():
    reset_decision_cache()
    for det, dist in [(False, 9.9), (True, 3.0), (True, 1.8), (True, 0.9)]:
        st, tl = classify_threat(det, dist)
        log, cmd = await reflex_decision(st, tl, det, dist, [0.0, 0.0, dist], [1, 0, 0, 0])
        assert f"{dist:.2f} m" in log               # live range header
        assert log.count("Found Play") == 1          # single retrieved-play line
        if st == "CRITICAL":
            assert cmd and cmd["axis"] == "Y"
            assert DELTA_V_MIN_CM_S <= cmd["delta_v_cm_s"] <= DELTA_V_MAX_CM_S
        else:
            assert cmd is None


async def test_reflex_bad_llm_narrative_is_not_cached_falls_back_to_deterministic(monkeypatch):
    """Regression guard for the cache-poisoning defect: the LLM is invoked once
    per band and its result is written to _DECISION_CACHE. Before the review
    ran ahead of the cache write, a malformed narrative (missing the
    contractual "Verdict:" line) would be cached and served on every
    subsequent frame in that band for the life of the process. This asserts
    the bad narrative never reaches the returned decision_log and, critically,
    never reaches the cache — only the deterministic fallback does.
    """
    reset_decision_cache()
    monkeypatch.setattr("backend.config.settings.groq_api_key", "test-key")

    bad_reasoning = [
        "Debris tumbling on close approach trajectory.",
        "Executing Evasion Maneuver on +Y axis immediately.",
        # No line starting with "Verdict:" — violates the prompt's contract.
    ]

    async def fake_groq_chat(prompt, *, system=None, json_mode=False, max_tokens=256):
        return json.dumps(
            {
                "reasoning": bad_reasoning,
                "dodge_command": {
                    "axis": "Y",
                    "delta_v_cm_s": 12,
                    "duration_ms": 400,
                    "reason": "debris_tumbling_close_approach",
                },
            }
        )

    monkeypatch.setattr("backend.llm.groq_chat", fake_groq_chat)

    try:
        log, cmd, content_review = await reflex_decision(
            "CRITICAL", "RED", True, 0.9, [0.0, 0.0, 0.9], [1, 0, 0, 0]
        )

        # The rejected LLM narrative must never reach the operator feed.
        assert "close approach trajectory" not in log
        for bad_line in bad_reasoning:
            assert bad_line not in log

        # The deterministic fallback text (see _fallback_decision, CRITICAL
        # branch) must be what actually shipped.
        assert "Executing Evasion Maneuver..." in log
        assert "Command constraint validated successfully." in log

        # The actual regression guard: the cache holds the fallback, not the
        # rejected LLM output, so subsequent frames in this band are also safe.
        cached = _DECISION_CACHE["CRITICAL"]
        assert cached["reasoning"] == [
            "Executing Evasion Maneuver...",
            "Command constraint validated successfully.",
        ]
        for bad_line in bad_reasoning:
            assert bad_line not in cached["reasoning"]

        assert content_review["used_fallback"] is True
        assert content_review["reasons"]  # non-empty
    finally:
        reset_decision_cache()


async def test_reflex_good_llm_narrative_critical_is_accepted(monkeypatch):
    """Happy path: a well-formed CRITICAL narrative (has a 'Verdict:' line and
    an 'Executing Evasion' line, plus a valid dodge_command) passes review and
    is what actually ships — not the fallback."""
    reset_decision_cache()
    monkeypatch.setattr("backend.config.settings.groq_api_key", "test-key")

    good_reasoning = [
        "Executing Evasion Maneuver: debris on tumbling close-approach vector.",
        "Verdict: cross-track burn on +Y axis is required to clear the object.",
    ]

    async def fake_groq_chat(prompt, *, system=None, json_mode=False, max_tokens=256):
        return json.dumps(
            {
                "reasoning": good_reasoning,
                "dodge_command": {
                    "axis": "Y",
                    "delta_v_cm_s": 12,
                    "duration_ms": 400,
                    "reason": "debris_tumbling_close_approach",
                },
            }
        )

    monkeypatch.setattr("backend.llm.groq_chat", fake_groq_chat)

    try:
        log, cmd, content_review = await reflex_decision(
            "CRITICAL", "RED", True, 0.9, [0.0, 0.0, 0.9], [1, 0, 0, 0]
        )

        for line in good_reasoning:
            assert line in log
        assert cmd is not None and cmd["axis"] == "Y"
        assert content_review["passed"] is True
        assert content_review["used_fallback"] is False
    finally:
        reset_decision_cache()


def main():
    test_classification()
    test_retrieval()
    test_guardrail()
    test_replay_sweep()
    asyncio.run(_orchestrator())
    print("ALL REFLEX DECISION ASSERTIONS PASSED ✓")


if __name__ == "__main__":
    main()
