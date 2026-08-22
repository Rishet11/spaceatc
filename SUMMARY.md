# SpaceATC — Work Summary

**Date:** 22 Aug 2026
**Scope:** Pre-judging readiness audit + frontend remediation
**Status:** 18 fixes applied and verified. All committed at HEAD (`15f35d9`).

---

## What was done

A five-way parallel audit (frontend/globe, decision flow, SGP4 + conjunction math,
LangGraph + HITL, vision reflex + RAG playbook), followed by an adversarial critique
pass, then implementation of the frontend fixes and one critical backend fix.

Every claim acted on was independently re-verified against running code before any
edit. Claims that did not survive verification were dropped rather than reported.

**Full findings report:** [`AUDIT.md`](./AUDIT.md)
**Continuation instructions:** [`HANDOFF.md`](./HANDOFF.md)
**Prompt for the next agent:** [`NEXT_AGENT_PROMPT.md`](./NEXT_AGENT_PROMPT.md)

---

## Headline results

| | |
|---|---|
| Fixes applied & verified | **18** across 15 files |
| New test coverage | `test_orbital.py` — 3 regression tests (repo previously had **zero** coverage of the orbital math) |
| Test suite | **8/8 green** |
| Typecheck / build | Clean `tsc`, successful production build |
| Console errors, full demo run | **27 → 1** (the remaining one is a benign headless socket warning) |
| Open backend risks | **6** ranked, not fixed — deliberate, see below |

---

## The three findings that mattered most

**1. The Earth was rotating 15× too slowly.**
`backend/orbital/propagator.py` treated the Vallado GMST polynomial's output as
arcseconds; it returns seconds of time. Every longitude on the globe was wrong.
Latitude and altitude were unaffected, which is exactly why it survived eyeballing.
Verified numerically: the fix reproduces the textbook J2000 value 280.46061837°,
where the old code returned 18.6974° — precisely 1/15.

**2. Two reported "UI bugs" were not what they appeared to be.**
The conjunction indicator was not a stale-prop or re-render bug — the NEGOTIATE stage
was *unreachable code*, because the backend never writes `negotiating` to the DB.
And there is no click-to-select interaction anywhere in the app, so that half was a
missing feature rather than a broken one. Likewise the debris-avoidance dodge was
mathematically unreachable: the offset branch required `satX <= 750` while the
CRITICAL threshold only fires above 766, so the satellite never left the centerline.

**3. Backend internals were leaking into the judge-facing UI.**
Approve rendered 25 raw binary-search rows in a modal that covered the globe at the
exact moment the satellite maneuvers, and two separate React duplicate-key collisions
were silently dropping the payoff rows. Now a result card reading
`0.120 km → 3.391 km · 28.2× more separation`, built entirely from payload fields
that already existed and were being discarded.

---

## Deliberately NOT fixed

Six backend items are ranked in `AUDIT.md` but left alone on purpose: they are
behavioral changes to the safety story (HITL `event_id` validation, the unconditional
`generate_bids → await_hitl` edge, missing auth on approve/veto) that the team should
make consciously rather than discover in a diff.

Four further items are flagged as **rehearse, don't fix** — the playbook is a 4-row
deterministic lookup rather than RAG, Pc is capped at 3.14e-4, the demo pair is
co-orbital formation flying at ~0.1 m/s, and the CW miss model cannot represent a
harmful burn. These are defensible as hackathon simplifications, but only if
volunteered before a judge finds them.

---

## One blocker before any demo

The three OrbitMind assets are unresolved Git LFS pointers (133 / 132 / 133 bytes) and
`git-lfs` is not installed. Every reflex endpoint returns 503, and the UI masks this
behind a fake frame slider and a green `PIPELINE: READY` badge. **Run `git lfs pull`
and verify the file sizes before presenting.**

---

## Round 2 — Content Readiness Review

**Scope:** Challenge #464 (ethical safeguards). Full writeup and demo script in
[`ROUND2.md`](./ROUND2.md).

New module `backend/content_review.py`: a synchronous, network-free, stdlib-only
reviewer with no LLM in the loop, so it cannot be fooled by the text it is
reviewing. It gates the two LLM-authored prose surfaces in the system —
the onboard reflex narrative and the negotiation rationale — for completeness
and consistency against the deterministic facts computed elsewhere (threat
band, dodge command, winner/loser identity, delta-V).

Wiring is the load-bearing part: in `backend/api/reflex_playbook.py`, the
review (line 271) runs strictly before the per-band cache write (line 319),
so a rejected narrative is never replayed on subsequent frames — only the
deterministic fallback is cached. In
`backend/agents/nodes/operator_agent.py`, the negotiation rationale was
previously computed by an LLM call and then discarded entirely (a real
dead-code defect); it is now reviewed and, on pass, written into
`winning_proposal["rationale"]`, which reaches the frontend via
`ManeuverProposalResponse.rationale`.

UI: `ReflexPanel.tsx` shows a `Content Reviewed` / `Safe Fallback` pill next
to the onboard decision engine; `HITLPanel.tsx` shows an `AI RATIONALE` row,
hidden when empty.

Test suite grew from 8 passing to **33 passing** (`test_content_review.py` —
22 new unit tests; `test_reflex.py` — 2 new integration tests including a
regression guard that a Verdict-less narrative is not cached; and
`test_negotiation.py`, which previously collected **zero** tests — its
pre-existing `main()` had no `test_` prefix, so the negotiation path was
untested before this work).

Also applied in Round 2, same principle as the review feature (don't present
unverified state as if it were validated) but separate from it: the hardcoded
green `PIPELINE: READY` badge referenced above is now tri-state and bound to
real fetch state, the 5.0 m default distance and the fake 0.000 pose
telemetry that rendered as if they were real sensor data now render as an
em dash, `totalFrames` no longer defaults to a fake 100, the threat-band
legend now reads its thresholds from a single shared source
(`frontend/src/constants/thresholds.ts`), the `[Executor]` EventFeed badge
case mismatch is fixed, and the duplicated `hitl_request` websocket emission
is removed. Details and file:line citations in `ROUND2.md` §5.
