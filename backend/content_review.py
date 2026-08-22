"""backend/content_review.py — deterministic pre-broadcast content review.

SpaceATC renders LLM-authored prose (reflex narration, negotiation rationale)
straight to a human operator. Before any of that prose is cached or displayed
it must pass through this module.

This reviewer is deliberately **pure**: synchronous, no network I/O, no LLM
call, and no import of ``backend.llm`` (or anything that transitively imports
it). The entire point of the design is that the thing checking the LLM's
output cannot itself be fooled or bribed by prompt-injected text inside that
output, and cannot silently degrade into "ask another model whether this
model's answer looks okay". A reviewer built on regexes, length bounds and
fixed vocabulary either matches the deterministic contract (band, dodge
command, winner/loser identities, delta-v) or it doesn't — there is nothing
for adversarial text to negotiate with. Keeping this module stdlib-only and
free of any async/network dependency also means it can run inline on the hot
reflex path without adding latency or an additional failure mode.

Two entry points:

- ``review_reflex_narrative`` — checks the onboard reflex narrative (the
  ``reasoning`` lines + ``dodge_command``) against the deterministic threat
  band (``status``) and the deterministic need-a-burn flag (``need_cmd``)
  computed elsewhere (see ``backend/api/reflex_playbook.py``).
- ``review_negotiation_rationale`` — checks the short one-line explanation of
  which operator "won" a negotiated maneuver slot.

Both functions are defensive against malformed input: they never raise, they
always return a ``ContentReview``, and on any completeness/consistency
failure they fall back to caller-supplied safe text (or the original input if
no fallback was given) and log a warning.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ContentReview:
    """Result of running LLM-authored prose through the deterministic review."""

    passed: bool
    reasons: list[str] = field(default_factory=list)
    reviewed_text: str | list[str] | None = None
    used_fallback: bool = False


# ---------------------------------------------------------------------------
# review_reflex_narrative
# ---------------------------------------------------------------------------

_MAX_REASONING_LINES = 3
_MAX_LINE_CHARS = 200

_CRITICAL_CONTRADICTIONS = ("nominal", "no maneuver", "no burn", "passive tracking")
_NON_CRITICAL_CONTRADICTIONS = ("executing evasion", "evasion burn")

# Standalone thruster-axis letters: a bare X/Y/Z (optionally signed, e.g. "+Y",
# "-X") that is not glued to other letters/digits, so it matches "+Y axis" but
# not the "Y" inside an ordinary word.
_AXIS_RE = re.compile(r"(?<![A-Za-z0-9])[+-]?([XYZ])(?![A-Za-z0-9])")


def _coerce_lines(reasoning: Any) -> list[str] | None:
    """Return a stripped list[str] view of ``reasoning`` if it is a list, else None."""
    if not isinstance(reasoning, list):
        return None
    lines: list[str] = []
    for item in reasoning:
        try:
            lines.append(str(item).strip())
        except Exception:  # noqa: BLE001 — never let a hostile __str__ raise
            lines.append("")
    return lines


def review_reflex_narrative(
    reasoning: Any,
    dodge_command: Any,
    status: Any,
    need_cmd: Any,
    fallback_reasoning: list[str] | None = None,
) -> ContentReview:
    """Review the onboard reflex narrative before it ships to the operator feed."""
    need_cmd = bool(need_cmd)
    status_str = status if isinstance(status, str) else None
    cmd = dodge_command if isinstance(dodge_command, dict) else None

    reasons: list[str] = []
    lines = _coerce_lines(reasoning)

    if lines is None or not (1 <= len(lines) <= _MAX_REASONING_LINES):
        got = len(lines) if lines is not None else type(reasoning).__name__
        reasons.append(
            f"reasoning must be a non-empty list of 1 to {_MAX_REASONING_LINES} "
            f"lines (got {got})"
        )
    safe_lines = lines or []

    for i, line in enumerate(safe_lines):
        if not (1 <= len(line) <= _MAX_LINE_CHARS):
            reasons.append(
                f"reasoning line {i} must be 1-{_MAX_LINE_CHARS} characters "
                f"after stripping (got {len(line)})"
            )

    if not any(line.startswith("Verdict:") for line in safe_lines):
        reasons.append("reasoning must include a line starting with 'Verdict:'")

    has_evasion_line = any(line.startswith("Executing Evasion") for line in safe_lines)
    if status_str == "CRITICAL" and not has_evasion_line:
        reasons.append(
            "CRITICAL band narrative is missing the required "
            "'Executing Evasion' line"
        )
    elif status_str != "CRITICAL" and has_evasion_line:
        reasons.append(
            f"'Executing Evasion' line present outside the CRITICAL band "
            f"(status={status_str!r})"
        )

    if need_cmd and cmd is None:
        reasons.append("critical band shipped with no validated burn command")
    if not need_cmd and cmd is not None:
        reasons.append("burn command proposed outside the evasion band")

    joined = " ".join(safe_lines)
    lowered = joined.lower()

    if status_str == "CRITICAL":
        for phrase in _CRITICAL_CONTRADICTIONS:
            if phrase in lowered:
                reasons.append(
                    f"CRITICAL narrative contains contradictory phrase {phrase!r}"
                )
    if status_str in ("MONITORING", "SCANNING"):
        for phrase in _NON_CRITICAL_CONTRADICTIONS:
            if phrase in lowered:
                reasons.append(
                    f"{status_str} narrative contains contradictory phrase {phrase!r}"
                )

    if cmd is not None:
        cmd_axis = str(cmd.get("axis", "")).upper()
        found_axes = {m.group(1) for m in _AXIS_RE.finditer(joined)}
        mismatched = sorted(found_axes - {cmd_axis})
        if mismatched:
            reasons.append(
                "narrative axis "
                + ", ".join(repr(a) for a in mismatched)
                + f" does not match commanded axis {cmd_axis!r}"
            )

    passed = not reasons
    if passed:
        return ContentReview(
            passed=True, reasons=[], reviewed_text=reasoning, used_fallback=False
        )

    logger.warning("content review failed for %s: %s", "reflex_narrative", reasons)
    reviewed_text = fallback_reasoning if fallback_reasoning is not None else reasoning
    return ContentReview(
        passed=False, reasons=reasons, reviewed_text=reviewed_text, used_fallback=True
    )


# ---------------------------------------------------------------------------
# review_negotiation_rationale
# ---------------------------------------------------------------------------

_MAX_TEXT_CHARS = 280
_MPS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*m/s")
_DV_RELATIVE_TOLERANCE = 0.05


def _normalize_name(s: str) -> str:
    """Fold separator punctuation so 'Demo_A' and 'Demo A' compare equal.

    LLM prose commonly de-codes operator IDs (e.g. drops the underscore) when
    writing natural-language sentences, so a plain substring check against
    the raw ID is too strict.
    """
    return re.sub(r"[_-]+", " ", s.lower())


# A handful of adverbs that legitimately sit between a helper verb ("was")
# and the selection verb in ordinary English ("was ultimately selected").
_ADVERB = r"(?:ultimately|clearly|finally|actually|already|indeed|then|now|eventually|simply)"


def _credits_loser_re(loser_str: str) -> re.Pattern:
    """Match the loser name directly playing the grammatical role of the
    winner in a selection verb: subject-verb ("Demo_B was ultimately
    selected") or verb-object ("picked Demo_B"), tightly adjacent (only the
    helper verb and a single adverb may sit in between).

    Deliberately tight rather than a character-proximity + word-blacklist
    check: comparative prose commonly puts an ordinary word like "over",
    "while", or "but" near the loser's name for reasons unrelated to
    crediting it ("chosen over Demo_B", "Demo_B was, over budget, not
    picked") and a blacklist keyed on those words produces false negatives
    (missing real misattribution) as often as it fixes false positives. Tight
    grammatical adjacency instead means any intervening clause — comparison
    or otherwise — simply breaks the match, so it never falsely credits the
    loser; the tradeoff is that a misattribution buried in an unusually
    convoluted sentence can go uncaught, which is the safer failure mode
    here.
    """
    loser_pat = re.escape(_normalize_name(loser_str))
    return re.compile(
        rf"\b{loser_pat}\b(?:'s)?(?:\s+(?:was|is|were|has been))?(?:\s+{_ADVERB})?"
        rf"(?:\s+being)?\s+(?:selected|chosen|the winner|picked|wins|won)\b"
        rf"|\b(?:selected|chose|chosen|picked)(?:\s+{_ADVERB})?\s+{loser_pat}\b",
        re.IGNORECASE,
    )


def review_negotiation_rationale(
    text: Any = None,
    winner: Any = None,
    loser: Any = None,
    winner_dv: Any = None,
    fallback_text: str | None = None,
) -> ContentReview:
    """Review a short negotiation-outcome rationale before it ships to the operator feed."""
    reasons: list[str] = []
    text_str = text if isinstance(text, str) else None

    if text_str is None:
        reasons.append("text must be a string")
        haystack = ""
    else:
        haystack = text_str
        if not text_str.strip():
            reasons.append("text must be non-empty after stripping")
        if "\n" in text_str:
            reasons.append("text must not contain a newline")
        if len(text_str) > _MAX_TEXT_CHARS:
            reasons.append(
                f"text must be at most {_MAX_TEXT_CHARS} characters "
                f"(got {len(text_str)})"
            )

    winner_str = str(winner) if winner is not None else ""
    loser_str = str(loser) if loser is not None else ""
    normalized_haystack = _normalize_name(haystack)

    if winner_str and _normalize_name(winner_str) not in normalized_haystack:
        reasons.append(f"text must mention the winner name {winner_str!r}")
    elif not winner_str:
        reasons.append("winner name is missing/empty")

    if loser_str and _credits_loser_re(loser_str).search(normalized_haystack):
        reasons.append(
            f"text credits the loser {loser_str!r} as the one selected/chosen/winning"
        )

    try:
        wdv = float(winner_dv)
    except (TypeError, ValueError):
        wdv = None

    cited = [float(m.group(1)) for m in _MPS_RE.finditer(haystack)]
    if cited:
        if wdv is None:
            reasons.append("winner_dv is not numeric; cannot verify cited m/s value(s)")
        else:
            for val in cited:
                if wdv == 0:
                    if val != 0:
                        reasons.append(
                            f"cited value {val} m/s does not match winner delta-v of 0 m/s"
                        )
                else:
                    rel = abs(val - wdv) / abs(wdv)
                    if rel > _DV_RELATIVE_TOLERANCE:
                        reasons.append(
                            f"cited value {val} m/s is not within "
                            f"{_DV_RELATIVE_TOLERANCE * 100:.0f}% of winner "
                            f"delta-v {wdv} m/s"
                        )

    passed = not reasons
    if passed:
        return ContentReview(
            passed=True, reasons=[], reviewed_text=text, used_fallback=False
        )

    logger.warning("content review failed for %s: %s", "negotiation_rationale", reasons)
    reviewed_text = fallback_text if fallback_text is not None else text
    return ContentReview(
        passed=False, reasons=reasons, reviewed_text=reviewed_text, used_fallback=True
    )
