# Developing games

## Integration points

| Area | Location |
| --- | --- |
| Pages, controls, rendering | `src/app/(games)/<game>/` |
| Registry and floor visibility | `src/features/arcade/components/arcade-game-registry.ts` |
| Floor catalog fixture | `docs/game-catalog.json` |
| Score/session endpoints | `src/app/api/games/<game>/` |
| Server replay and rules | `src/server/arcade/` |
| SQL migrations/schema | `src/server/db/migrations/`, `src/server/db/schema.ts` |
| Rewards and cosmetics | `src/server/arcade/rewards/` |
| Shared shell/UI | `src/features/arcade/components/` |
| Gameplay regressions | `scripts/verify-*.ts` |

Read a similar existing game first. New games start with a proposal and enter the
reserve catalog until reviewed.

## Rules and results

Keep the server authoritative. Validate input events, time bounds, ownership,
seeds, and replayed scores. Do not trust client scores or grant tickets from
browser code. Preserve rules versions when older scores become incomparable.

Persist stable player IDs. Leaderboards resolve current account usernames while
historical result snapshots remain intact.

Honor section/game availability, authentication, permissions, and rate limits.
Economy changes need maintainer review and isolated regressions.

## Presentation

Use shared shell, theme tokens, result UI, and controls. Check desktop and narrow
layouts, keyboard access, reduced motion, and all themes. Avoid global styles
that change other games. Document asset origin and licenses.

## Verification

Run typecheck, lint, build, and relevant `test:<game>` replay/invariant commands
from `package.json`. Registry changes also need `test:floor-registry`.
Integration tests require explicit disposable databases and synthetic accounts;
read each test's environment requirements before running it.

Explain gameplay changes and verification in the PR; include screenshots for
visible changes. Keep contributions focused for independent review.
