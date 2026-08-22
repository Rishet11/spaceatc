# SpaceATC Readiness Audit

**Pre-judging audit — 21 Aug 2026**

Five parallel deep audits across the frontend, orbital math, LangGraph orchestration and the vision reflex, put through an adversarial critique pass. Every claim below was re-verified against running code before it was written down.

`5 PARALLEL AUDITS` · `ADVERSARIAL CRITIQUE PASS` · `LIVE BACKEND — 212 REAL TLEs` · `HEADLESS UI CAPTURE` · `8/8 TESTS GREEN`

| | |
|---:|:---|
| **17** | Fixed & verified |
| **6** | Open — will cost points |
| **5** | Rehearse an answer |
| **1** | Blocks the demo today |

---

## ⚠ The single most important thing in this report

**Blocks demo.** The three OrbitMind model and video assets are unresolved Git LFS pointers on this machine — `best (1).pt` is 133 bytes, `keypoint_mobilenet.pth` 132 bytes, `output_h264.mp4` 133 bytes — and `git-lfs` is not installed. Every reflex endpoint returns 503.

**Action:** run `git lfs pull` and confirm the three file sizes before judging. **Still open** — as of this annotation the three assets on disk are still 132/133 bytes (`OrbitMind/keypoint_mobilenet.pth`, `OrbitMind/output_h264.mp4`); `git lfs pull` has not yet been run on this machine.

**Round 2 partial fix — the panel no longer masks a dead pipeline.** The original finding here was two things: (1) the reflex assets are missing, and (2) the UI hid that fact behind a fake `1 / 100` frame slider and a hardcoded green `PIPELINE: READY` badge. (2) is now fixed: `frontend/src/components/ReflexPanel/ReflexPanel.tsx` binds the pipeline badge to tri-state real fetch status (`checking` / `ready` / `unavailable`), `totalFrames` no longer defaults to `100` (it shows `- / -` until a real total is fetched), the closest-approach distance no longer defaults to `5.0` m (which rendered green/SAFE for missing data — it now renders an em dash), and the 6DOF pose block no longer renders `0.000` translations and an identity quaternion with no sensor data behind them. (1), the underlying LFS blocker, is unchanged and still needs `git lfs pull` before a live reflex demo.

---

## Rank 01 · Correctness — the Earth was rotating 15× too slowly

The highest-value find in the audit, and a one-line fix. It silently corrupted every satellite position on the globe while leaving them plausible enough to survive eyeballing.

### GMST unit slip in the TEME→ECEF rotation — **FIXED**

`backend/orbital/propagator.py` — the Vallado polynomial returns Greenwich Mean Sidereal Time in *seconds of time*, but the code divided by 3600 as though it were arcseconds. The correct divisor is 240 (86,400 s ↔ 360°), so every computed angle was exactly 1/15 of the true one.

Latitude and altitude were unaffected, which is precisely why nobody caught it: the satellites sat at believable latitudes and altitudes, just at the wrong longitudes, with ground tracks that barely precessed. A judge who knows LEO tracks shift about 22.5° west per orbit would see it within seconds.

```
verified against the textbook J2000 value:
  before  18.6974°     after  280.4606°     textbook  280.46061837°
  node-to-node drift:  before -1.94°/orbit  after ~-22°/orbit

locked in by 3 new regression tests in test_orbital.py
(the repo previously had zero coverage of the orbital math)
```

---

## Rank 02 · The six frontend issues — what was actually wrong, and what shipped

All six investigated at code level and fixed. Two turned out to be different problems than they appeared from the outside — worth knowing before you present them.

### 2 · The conjunction indicator never changed — it was unreachable code — **FIXED**

Not a re-render bug, and not a design problem. `StageTracker` derived its stage from `ConjunctionEvent.status`, but the backend only ever writes four status values — `detected`, `pending_execution`, `vetoed`, `resolved`. It never writes `negotiating`, so the NEGOTIATE step was dead code that could not light up under any circumstances. The tracker also silently fell back to idle four seconds after a veto, so the demo ended on a blank slate.

There is also **no click-to-select interaction anywhere in the app** — no handler on any satellite, marker or conjunction. Selecting a conjunction was never built, so this was a missing feature rather than a broken one.

```
now driven synchronously from the WebSocket stream via an explicit
pipelineStage, and the terminal stage is sticky

the active step is a filled pill with a pulsing ring instead of an
8px dot — legible across a room
```

### 4 · Accept dumped 25 rows of binary-search internals — **FIXED**

The approve action rendered the backend's raw `computation_trace` — 32 entries, 25 of them literal `Binary search [n]` rows — in a full-screen modal that covered the globe at the exact moment the satellite maneuvers. Worse, the three payoff rows were keyed on a colliding index and were being dropped by React outright.

Replaced with a result card built entirely from fields that already existed in the payload and were being thrown away. The derivation is still one click behind a disclosure, so the "we really computed this" evidence survives.

```
duplicate React keys confirmed by executing the trace builder:
  t sequence = [0,1,2,3, 4..28, 15,16,17]   duplicates = [15, 16, 17]
  = CONVERGED, Post-maneuver Pc, Post-maneuver miss — exactly the payoff rows

now reads:  MISS DISTANCE   0.120 km → 3.391 km  (28.2x more separation)
            COLLISION PROB  1 in 3,206 → 1 in 1,000,000
            FUEL COST       0.245 m/s retrograde
```

### 5 · The debris dodge animation was mathematically unreachable — **FIXED**

The strongest single find on the reflex side. The satellite's position on the schematic was tied to progress through the video clip (`satX = 50 + t * 900`), while the evasion offset required `satX <= 750`. But the swept range only crosses into CRITICAL at `t > 0.795`, which puts `satX` at 766 or above. **The offset branch could never execute.** The satellite glided flat along the centerline while a hard-swapped S-curve appeared entirely behind it, and the debris marker was already past and separating. Nothing visibly avoided anything.

All geometry is now derived from the measured range, so the marker rides the path it is drawn on, and the maneuver happens exactly when the deterministic safety check fires. The return leg is driven by the real `post_evade_action` field, which the backend was already emitting and nothing was reading.

```
separation now bottoms out at the CRITICAL threshold, then visibly diverges:
  range 1.50 m → sep  40px  (closest, evasion begins, zero offset — smooth start)
  range 1.00 m → sep  85px
  range 0.60 m → sep 144px
```

### 1 and 3 · Trajectory legibility and before/after confirmation — **FIXED**

Trails were capped at 40 points — about 5° of a 360° orbit — and their vertex colors faded toward black under additive blending, where black contributes exactly zero, so the older half of every trail rendered as literally invisible. The conjunction pair was a 2px dot among 200 others.

For before/after: the maneuver was *deleting* the maneuvering satellite's trail at the precise moment it became interesting. It now freezes that track and renders it as a dashed red "path not taken" beside the new one.

```
trail cap 40 → 400 · fade to 25% brightness instead of black · line width 1.5 → 3
conjunction pair scaled 2x → 4.5x and the background constellation desaturated
```

### 6 · Clutter that made real data look canned — **FIXED**

The most damaging item was in `OutcomeOverlay`: a helper that **hashed the two satellite names** to synthesize a debris mass, with a code comment stating it was varied so it would "read as a computed estimate, not a fixed prop number." That is fabricating precision. Removed in favour of one stated assumption, labelled as an assumption.

```
Total ΔV divided an m/s value by 1000 again — the headline metric was pinned
  at 0.000 m/s forever; now reads 0.245 m/s
"IMPACT: LOW" (no backing field at all) → real miss distance 0.120 → 3.391 km
"TIMING: 60 min before TCA" (hardcoded) → real burn_time 00:03:32 UTC
fabricated Pc fallback of 0.01 removed
risk bars moved to a log scale so the drop is visible
"paths exaggerated for clarity" → "SGP4-propagated from live TLEs"
"1.0 km · COLLISION COURSE" showed current separation → now miss distance at TCA
reflex legend claimed SAFE (>1.5 m); the code's own threshold is 2.2 m — corrected
"+50m CORRIDOR BIAS" was SVG pixels presented as metres, next to a real
  12 cm/s command — removed
```

### Bonus: two bugs found only by running the app — **FIXED**

Driving the real UI in a headless browser surfaced a second duplicate-key collision that no amount of reading would have caught: the event feed keyed rows on `timestamp::type`, and the backend emits several negotiation events inside the same millisecond, so React was dropping log lines. The feed's auto-scroll was also permanently dead once 50 entries accumulated, because its effect depended on a length that stops changing at the cap.

```
console errors across a full inject → approve run:  before 27   after 1
(the remaining one is a benign headless socket warning)
```

---

## Rank 03 · Still open — backend gaps a judge could use against you

Not fixed in this pass. Ordered by how likely a judge is to hit them. The first two are demo-killers rather than debating points.

### A failed bid strands the pipeline forever while the API reports success — **OPEN**

`generate_bids → await_hitl` is an unconditional edge, and the graph interrupts before `await_hitl` regardless of whether a winning proposal exists. Any failure inside `generate_operator_bid` returns no proposal, the graph parks at the interrupt having emitted no `hitl_request`, and `/api/demo/inject` still returns HTTP 200. The UI sits on "negotiating" with no panel and no error, and the thread can never be resumed.

**Fix:** make that edge conditional on `winning_proposal` and emit a `system_status` error on the failure branches.

### The HITL gate is sound in the graph, and wide open over HTTP — **OPEN**

Credit first, because this is worth saying on stage: there is exactly one edge into `execute_maneuver`, it is guarded twice, and it fails *closed* on every error condition tested. **The LLM decides nothing safety-critical.**

**Round 2 update:** the clause originally here read "the Groq rationale is computed and then never read" — that was a real dead-code defect at the time and is no longer accurate. `backend/agents/nodes/operator_agent.py` now runs the rationale through `review_negotiation_rationale` (`backend/content_review.py`) and writes the result into `winning_proposal["rationale"]`, which reaches the frontend via `ManeuverProposalResponse.rationale` and renders as the `AI RATIONALE` row in `HITLPanel.tsx`. The rationale is still non-safety-critical prose, not a decision input, so the sentence's substance ("the LLM decides nothing safety-critical") still holds — only "never read" is now false. See `ROUND2.md` §4.

But the endpoints validate nothing. `update_conjunction_status` issues a bare UPDATE that affects zero rows for an unknown id and raises nothing, then falls back to the most recent session — so `POST /api/hitl/does-not-exist/approve` executes the real pending maneuver for a different event. There is no auth and `allow_origins="*"`, and no compare-and-set, so duplicate or stale decisions are accepted unconditionally.

### An "executed" maneuver never touches the orbital state — **OPEN**

The burn writes a cosmetic longitude nudge into the cache — the `Satrec` is never re-initialised and nothing is re-propagated. After the maneuver the physics state is byte-identical to before it, so re-running screening re-detects the same conjunction at the same miss distance, and the paths endpoint still returns the pre-maneuver track while the UI says RESOLVED. The nudge is also numerically invisible: about 2.4e-4 degrees over its 60-second life.

### On real CelesTrak data, the screening loop checks zero pairs — **OPEN**

Every ingested satellite is Starlink, so `_assign_operator` labels them all "SpaceX", and the detector skips any pair sharing an operator. All 4,950 pairs are skipped. With a demo injection it is subtler but worse: the flat 20-pair budget breaks both loops before index 1, so **only satellite index 0 is ever screened**. Performance is not the reason to keep the cap — a full 3-day TCA search measured at 0.02 s per pair.

### The bundled TLE cache is 60 days stale — **OPEN**

Every TLE in `starlink_cache.tle` has an epoch around 22 June 2026. Nothing inspects epoch age, so nothing warns. This is the path the demo actually uses whenever CelesTrak is unreachable — which happened live during this audit, while `/health` still reported `"live"` from startup.

```
propagating all 200 cached satellites to today:
  7 SGP4 error codes, 5 physically impossible altitudes
  worst observed: 10,423 km and 63 km — both rendered on the globe
  as normal satellites
```

### Coarse TCA scan can alias a real close approach into a benign one — **OPEN**

The local refinement is correct, but `np.argmin` is taken over the whole 3-day window *before* any refinement. At a measured 15.2 km/s relative velocity the satellites move 915 km between 60-second samples, so a true 0.5 km miss can register as 456 km and lose to a genuinely benign 300 km encounter elsewhere in the window. This is the textbook conjunction-screening pitfall and the most likely thing an astrodynamics judge probes.

**Fix:** bracket every sign change in relative range-rate and refine each.

---

## Rank 04 · Don't fix, rehearse — answers to have ready

These are defensible as hackathon simplifications, but only if you say them first. Being caught on one is much worse than volunteering it.

### "Is that really RAG?"

No — and reframing beats defending. The corpus is a four-element Python list and retrieval is numeric interval matching; there is no embedding model or vector store, and the `Search Query:` line printed to the console is display-only and feeds nothing.

The strong answer: *a deterministic table lookup is the architecturally correct choice for a safety reflex — you do not want nearest-neighbour fuzziness deciding whether to fire a thruster.* Rename the log line and the panel subtitle to match that claim.

### "Does the LLM decide to fire the thruster?"

No, and you can cite the line: `need_cmd = status == "CRITICAL"`, where status comes from the deterministic classifier. Intent is hardcoded, the axis is whitelisted, and delta-v is clamped to [1, 50] cm/s.

One gap to close first: `duration_ms` is int-coerced but never clamped, so a hallucinated value renders verbatim on the card labelled "guardrail validated."

### "How do you know the burn actually helps?"

The honest answer today: the model computes `new_miss = sqrt(orig^2 + shift^2)`, which assumes the shift is orthogonal to the miss vector and therefore *cannot represent a harmful burn*. The docstring's claim that this is conservative is wrong — an anti-parallel shift would shrink the miss. It also makes `burn_direction` cosmetic, since prograde and retrograde produce byte-identical predictions.

### "What's your Pc formula?" and "what's your relative velocity?"

Pc is an ad-hoc Gaussian, not Foster 2D: the coefficient is 2π larger than the standard form, and it feeds a 3-D separation into a 2-D conjunction-plane integral. With sigma fixed at 1 km it is **capped at 3.14e-4**, so a direct hit reports "1 in 3,183".

Separately, the demo pair is co-orbital formation flying at about 0.1 m/s relative velocity, where a judge expects 10–15 km/s, and `/api/demo/inject` returns a hardcoded `expected_tca_seconds: 120` while the real TCA lands about three days out.

### Two contract mismatches worth knowing

Verified against the live API: `GET /api/conjunctions` omits `operator_primary`, `operator_secondary` and `tca_iso`, all three of which the response schema declares — the route is not serializing through its own model. The frontend types have been corrected to match reality.

Also, the Earth texture loads from `raw.githubusercontent.com` at runtime, so on venue wifi the globe renders as a white sphere. Vendor it into `public/`.

---

## Rank 05 · Before you present

1. **Run `git lfs pull`** and verify the three OrbitMind assets are megabytes, not 133 bytes. Nothing in the reflex demo works otherwise.
2. **Regenerate `starlink_cache.tle`** so the offline path is not 60 days stale, and stop rendering the five impossible-altitude objects.
3. **Make the `generate_bids → await_hitl` edge conditional** so a failed bid cannot silently strand the run mid-demo.
4. **Validate `event_id` on both HITL routes** and delete the latest-session fallback.
5. **Vendor the Earth texture** so the globe cannot depend on GitHub being reachable from the venue.
6. **Drive the demo at 60x or 300x** using the speed selector — at the 1x default the constellation is effectively a still image, which is the honest remainder of the "trajectories don't read" problem.
7. **Say the deterministic-lookup line first**, before anyone asks whether the playbook is really RAG.

---

*17 fixes applied across 14 files · 1 new test file · 8/8 tests green · clean typecheck and production build · no commits made.*

*Every finding re-verified against running code. Claims that did not survive verification were dropped rather than reported.*
