# Prompt for the next agent

Copy everything inside the fence below and paste it as your first message.

---

```
You are continuing work on SpaceATC, a satellite collision-avoidance hackathon
project at /home/parv/spaceatc. A full readiness audit was completed in a prior
session and 18 fixes were already applied and committed at HEAD (15f35d9).

READ THESE FIRST, IN THIS ORDER, BEFORE TOUCHING ANY CODE:
  1. SUMMARY.md   - what was done and why, in one page
  2. HANDOFF.md   - environment gotchas, run commands, full change log, open work
  3. AUDIT.md     - the complete prioritized findings report

Do not re-audit what those files already cover. They are accurate as of 22 Aug 2026
and every claim in them was verified against running code. Trust them as a starting
point, but verify before you act on any specific line, since the tree may have moved.

ENVIRONMENT - this will waste your time if you skip it:
- There is NO npm and NO pip on PATH. Use `bun` for frontend deps and `uv` for
  Python deps. Run JS binaries via ./node_modules/.bin/<tool>, not npx.
- A ready virtualenv exists at .venv-audit/ and frontend/node_modules/ is populated.
  Verify both before rebuilding anything.
- `pytest test_*.py` FAILS without --asyncio-mode=auto. The repo ships no pytest config.
- Never run bare `lsof -ti:PORT | xargs kill`. It returns connected clients as well as
  the listener and will kill browser processes. Always add -sTCP:LISTEN.

VERIFY GREEN BEFORE AND AFTER ANY CHANGE:
  ./.venv-audit/bin/python -m pytest test_*.py -q --asyncio-mode=auto   # expect 8/8
  cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build

test_orbital.py guards a subtle GMST unit fix. If it fails, the propagator regressed -
do not "fix" the test.

YOUR TASK, in priority order (full detail in HANDOFF.md section 6):

  1. BLOCKS THE DEMO: The three OrbitMind assets are unresolved Git LFS pointers
     (133/132/133 bytes) and git-lfs is not installed, so every reflex endpoint
     returns 503. Worse, the UI masks this behind a fake 1/100 frame slider and a
     hardcoded green "PIPELINE: READY" badge. Resolve the assets, and make that
     badge and the frame count reflect real fetch state so a dead pipeline can
     never again present as a healthy one.

  2. Make the `generate_bids -> await_hitl` edge in backend/agents/graph.py
     conditional on `winning_proposal`, and emit a system_status error on the
     failure branches. Today a failed bid parks the graph at the interrupt with no
     hitl_request emitted while /api/demo/inject still returns HTTP 200, leaving the
     UI stuck on "negotiating" forever with no error. This is a silent demo-killer.

  3. Harden the HITL endpoints in backend/api/routes.py: validate that event_id
     exists (404 if not), reject a decision unless the conjunction is actually
     pending (409), delete the `or latest_session_id` fallback, and add a
     compare-and-set on status so duplicate or stale decisions cannot flip a
     resolved row. Right now POST /api/hitl/does-not-exist/approve executes the real
     pending maneuver for a completely different event.

  Items 4-7 in HANDOFF.md (maneuver not re-propagated, screening checks zero pairs,
  stale TLE cache, coarse-argmin TCA aliasing) are real and ranked - pick them up
  only after 1-3 are done, and confirm scope with me first, because several change
  demo behavior.

CONSTRAINTS:
- Do NOT commit or push. Leave changes in the working tree for review.
- Do NOT touch the items listed in HANDOFF.md section 7 ("rehearse, don't fix").
  Those are deliberate, defensible simplifications; changing them mid-demo-prep adds
  risk without adding credibility.
- Do not weaken or delete existing tests to make something pass.
- If you disagree with a prior finding, say so with evidence rather than silently
  reverting it.

Start by reading the three docs and confirming the test suite and build are green,
then report what you found before making changes.
```

---

## If you want a narrower scope

Replace the "YOUR TASK" block with just one item. The three docs plus the
ENVIRONMENT and VERIFY sections are the parts worth keeping in every variant —
they are what stop a fresh agent from burning its first hour rediscovering that
`npm` doesn't exist and that `pytest` needs a flag.
