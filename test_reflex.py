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

from backend.api.reflex_playbook import (
    classify_threat,
    retrieve_plays,
    validate_dodge_command,
    reflex_decision,
    reset_decision_cache,
    DELTA_V_MIN_CM_S,
    DELTA_V_MAX_CM_S,
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


def main():
    test_classification()
    test_retrieval()
    test_guardrail()
    asyncio.run(_orchestrator())
    print("ALL REFLEX DECISION ASSERTIONS PASSED ✓")


if __name__ == "__main__":
    main()
