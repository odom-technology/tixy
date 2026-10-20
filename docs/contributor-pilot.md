# Lights Out contributor pilot

This is a maintainer-authorized, assisted local pilot of the
[public first-game tutorial](first-game.md). It adapts Pattern Match into a
different game on `dev`. It does not represent an independent developer's
onboarding, an external proposal/PR, or a production release.

## Proposal and scope

| Item | Decision |
| --- | --- |
| Title and direct route | Lights Out, `/lights-out` |
| Rules | On a 3×3 board, selecting a cell toggles it and its orthogonal neighbors. Turn every light off within 24 moves. |
| Controls | Labeled buttons support pointer/touch, Tab, and Enter/Space. On/off labels supplement visual feedback. |
| Scoring | A solved run scores `1000 - 25 × (moves - 1)`; exhausting 24 moves without solving scores 0. |
| Replay | The server derives a solvable, nonempty starting board from its signed session seed and replays a bounded list of cell indices 0–8. |
| Completion | Submit only when solved or after 24 moves; actions after solving are invalid. |
| Rewards | Score-only personal-best board. No tickets, XP, quests, achievements, paid entry, or leaderboard payouts. |
| Placement | Reserve catalog; use the direct URL during development. |
| Assets | HTML/CSS board and existing project UI/icons; no new external assets, fonts, or dependencies. |

The board is visible to the browser and can be solved by a script. Server replay
validates the submitted puzzle outcome; it does not establish that a human played.
This pilot therefore retains the starter's score-only boundary.

## Applying the tutorial

The game follows the starter's page/client/styles, pure engine, three API routes,
server service, and three persistence tables. Shared registration adds the slug
to the session and score types, rate limits, reserve registry, and catalog.
Migration `0076_lights_out.sql` creates game-specific session configuration,
submission receipts, and per-player/per-rules best scores.

The adaptation changes the action log from eight fixed choices to a terminal
move sequence of at most 24 cells. Replay rejects incomplete logs and actions
after a solved state. The service derives scores, checks ownership/rules/expiry,
and atomically consumes the session with result persistence. Matching retries
recover the saved receipt; a changed transcript cannot replace that result.
Game-specific score and move fields are returned to the UI.

Three suites accompany the game:

| Check | Command and setup |
| --- | --- |
| Pure engine | `npm run test:lights-out` |
| Disposable database | `LIGHTS_OUT_TEST_DATABASE_URL=postgres://arcade:arcade@localhost:5432/arcade_lights_out_test npm run test:lights-out-integration` |
| Local browser | `QA_BASE_URL=http://127.0.0.1:3000 npm run test:lights-out-browser` |

Create `arcade_lights_out_test` in your disposable PostgreSQL instance first.
The integration script requires that exact database name and does not load local
env files. The browser script requires an explicit loopback origin, creates
synthetic account data, and uses the app's separately configured local database.
See the tutorial for Node 24, PostgreSQL 18, Chromium, and PowerShell setup.

Engine checks are registered in changed-game selection. Integration and browser
checks run locally for `dev` and are wired into the existing main workflow jobs.
**Actions remains limited to pushes to `main`; this pilot adds no `dev` or
pull-request trigger.**

## Gaps found and repaired

| Gap | Repair |
| --- | --- |
| Copy instructions included only the engine test. | Copy all three suites and explain adapting integration migrations/database guards and browser selectors. |
| Fixed round/score assumptions were easy to carry into another game. | Explain terminal-state validation, game-specific response fields, score constraints, and new fixtures. |
| Test commands alone did not select a new game's invariants. | Explain explicit runner registration and separate main-job integration/browser wiring. |
| CI wiring could be mistaken for enabling contribution runs. | Explicitly preserve main-only triggers in the tutorial and review checklist. |
| A local pilot appeared to require an external issue. | Allow the maintainer's local proposal here while retaining issues for external contributions. |
| Clean-clone guidance assumed all source was committed. | Require the base commit and explicit transfer method for uncommitted snapshot verification. |
| The registry check's historical default ref can be absent in a normal clone, silently skipping compatibility comparison. | Require an explicit pre-contribution `dev` baseline and `FLOOR_REGISTRY_REQUIRE_BASE=1`, with PowerShell setup. Explain the invariant runner's safe all-suite fallback when local `main` is absent. |
| Browser evidence could be staged accidentally. | Ignore generated Playwright output and tell contributors to inspect staging. |
| A failed session-rules insert could leave an unusable signed starter session. | Clean up the owned session when configuration persistence fails in [Lights Out](../src/server/arcade/lights-out.ts) and [the starter](../src/server/arcade/starter-match.ts); add failure coverage in both integration suites. |

## Clean-clone verification

A separate checkout was cloned over public HTTPS from
`https://github.com/odom-technology/tixy.git`, branch `dev`, at
`6b3faea6f67a859a4952cb97287bd2185cbdc294`. A temporary Git index captured the
intended tracked changes and new source files into a binary patch, which was
applied to that clone. Later corrections were synchronized into the same clean
checkout. This verified the uncommitted source snapshot against that public
baseline. At verification time, the remote branch did not yet contain the pilot.

The clone installed its own dependencies with Node **24.22.0**. A task-owned
`postgres:18-alpine` container supplied a fresh `arcade` app database and separate
`arcade_lights_out_test` and `arcade_starter_game_test` databases. New throwaway
secrets and synthetic accounts were used. No working-copy environment files,
`node_modules`, `.next`, or database contents were transferred.

| Verification | Result |
| --- | --- |
| `npm ci`, all database migrations | Passed against fresh dependencies and databases. |
| `npm run typecheck`, `npm run lint`, `npm run build` | Passed, including the final production rebuild after the session-cleanup fix. |
| `FLOOR_REGISTRY_BASE_REF=6b3faea FLOOR_REGISTRY_REQUIRE_BASE=1 npm run test:floor-registry` | All 14 checks passed against the pre-contribution baseline. |
| `npm run test:themes` | All 6 themes passed. |
| `npm run test:game-invariants` | All 42 suites passed. |
| `test:lights-out-integration`, `test:starter-game-integration` | Both suites passed on isolated databases, including session-configuration failure cleanup. |
| `test:lights-out-browser`, `test:starter-game-browser` | Both passed against `npm run dev` and the production `npm run start` server. |
| Workflow configuration | Parsed YAML confirms only `push.branches: [main]`, no other triggers, and read-only repository contents permission. No GitHub Actions jobs were run. |

Lights Out browser checks solve the visible board with an independent
breadth-first solver and exercise keyboard play, 320px touch layout, reduced
motion, forged/incomplete logs, a 24-move loss, lost-response recovery, restart,
and leaderboard failure/recovery. Screenshots were visually inspected; raw local
evidence is ignored under `qa-evidence/lights-out-pilot/`.

Verification used an uncommitted source snapshot; the test run did not push code
or release production. This assisted pilot does not establish independent
onboarding or a live release.
Next, have an outside developer follow the guide without assistance, then review
and release the contribution through private ops.
