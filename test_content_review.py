"""
test_content_review.py — Guards for the pre-broadcast content readiness review.

Locks in the completeness/consistency contract that review_reflex_narrative
and review_negotiation_rationale must satisfy before reflex narration and
negotiation rationale text is allowed to reach the live demo feed. Also
guards the "never raise on malformed input" requirement for both functions.
"""

import pytest

from backend.content_review import (
    ContentReview,
    review_reflex_narrative,
    review_negotiation_rationale,
)

# --- Reusable reflex-narrative fixtures ---------------------------------

CRITICAL_GOOD = [
    "Verdict: collision risk is unacceptable at current range.",
    "Executing Evasion burn on the +Y axis to open separation.",
]

MONITORING_GOOD = [
    "Verdict: range is safely outside the alert envelope.",
]

CRITICAL_DODGE_CMD = {"axis": "Y", "delta_v_cm_s": 12, "duration_ms": 400}


# --- review_reflex_narrative --------------------------------------------


def test_reflex_happy_path_critical_passes():
    result = review_reflex_narrative(
        CRITICAL_GOOD, CRITICAL_DODGE_CMD, "CRITICAL", True
    )
    assert result.passed is True
    assert result.reasons == []
    assert result.used_fallback is False
    assert result.reviewed_text == CRITICAL_GOOD


def test_reflex_happy_path_monitoring_passes():
    result = review_reflex_narrative(MONITORING_GOOD, None, "MONITORING", False)
    assert result.passed is True
    assert result.reasons == []
    assert result.used_fallback is False
    assert result.reviewed_text == MONITORING_GOOD


def test_reflex_missing_verdict_line_fails_with_fallback():
    reasoning = ["Range is closing fast, holding current heading."]
    fallback = ["Verdict: fallback narrative in effect."]
    result = review_reflex_narrative(
        reasoning, None, "MONITORING", False, fallback_reasoning=fallback
    )
    assert result.passed is False
    assert result.used_fallback is True
    assert result.reasons != []
    assert result.reviewed_text == fallback


def test_reflex_critical_missing_executing_evasion_line_fails():
    reasoning = ["Verdict: collision risk is unacceptable at current range."]
    result = review_reflex_narrative(
        reasoning, CRITICAL_DODGE_CMD, "CRITICAL", True
    )
    assert result.passed is False


def test_reflex_monitoring_with_executing_evasion_line_fails():
    reasoning = [
        "Verdict: range is safely outside the alert envelope.",
        "Executing Evasion burn just in case.",
    ]
    result = review_reflex_narrative(reasoning, None, "MONITORING", False)
    assert result.passed is False


def test_reflex_need_cmd_true_without_dodge_command_fails():
    result = review_reflex_narrative(CRITICAL_GOOD, None, "CRITICAL", True)
    assert result.passed is False


def test_reflex_need_cmd_false_with_dodge_command_fails():
    result = review_reflex_narrative(
        MONITORING_GOOD, CRITICAL_DODGE_CMD, "MONITORING", False
    )
    assert result.passed is False


def test_reflex_axis_mismatch_fails_and_mentions_both_axes():
    reasoning = [
        "Verdict: collision risk is unacceptable at current range.",
        "Executing Evasion burn on the +Z axis to open separation.",
    ]
    result = review_reflex_narrative(
        reasoning, CRITICAL_DODGE_CMD, "CRITICAL", True
    )
    assert result.passed is False
    joined_reasons = " ".join(result.reasons)
    assert "Y" in joined_reasons
    assert "Z" in joined_reasons


def test_reflex_axis_agreement_with_signed_prefix_passes():
    reasoning = [
        "Verdict: collision risk is unacceptable at current range.",
        "Executing Evasion burn on the +Y axis to open separation.",
    ]
    result = review_reflex_narrative(
        reasoning, CRITICAL_DODGE_CMD, "CRITICAL", True
    )
    assert result.passed is True


def test_reflex_band_contradiction_nominal_in_critical_fails():
    reasoning = [
        "Verdict: nominal, no immediate action required.",
        "Executing Evasion burn on the +Y axis to open separation.",
    ]
    result = review_reflex_narrative(
        reasoning, CRITICAL_DODGE_CMD, "CRITICAL", True
    )
    assert result.passed is False


def test_reflex_too_many_lines_fails():
    reasoning = [
        "Verdict: collision risk is unacceptable at current range.",
        "Executing Evasion burn on the +Y axis to open separation.",
        "Extra line one.",
        "Extra line two.",
    ]
    result = review_reflex_narrative(
        reasoning, CRITICAL_DODGE_CMD, "CRITICAL", True
    )
    assert result.passed is False


def test_reflex_empty_reasoning_list_fails():
    result = review_reflex_narrative([], None, "MONITORING", False)
    assert result.passed is False


def test_reflex_malformed_input_does_not_raise():
    result = review_reflex_narrative(None, "not a dict", None, False)
    assert isinstance(result, ContentReview)
    assert result.passed is False


def test_reflex_line_over_200_chars_fails():
    reasoning = ["Verdict: " + "x" * 200]
    result = review_reflex_narrative(reasoning, None, "MONITORING", False)
    assert result.passed is False


# --- review_negotiation_rationale ---------------------------------------


def test_negotiation_happy_path_passes():
    text = "OperatorA was selected for this maneuver, burning 0.087 m/s."
    result = review_negotiation_rationale(text, "OperatorA", "OperatorB", 0.087)
    assert result.passed is True
    assert result.reasons == []
    assert result.used_fallback is False
    assert result.reviewed_text == text


def test_negotiation_crediting_loser_fails():
    text = "OperatorB was selected for this maneuver."
    result = review_negotiation_rationale(text, "OperatorA", "OperatorB", 0.087)
    assert result.passed is False


def test_negotiation_delta_v_far_off_fails():
    text = "OperatorA was selected for this maneuver, burning 9.999 m/s."
    result = review_negotiation_rationale(text, "OperatorA", "OperatorB", 0.087)
    assert result.passed is False


def test_negotiation_empty_text_fails_with_fallback():
    fallback = "OperatorA was selected on lower maneuver history."
    result = review_negotiation_rationale(
        "   ", "OperatorA", "OperatorB", 0.087, fallback_text=fallback
    )
    assert result.passed is False
    assert result.used_fallback is True
    assert result.reviewed_text == fallback


def test_negotiation_text_over_280_chars_fails():
    text = "OperatorA was selected for this maneuver. " + "padding " * 40
    result = review_negotiation_rationale(text, "OperatorA", "OperatorB", 0.087)
    assert result.passed is False


def test_negotiation_text_with_newline_fails():
    text = "OperatorA was selected for this maneuver,\nburning 0.087 m/s."
    result = review_negotiation_rationale(text, "OperatorA", "OperatorB", 0.087)
    assert result.passed is False


def test_negotiation_text_missing_winner_name_fails():
    text = "The maneuver was completed successfully, burning 0.087 m/s."
    result = review_negotiation_rationale(text, "OperatorA", "OperatorB", 0.087)
    assert result.passed is False


def test_negotiation_malformed_text_none_does_not_raise():
    result = review_negotiation_rationale(None, "OperatorA", "OperatorB", 0.087)
    assert isinstance(result, ContentReview)
    assert result.passed is False


# --- Regression guards: loser-proximity false positives (Round 2 bug) ---


def test_negotiation_loser_named_in_comparison_passes():
    """Naming the loser near a selection verb in a genuine comparison is
    normal, correct English and must not be rejected."""
    text = (
        "Demo_A was chosen over Demo_B because, even though both maneuvers "
        "required the same 0.242 m/s ΔV, Demo_A provided a larger fuel "
        "margin, making it the more robust option."
    )
    result = review_negotiation_rationale(text, "Demo_A", "Demo_B", 0.242)
    assert result.passed is True
    assert result.reasons == []


def test_negotiation_winner_name_underscore_vs_space_passes():
    """LLM prose commonly writes 'Demo A' for the operator ID 'Demo_A'."""
    text = "Demo A was chosen because it provided a larger fuel margin at 0.242 m/s."
    result = review_negotiation_rationale(text, "Demo_A", "Demo_B", 0.242)
    assert result.passed is True
    assert result.reasons == []


def test_negotiation_loser_directly_credited_still_fails():
    """True positive: the loser is what's actually described as selected."""
    text = (
        "Demo_A proposed a burn, but Demo_B was ultimately selected for this "
        "maneuver, burning 0.242 m/s."
    )
    result = review_negotiation_rationale(text, "Demo_A", "Demo_B", 0.242)
    assert result.passed is False
    assert any("Demo_B" in r for r in result.reasons)


# --- Regression guard: winner-name Unicode-space false positive (Round 3) --
#
# Live Groq output for this prompt intermittently renders the operator ID's
# separator as a narrow no-break space (U+202F) instead of an ASCII space or
# underscore, e.g. "Demo A was chosen...". A `[_-]+`-only fold in
# _normalize_name missed that, so a real, correct sentence was rejected and
# replaced by the flat fallback template.


def test_negotiation_winner_name_narrow_nbsp_passes():
    text = (
        "Demo A was chosen because, despite identical Δv (0.242 m/s), "
        "it offered a larger fuel margin and more favorable timing than "
        "Demo B."
    )
    result = review_negotiation_rationale(text, "Demo_A", "Demo_B", 0.242)
    assert result.passed is True
    assert result.reasons == []


def test_negotiation_winner_name_thin_space_passes():
    text = "Demo A was chosen because it provided a larger fuel margin at 0.242 m/s."
    result = review_negotiation_rationale(text, "Demo_A", "Demo_B", 0.242)
    assert result.passed is True
    assert result.reasons == []


def test_negotiation_winner_name_nbsp_passes():
    text = "Demo A was chosen because it provided a larger fuel margin at 0.242 m/s."
    result = review_negotiation_rationale(text, "Demo_A", "Demo_B", 0.242)
    assert result.passed is True
    assert result.reasons == []


def test_negotiation_loser_credited_with_unicode_space_still_fails():
    """The Unicode-space fold must not weaken the loser-credit guarantee."""
    text = (
        "Demo A proposed a burn, but Demo B was ultimately selected "
        "for this maneuver, burning 0.242 m/s."
    )
    result = review_negotiation_rationale(text, "Demo_A", "Demo_B", 0.242)
    assert result.passed is False
    assert any("Demo_B" in r for r in result.reasons)


def test_negotiation_delta_v_mismatch_with_unicode_space_still_fails():
    """The Unicode-space fold must not weaken the delta-v cross-check."""
    text = "Demo A was chosen for this maneuver, burning 9.999 m/s."
    result = review_negotiation_rationale(text, "Demo_A", "Demo_B", 0.242)
    assert result.passed is False
