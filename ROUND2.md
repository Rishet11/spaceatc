# Round 2 — Content Readiness Review

**Event:** FAR AWAY 2026 — Round 2
**Team:** ClauseZero (U3M9X94O)
**Challenge #464 — Ethical safeguards: Content Readiness Review**

> "Improve the part of your existing MVP most related to ethical safeguards so that
> it can review user-facing content for completeness and consistency before it
> becomes active. The requirement should leave teams free to choose their own
> technical and product approach."

This document is the judge-facing record of that deliverable. It describes work
already applied and verifiable in the working tree at the commit noted in the
repo's `SUMMARY.md` (`15f35d9`) or later.

---

## 1. What our existing ethical safeguard was

The MVP's ethical safeguard is the human-in-the-loop (HITL) maneuver gate: no
satellite maneuver executes without an explicit human "approve."

- `backend/agents/graph.py:85` compiles the LangGraph workflow with
  `interrupt_before=["await_hitl"]` — execution physically pauses before the HITL
  node runs.
- `backend/agents/graph.py:30-34` (`route_after_hitl`) only routes to
  `execute_maneuver` when `state.get("hitl_decision") == "approve"` — the exact
  string, nothing looser.
- `backend/agents/nodes/maneuver_executor.py:27` repeats the check independently:
  `if not winning_proposal or hitl_decision != "approve":` short-circuits execution
  and returns `"[EXECUTOR] Maneuver execution skipped or vetoed."` This is a second,
  separate guard — not just a reachability property of the graph.

Both guards verify that a human said yes. Neither verified that what the human was
shown, in order to decide, was worth showing. That gap — content correctness
upstream of a decision, not the decision logic itself — is what this deliverable
addresses.

---

## 2. Why the exposure is not a hallucinated number

The maneuver math in this system is deterministic, not AI-generated, and it fails
closed:

- `backend/orbital/conjunction.py` computes closest approach and Pc from SGP4
  propagation plus Clohessy-Wiltshire relative motion — no LLM in the loop.
- `backend/orbital/conjunction.py:376-377` rejects an out-of-envelope delta-V rather
  than returning it: `if not (0.001 <= delta_v_ms <= 500): raise ValueError(...)`.
- `backend/orbital/conjunction.py:378-379` rejects a maneuver that fails to reach a
  safe post-burn Pc: `if final_pc > 1e-4: raise ValueError(...)`.
- `backend/orbital/conjunction.py:380-381` rejects a maneuver that doesn't actually
  increase miss distance: `raise ValueError("Miss distance did not increase after
  maneuver")`.
- Winner selection among competing operator bids is a plain
  `min(proposals, key=lambda x: x["bid_score"])` at
  `backend/agents/nodes/operator_agent.py:125` — no model involved.

So the numbers a human sees when deciding "approve" or "veto" are backed by
assertions that raise rather than degrade silently. The real exposure sits
elsewhere: LLM-authored **prose** — the reflex agent's onboard-log narration —
rendered to a human as though it were a validated system statement, with no
equivalent fail-closed check on the prose itself. That is the gap this deliverable
targets.

---

## 3. The two defects we found

Both are in `backend/api/reflex_playbook.py`, which generates the onboard-log
narrative shown in the reflex panel.

### 3a. A prompt-stated contract that nothing enforced

The LLM prompt (`backend/api/reflex_playbook.py:236-240`) instructs the model to:

- end its `reasoning` array with a line starting `"Verdict:"`, and
- for a `CRITICAL` threat band, also include a line starting `"Executing Evasion"`.

The only post-parse validation, at `backend/api/reflex_playbook.py:250-252`, is:

```python
reasoning = [str(x) for x in data.get("reasoning", []) if str(x).strip()]
if not reasoning:
    return None
```

That is a bare non-empty check. Nothing confirms the `"Verdict:"` line is present,
nothing confirms the `"Executing Evasion"` line is present when the band is
`CRITICAL`, and nothing confirms the reasoning is internally consistent with the
`dodge_command` that came back alongside it. The prompt states a contract; the code
enforces none of it.

### 3b. A malformed generation is served on every subsequent frame

`_DECISION_CACHE` (`backend/api/reflex_playbook.py:81`) caches the LLM's narrative
once per threat band for the life of the process:

```python
cached = _DECISION_CACHE.get(status)
if cached is None:
    cached = await _llm_reflex_decision(...)
    if cached is None:
        cached = _fallback_decision(status, plays)
    _DECISION_CACHE[status] = cached
```

(`backend/api/reflex_playbook.py:277-284`)

The LLM runs once per band, not once per frame — a deliberate design choice to
avoid re-invoking the model 30 times a second. But it means one malformed
generation — one that passes the bare non-empty check in 3a but violates the
prompt's stated contract — is then served, unchanged, on every subsequent frame in
that band for the remaining life of the process. This is why "before it becomes
active" has a precise technical meaning in this codebase: the review has to happen
before the cache write at line 284, not at render time, or the defect is locked in
for the rest of the demo.

### 3c. Evasion prose with no command behind it

For a `CRITICAL` frame, `dodge_command` is only populated when
`validate_dodge_command()` accepts the LLM's proposed command
(`backend/api/reflex_playbook.py:253`). If the proposed command is malformed and
`validate_dodge_command` returns `None`, nothing retracts or edits the `reasoning`
array the model produced — including any `"Executing Evasion"` line the model wrote
per the prompt's instruction. The onboard log can therefore narrate an evasion
maneuver while the system executes no command at all. This is the same class of
defect as 3a and 3b: the check that exists (`validate_dodge_command`) protects the
thruster command, but nothing propagates that outcome back into the prose
describing it.

---

## 4. What we built — the content readiness review

### The review primitive

`backend/content_review.py` is a new, deliberately dumb module: synchronous,
stdlib-only, and free of any import of `backend.llm` or anything that
transitively imports it. It exposes a `ContentReview` dataclass
(`passed: bool`, `reasons: list[str]`, `reviewed_text: str | list[str] | None`,
`used_fallback: bool`) and two entry points, `review_reflex_narrative(...)` and
`review_negotiation_rationale(...)`. Neither function ever raises — malformed
input produces a failed `ContentReview`, not an exception, so a hostile or
broken generation degrades the review outcome rather than crashing the request.

The design point worth stating plainly: because the reviewer contains no
model, it cannot be fooled by the thing it is reviewing. There is no prompt
surface inside the review for adversarial or malformed LLM text to negotiate
with — the checks are regexes, length bounds, and a fixed vocabulary, and the
generated text either matches the deterministic contract computed elsewhere
(band, dodge command, winner/loser identity, delta-V) or it doesn't.

### Where it runs

Reflex path — `backend/api/reflex_playbook.py`:
- `review_reflex_narrative` is called at `backend/api/reflex_playbook.py:271`,
  inside `_llm_reflex_decision`.
- `_llm_reflex_decision` is invoked from `reflex_decision` at
  `backend/api/reflex_playbook.py:313`.
- The per-band cache write, `_DECISION_CACHE[status] = cached`, happens at
  `backend/api/reflex_playbook.py:319`.

The review runs strictly between the LLM call and the cache write. That
ordering is the whole point: once a narrative is written into
`_DECISION_CACHE` it is replayed unchanged on every subsequent frame in that
threat band for the life of the process (this is the 3b defect), so the
review has to gate the write, not the render.

Negotiation path — `backend/agents/nodes/operator_agent.py`: previously the
LLM-authored rationale was computed and then discarded — a real dead-code
defect, since the model was invoked on every negotiation and its output never
reached any payload. `review_negotiation_rationale` is now called on that
text before it is written into `winning_proposal["rationale"]`, which flows
to the frontend through `ManeuverProposalResponse.rationale`
(`backend/api/schemas.py:147`).

### What it checks (completeness / consistency)

`review_reflex_narrative(reasoning, dodge_command, status, need_cmd, fallback_reasoning=None)`:

- **Completeness** — `reasoning` must be a list of 1-3 lines, each 1-200
  characters after stripping; one line must start with `"Verdict:"`; a line
  starting `"Executing Evasion"` must be present if and only if
  `status == "CRITICAL"`; a validated `dodge_command` must be present if and
  only if `need_cmd` is true.
- **Consistency** — a fixed denylist rejects band-contradicting phrases: a
  `CRITICAL` narrative may not contain `"nominal"`, `"no maneuver"`,
  `"no burn"`, or `"passive tracking"`; a `MONITORING`/`SCANNING` narrative
  may not contain `"executing evasion"` or `"evasion burn"`. Separately, any
  standalone thruster-axis letter (`X`/`Y`/`Z`, optionally signed) appearing
  in the prose must match the axis of the validated `dodge_command`, so the
  narrative can't describe a burn on one axis while commanding another.

`review_negotiation_rationale(text, winner, loser, winner_dv, fallback_text=None)`:

- The text must name the winner.
- The loser's name must not appear within 40 characters of a selection verb
  (`selected`/`chosen`/`wins`/`won`/`picked`), so the rationale can't be
  misread as crediting the losing bid.
- Any `"N m/s"` figure cited in the text must be within 5% of the real
  `winner_dv`.

### Fail-closed behaviour

A failed review does not get patched or re-prompted — it is discarded.
`_llm_reflex_decision` returns `None` when `review.passed` is false
(`backend/api/reflex_playbook.py:272-279`), which causes `reflex_decision` to
fall through to `_fallback_decision(status, plays, review_reasons=...)`
(`backend/api/reflex_playbook.py:317-318`), and it is that deterministic
fallback text — not the rejected LLM text — that gets written into
`_DECISION_CACHE[status]`. A bad generation can therefore no longer poison a
threat band for the rest of the process.

`_fallback_decision` gained an optional `review_reasons` parameter
(`backend/api/reflex_playbook.py:190-191`) specifically so "the review
rejected this narrative" is distinguishable from "there was no API key" or
"the network call failed" — those are different failure modes and the UI
must not conflate them. `reflex_decision` now returns a 3-tuple
(`decision_log, dodge_command, content_review`) instead of a 2-tuple, and
`backend/api/reflex.py:511` threads `content_review` into the per-frame
response payload.

The negotiation path is symmetric: `review_negotiation_rationale` is given
`fallback_text=deterministic_rationale` (a plain
`f"{winner} selected: ΔV {winner_dv:.3f} m/s. Mission impact: LOW."`
string), and `review.reviewed_text` — the fallback when the review fails,
the LLM text when it passes — is what actually gets written into
`winning_proposal["rationale"]` (`backend/agents/nodes/operator_agent.py:139-143`).

### How it surfaces in the UI

- `frontend/src/components/ReflexPanel/ReflexPanel.tsx:809-843` renders a
  pill beside the "Onboard Decision Engine" header, in one of four states
  driven directly off `content_review`:
  - `content_review.passed` → green `Content Reviewed` (`:814-820`): the
    prose was generated and passed the review.
  - `content_review.used_fallback` with `reasons.length > 0` → amber `Safe
    Fallback` (`:822-830`), with the rejection reasons joined into a hover
    tooltip: the reviewer genuinely rejected a generated narrative.
  - `content_review.used_fallback` with `reasons.length === 0` → grey
    `Deterministic` (`:832-842`), tooltip stating explicitly "this is not a
    review rejection": no prose was generated at all (no `GROQ_API_KEY`, or
    the LLM call failed), so there was nothing to review.
  - `content_review` absent → nothing renders (`:811`) — the panel never
    invents a state for data it wasn't given.

  The three-way split exists because the backend sets `used_fallback=true`
  for two different reasons — a rejected review and no prose ever being
  generated — and collapsing both into one amber pill claimed a review had
  rejected something when, in the no-key/no-LLM case, nothing had been
  reviewed. That is the same category of defect as the hardcoded green
  `PIPELINE: READY` badge in Section 5: one state rendered as another. It
  also had a practical demo consequence: on a machine with no
  `GROQ_API_KEY` the pill sat amber permanently, so a forced rejection (see
  the demo fixture below) produced no visible colour change, only different
  tooltip text. With the grey `Deterministic` state split out, the baseline
  without a key is grey and a forced rejection still flips it to amber; with
  a key set the baseline is green and a forced rejection flips it to amber
  — a colour change either way, though the green-to-amber contrast is
  stronger.
- `frontend/src/components/HITLPanel/HITLPanel.tsx:233-236` renders an
  `AI RATIONALE` row using `proposal.rationale`, visually subordinate to the
  numeric bid fields, and only rendered when `proposal.rationale` is
  non-empty.
- `frontend/src/types/index.ts:54` adds `rationale?: string` to the shared
  proposal type.
- An `hitl_messages` entry is appended in `operator_agent.py` alongside the
  rationale write — `"[CONTENT-REVIEW] pass"` on success or
  `"[CONTENT-REVIEW] fallback used: <reasons>"` on failure
  (`backend/agents/nodes/operator_agent.py:166-169`) — which rides the
  existing EventFeed websocket pipe with no new plumbing.

Known limitation, recorded honestly rather than hidden: the shared `Tooltip`
component (`frontend/src/components/Tooltip.tsx`) takes a plain string and
collapses whitespace, so when a rejected narrative has more than one failure
reason they are joined with `"; "` and shown on one line rather than stacked
on separate lines in the tooltip.

### Demo fixture: forcing a genuine rejection, without contaminating the cache

`GET /api/reflex/frame/{idx}?force_bad_narrative=true` exists so a presenter
can trigger the amber pill on demand instead of relying on the LLM
occasionally misbehaving live. The obvious way to build this — run the bad
narrative through the normal `reflex_decision` path — would break the demo
after one click: `_DECISION_CACHE` (`backend/api/reflex_playbook.py`) caches
the assembled decision per threat band for the life of the process, and
`_FRAME_CACHE` (`backend/api/reflex.py`) caches the full per-frame response
per `(video, frame, mode)`. A forced-bad request that wrote through either
cache would leave its fallback sitting there, and every subsequent *normal*
request for that band/frame would then serve the same fallback — the
"SAFE FALLBACK" state would become permanent for the rest of the process,
not just for the one forced click.

Both caches are bypassed entirely when `force_bad_narrative=True` — no read,
no write, in either direction:

- `reflex_decision` skips `_DECISION_CACHE` and returns straight from
  `_demo_bad_decision` (`backend/api/reflex_playbook.py:366-373`).
- `_compute_frame` skips `_FRAME_CACHE` on both the read and the final write
  (`backend/api/reflex.py:508-510, 548-549`).

This was checked in both orderings, including a forced-first request on a
cold cache, to confirm the forced path never seeds either cache and a
following normal request still computes and caches a real result.

---

## 5. Hygiene: content that lied

Not the ethical-safeguards feature itself, but the same principle — user-facing
content should not assert something the system did not verify — applied to content
the UI was already displaying without backing. These changes are already applied
in the working tree.

| File | Before | After |
|---|---|---|
| `frontend/src/components/ReflexPanel/ReflexPanel.tsx` | `PIPELINE:` badge was a hardcoded green `READY` string, staying green even when every reflex endpoint returned HTTP 503 | Tri-state (`checking` / `ready` / `unavailable`), bound to real fetch state — see `totalFramesFetchState` / `frameFetchState`, lines 54 and surrounding, and the badge render at lines 611-621 |
| Same file | Closest-approach distance defaulted to `5.0` m, which renders green/SAFE — missing data displayed as safety | Renders an em dash in neutral gray styling when `distance === null` (lines 764-783) |
| Same file | 6DOF pose telemetry rendered `0.000` translations and an identity quaternion with no frame data — looked like real sensor output | Renders em dashes when there is no `frameData` (lines 718-753) |
| Same file | `totalFrames` defaulted to `100`, producing a fake `FRAME: 1 / 100` slider over a dead backend | Defaults to `0`; the frame counter shows `"- / -"` until a real total is fetched (lines 35, 546) |
| Same file | Threat-band legend hardcoded thresholds that `backend/api/reflex_playbook.py` also owned; the two copies had already silently drifted apart once (see `AUDIT.md`) | Single shared source: `frontend/src/constants/thresholds.ts`, which mirrors `backend/api/reflex_playbook.py:76-77` (`SAFE_RANGE_M = 2.2`, `WARNING_RANGE_M = 1.5`) and is imported into the legend at `ReflexPanel.tsx:17,377-379` |
| `backend/agents/nodes/maneuver_executor.py` | Log tag written as `[Executor]` in mixed case, while `frontend/src/components/EventFeed/EventFeed.tsx` matches badges case-sensitively (`'EXECUTOR':` keys at lines 12, 23, 31), so the line silently fell through to a generic SYSTEM badge | Uppercased to `[EXECUTOR]` throughout (`maneuver_executor.py:28,72-75`) |
| `backend/agents/nodes/hitl_node.py` | The `hitl_request` websocket event was emitted twice, duplicating the event and its log lines | Duplicate emission removed — the single `hitl_request` emission now lives at `backend/agents/nodes/operator_agent.py:158-159`; `hitl_node.py` itself keeps both of its defensive guards (line 17, `if state.get("hitl_decision")`, and line 22, `if not winning_proposal`) |

Frame this section honestly: none of these are the readiness-review feature. They
are the same principle — do not present unverified or missing state as if it were
a validated result — applied to UI content the app was already asserting without
backing.

---

## 6. What we deliberately did not build, and why

- **No LLM-as-judge or embedding moderation.** A second network call to review the
  first adds a new failure mode of its own, and contradicts the deterministic
  design of the reflex path documented in Section 2. Rule-based checks are also the
  only kind that can be explained line-by-line to a judge.
- **No PII/toxicity classifier.** The content under review is system narrative
  describing an already-deterministic decision, not user-submitted text — those
  categories of risk don't apply here.
- **No readiness checklist over the bid data.** Those fields are already
  structurally guaranteed by the assertions in `backend/orbital/conjunction.py`
  (Section 2); a checklist re-verifying them downstream would be decoration, not a
  safeguard.
- **No changes to the existing numeric guardrail or the deterministic threat
  classifier.** The review sits strictly downstream of both — it checks the prose
  generated about a decision, not the decision itself.

---

## 7. Verification

Commands, from `HANDOFF.md`:

```bash
# Backend tests
./.venv-audit/bin/python -m pytest test_*.py -q --asyncio-mode=auto
```

Note: `pytest` fails without `--asyncio-mode=auto` — the repo ships no pytest
config for asyncio mode, so `test_ws.py::test_flow` errors without the flag.

```bash
# Frontend, from frontend/
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
```

This machine has no `npm` and no `pip` on PATH; use the `.venv-audit/` virtualenv
and `frontend/node_modules/.bin/` binaries directly, as above.

The suite went from 8 passing to 33 passing:

```
33 passed in 0.50s
```

- `test_content_review.py` — 22 unit tests over the reviewer itself
  (completeness, consistency, denylists, axis agreement, fallback routing).
- `test_reflex.py` — two new integration tests alongside the four pre-existing
  ones. The primary regression guard,
  `test_reflex_bad_llm_narrative_is_not_cached_falls_back_to_deterministic`,
  asserts `_DECISION_CACHE["CRITICAL"]` holds the deterministic fallback, not
  the rejected LLM text, after a Verdict-less narrative is fed through
  `reflex_decision`.
- `test_negotiation.py` — one boundary test,
  `test_negotiation_rationale_crediting_loser_is_replaced_by_deterministic_fallback`,
  confirming a rationale that credits the losing bid is replaced by the
  deterministic fallback rather than shipped.

Notable finding: `test_negotiation.py` previously had no `test_`-prefixed
function — only a `main()` guarded by `if __name__ == "__main__":` — so
pytest collected zero tests from that file before this work. The negotiation
path contributed nothing to the old "8 passing" figure; it was, in effect,
untested. See `HANDOFF.md` for the same note carried into the open-work
record.

---

## 8. Demo script for judges

1. **Name the AI surface before a judge finds it.** State up front that the
   maneuver math — closest-approach, Pc, delta-V, winner selection — is
   deterministic: Clohessy-Wiltshire relative motion over SGP4 propagation,
   with fail-closed assertions (Section 2). The AI surface in this system is
   narrow and specific: the onboard reflex narrative and the one-line
   negotiation rationale. Those two pieces of LLM-authored prose are what
   this deliverable gates.
2. **Reflex tab, replay mode.** Point at the pill beside "Onboard Decision
   Engine" (`ReflexPanel.tsx:809-843`) — green `Content Reviewed` if
   `GROQ_API_KEY` is set and the narrative passed review, grey
   `Deterministic` if no key is set. Explain what a pass guarantees: the
   narrative on screen has a `Verdict:` line, has an `Executing Evasion`
   line if and only if the band is CRITICAL, has a burn command backing it
   if and only if one was needed, doesn't contradict its own threat band,
   and doesn't describe a different thruster axis than the one actually
   commanded.
3. **Show it block something.** Load the same frame with
   `?force_bad_narrative=true` appended, e.g.
   `GET /api/reflex/frame/{idx}?force_bad_narrative=true`
   (`backend/api/reflex.py:553-571`), and point at the amber `Safe Fallback`
   pill and its tooltip, which lists the rejection reasons. This is a real
   rejection, not a canned one: the flag runs a hardcoded malformed
   narrative (`_DEMO_BAD_NARRATIVE` / `_DEMO_BAD_DODGE_COMMAND`,
   `backend/api/reflex_playbook.py:34-45`) through the same
   `review_reflex_narrative` used on every real LLM response, and it fails
   for three genuine reasons: no `"Verdict:"` line, no `"Executing Evasion"`
   line for the CRITICAL band, and an axis mismatch between the narrative
   text and the validated command (`_demo_bad_decision`,
   `backend/api/reflex_playbook.py:247-260`). Say plainly that the flag is
   demo scaffolding — it defaults to `False` everywhere, no frontend code
   references it, and it carries no auth gate, consistent with the rest of
   this hackathon API.
4. **Inject a conjunction.** Trigger a negotiation, then show the
   `AI RATIONALE` row on the HITL panel (`HITLPanel.tsx:233-236`) and the
   matching `[CONTENT-REVIEW] pass` (or `fallback used: ...`) line in the
   event feed (`operator_agent.py:166-169`), making the point that the same
   review gate applies to both LLM surfaces in the system, not just the
   reflex path.
5. **Close on the design point, not the feature list.** The review has no
   model in the loop — it is regexes, length bounds, and a fixed vocabulary
   run against a deterministic contract computed elsewhere. It cannot be
   fooled by the thing it reviews, because there is nothing in it for
   adversarial text to negotiate with.
