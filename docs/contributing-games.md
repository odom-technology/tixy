# Developing games

Tixy accepts reviewed source contributions. Fork the public repository, branch
from `dev`, and submit a PR to `dev`. Maintainers review code and release through
the separate private ops repository. There is no game upload service or third-party
runtime: contributed code runs as part of Tixy and must meet the same trust rules.

Start with the [first-game tutorial](first-game.md) and use the
[review checklist](game-review-checklist.md) before submission. New games start
with an issue describing controls, scoring, replay validation, and assets. Keep
them in the reserve catalog until maintainers approve floor placement. Reserve is
a discovery setting: its routes remain accessible and it provides no isolation.

## Supported starting point

Pattern Match at `/starter-match` is a complete single-player, score-only example.
It includes browser UI, a deterministic engine, signed sessions, server replay,
database persistence, a game leaderboard, and regressions. Copy its structure for
a short game with bounded inputs. Multiplayer, wagers, paid entries, and rewards
need additional design and maintainer review.

| Game supplies | Tixy supplies through shared helpers |
| --- | --- |
| Stable slug, title, description, controls, and reserve placement | Floor registry, shared shell, themes, account UI |
| Deterministic rules, rules version, bounded input log, replay-derived score | Authentication, game bans, availability, rate-limit helpers, signed sessions |
| Game-specific session/score/leaderboard handlers and persistence | PostgreSQL client, transactions, account identity and leaderboard components |
| Loading, failure, retry, keyboard, and touch behavior | Shared UI and presentation primitives |
| Meaningful engine, route/database, and browser checks | CI installation, disposable database, build, and test execution |

These helpers do not register a new game automatically. Each new route must call
the appropriate gates; the tutorial lists the explicit mappings to update.

## Integration points

| Area | Location |
| --- | --- |
| Pages, controls, rendering, metadata | `src/app/(games)/<game>/` |
| Deterministic browser/server engine | `src/features/arcade/lib/<game>/` |
| Registry, floor visibility, navigation labels | `src/features/arcade/components/arcade-game-registry.ts` |
| Floor catalog fixture | `docs/game-catalog.json` |
| Session/score/leaderboard endpoints | `src/app/api/games/<game>/` |
| Server replay and persistence | `src/server/arcade/<game>.ts` |
| Signed session game type and availability mapping | `src/server/arcade/game-session.ts` |
| Shared authenticated score-route game type | `src/app/api/games/_shared/score-helpers.ts` |
| Explicit session and score limits | `SESSION_LIMITS`, `SCORE_COOLDOWN_MS` in `src/server/arcade/game-rate-limit.ts` |
| SQL migrations/schema | `src/server/db/migrations/`, `src/server/db/schema.ts` |
| Shared shell/UI | `src/features/arcade/components/` |
| Global leaderboard presentation, when applicable | `src/features/arcade/components/leaderboards/page-boards.ts` |
| Windowed boards, when approved | `src/features/arcade/components/leaderboard-games.ts`, `src/server/arcade/score-events.ts` |
| Tests and changed-game suite selection | `scripts/verify-*.ts`, `scripts/run-game-invariants.mjs`, `package.json` |

## Rules, results, and identity

The server chooses the run seed and rules version and binds them to an owned,
expiring session. Accept a bounded event log and derive the result by replay;
never trust a submitted total. Validate input types, ordering, timing, and run
completion. A signed session alone does not validate gameplay or stop replayed
submissions. Consume the run and insert its result in one transaction, so retries
and concurrent requests cannot create duplicate results.

Keep incompatible rules versions separate. Persist stable player IDs and resolve
current usernames for public leaderboards. Do not expose emails or trust names
provided by the browser. Honor site/section/game availability, authentication,
game bans, and rate limits on every applicable endpoint. The starter blocks new
sessions during a pause and allows existing runs to finish. A game pause does not
prevent board reads; site leaderboard-section controls still apply to HTTP reads.

The starter awards no tickets, XP, achievements, quests, or season rewards.
Maintainers must approve and wire those integrations separately, with isolated
economy regressions. The standalone score board does not imply enrollment in
weekly/monthly rewards or account progression.

## Presentation and verification

Use shared shell, theme tokens, and leaderboard components. Check desktop and
narrow layouts, keyboard and touch access, reduced motion, and all supported
themes. Avoid global styles that change other games. Document asset origin and
licenses, including dependency notices.

Run typecheck, lint, build, the changed-game invariant checks, and the new game's
engine, integration, and browser checks. Registry changes also need
`test:floor-registry`. Integration tests require explicitly named disposable
databases and synthetic accounts; read their setup requirements before running.
Provide exact commands, outcomes, and screenshots or a recording in the PR.
