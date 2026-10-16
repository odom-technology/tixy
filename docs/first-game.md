# Build your first Tixy game

This walkthrough starts with Pattern Match, a complete playable example at
`/starter-match`, then shows how to copy it into a new reviewed contribution.
The example matches eight target shapes, awards 100 points per correct choice,
and saves a personal best on a game-specific leaderboard. It awards no tickets,
XP, or other economy rewards. No production services or private ops access are
required.

## 1. Start from a fresh public checkout

Install Node.js 24, npm, and Docker with Compose, or PostgreSQL 18. Fork
[odom-technology/tixy](https://github.com/odom-technology/tixy), then clone your
fork and branch from `dev`:

```sh
git clone https://github.com/YOUR-USERNAME/tixy.git
cd tixy
git switch dev
git switch -c game/your-game
npm ci
cp env/.env.example env/.env.local
npm run db:up
```

On PowerShell, replace `cp` with
`Copy-Item env/.env.example env/.env.local`. If using your own PostgreSQL instance,
create a local database and set `DATABASE_URL` in `env/.env.local` instead of
running `db:up`.

Run this command twice and set the two different outputs as `GAME_SESSION_SECRET`
and `CRON_SECRET` in `env/.env.local`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set `ARCADE_ADMIN_EMAILS` to the email you will use for a synthetic local account.
The example database URL already matches Compose. Keep ads, Stripe, and other
optional integrations unset. Local environment files are ignored by Git; never
submit their values.

```sh
npm run db:migrate
npm run dev
```

Open <http://localhost:3000>, register that local test account, and open
<http://localhost:3000/starter-match>. Select **Start matching**, choose the matching
shape, and select **Next round** until all eight rounds finish. A perfect run
saves 800 points and appears in the board below the game. Play a second run and
confirm the personal best stays on the board. The buttons work with Tab and
Enter/Space and show labels as well as shapes.

## 2. Follow one run through the code

| Step | Source | What to inspect |
| --- | --- | --- |
| Page and metadata | `src/app/(games)/starter-match/page.tsx` | Thin server page mounting the client game |
| Interface | `src/app/(games)/starter-match/_starter-match-client.tsx` | Shared `GameShell`, `GameStage`, `ArcadeButton`; request/round/result states and board |
| Local presentation | `src/app/(games)/starter-match/_starter-match.css` | Scoped styles and theme tokens |
| Rules | `src/features/arcade/lib/starter-match/engine.ts` | `RULES_VERSION`, `ROUNDS`, seeded `createPattern`, bounded `readChoices`, pure `replayPattern` |
| Start endpoint | `src/app/api/games/starter-match/session/route.ts` | Identity, bans, start rate limit, signed session |
| Submit endpoint | `src/app/api/games/starter-match/score/route.ts` | Authentication, bans, rate limit, payload parsing, service call |
| Public board | `src/app/api/games/starter-match/leaderboard/route.ts` | Uncached board response with current account names |
| Persistence | `src/server/arcade/starter-match.ts` | Seed derivation, ownership/expiry, replay, transaction, retry receipt, personal best |
| Tables | `src/server/db/migrations/0075_starter_match.sql`, `src/server/db/schema.ts` | Session rules configuration, run receipts, and per-rules best scores |
| Engine checks | `scripts/verify-starter-game.ts` | Deterministic fixtures, valid boundaries, rejected input |
| Database checks | `scripts/verify-starter-game-integration.ts` | Ownership, replay, retry/races, rollback, renamed accounts, expiry, gates, no rewards |
| Browser pilot | `scripts/verify-starter-game-browser.mjs` | Guest auth, keyboard/touch play, board recovery, committed-score retry, restart, reduced motion |

The HTTP interface is intentionally small:

| Request | Payload | Result |
| --- | --- | --- |
| `POST /api/games/starter-match/session` | `{}` | `sessionToken`, server-derived `seed`, `rulesVersion` |
| `POST /api/games/starter-match/score` | `{ sessionToken, rulesVersion, choices }` | Server-derived `score`, `ticketsAwarded: 0`, `leaderboard` |
| `GET /api/games/starter-match/leaderboard` | None | `{ leaderboard }`, best score per player for current rules |

`choices` must contain exactly eight integers from 0 through 3 in round order.
The server re-derives the pattern from the signed session; submitting a fabricated
`score` or `seed` cannot change it. `starter_match_sessions` stores the rules
version when the session starts; an old-rules run cannot claim the current rules
version at submission. Runs expire after 15 minutes. A transaction
consumes the session, stores a receipt, and updates the best score together. A
retry with identical choices returns the saved score; changed choices for that
run are rejected. This makes a retry after a lost network response safe.

Site, section, and game pauses block new sessions. Existing runs can finish after
a pause, following Tixy's availability policy. A game pause does not prevent
reading its board; site leaderboard-section controls still apply to HTTP reads.
Authentication, bans, and submit rate limits still apply to results.

This example validates a submitted transcript; it cannot prove a human chose the
shapes. The pattern is available to the browser, so a script can solve it. Keep
this game score-only. More valuable outcomes need a game-specific abuse model
and maintainer-approved reward design.

## 3. Copy the example into a proposed game

Open an issue with your rules, controls, scoring, replay approach, and asset
sources before substantial work. Pick a unique slug; this example uses
`shape-sort`. Copy the game-owned files, retaining the working starter:

```sh
cp -R 'src/app/(games)/starter-match' 'src/app/(games)/shape-sort'
cp -R src/features/arcade/lib/starter-match src/features/arcade/lib/shape-sort
cp -R src/app/api/games/starter-match src/app/api/games/shape-sort
cp src/server/arcade/starter-match.ts src/server/arcade/shape-sort.ts
cp scripts/verify-starter-game.ts scripts/verify-shape-sort.ts
```

Use PowerShell `Copy-Item -Recurse` for directory copies. Rename the copied client
and CSS files if appropriate, then update their local imports. Replace the
slug, `starter_match` table prefix, `StarterMatch` types, `Pattern` function names,
metadata, visible title, CSS prefix, and `/api/games/...` URLs **inside the copies**.
Use `rg 'starter-match|starter_match|StarterMatch|Pattern'` on your copied paths to
find references. Do not globally rename the original starter or shared helpers.

Implement rules in the pure engine first. Keep database access, secrets, time,
network calls, and browser APIs outside it. Pass explicit seeded state and
bounded actions into replay. Then update the UI to record those actions and the
server service to validate and replay them. Keep the server authoritative; do not
accept a browser score as the result. If your inputs need timestamps or physics,
define deterministic time steps and bounds rather than copying the shape game's
simple choice format unchanged.

## 4. Register and persist the new game

Make these explicit changes; copying a directory does not register it:

1. Append your slug to `GameType` in `src/server/arcade/game-session.ts` and to the
   authenticated score helper's game type in
   `src/app/api/games/_shared/score-helpers.ts`. Preserve owner/game checks and the
   availability mapping. Add explicit entries in both `SESSION_LIMITS` and
   `SCORE_COOLDOWN_MS` in `src/server/arcade/game-rate-limit.ts`; choose appropriate
   limits for your game's duration and request pattern. Use the same stable slug
   in rate limits and routes.
2. Append an entry to `src/features/arcade/components/arcade-game-registry.ts` with
   title, description, href, labels, icon, section, and
   `placement: { status: 'reserve', group: 'quick-play' }` for a casual solo game.
   Append your slug to `RESERVE_ORDER` in that file and a corresponding reserve entry
   in `docs/game-catalog.json` under `newGames`. `RESERVE_ON_FLOOR` is currently
   false, so use the direct URL while developing; reserve placement does not
   prevent direct access. Preserve existing identifier order: the floor registry
   check enforces stored-key compatibility.
3. Add a **new** numbered SQL migration under `src/server/db/migrations/`, following
   the starter's session-rules configuration, run-receipt, and
   per-player/per-rules best-score tables. Use your own table names and
   constraints, and update `src/server/db/schema.ts`. Do not edit an already-applied
   migration or reuse the starter's tables.
4. Update every copied SQL query to the new table names. Keep result persistence
   and session consumption atomic. Preserve idempotent retry behavior and stable
   account IDs. Filter the board by rules version and resolve current usernames.
5. Keep the board game-specific as the starter does. If adding it to global board
   selection, update `src/features/arcade/components/leaderboards/page-boards.ts`
   and any associated metadata. Adding a slug to
   `src/features/arcade/components/leaderboard-games.ts` requires matching
   server-side windowed-score support in `src/server/arcade/score-events.ts`;
   that does not happen automatically.
6. Add test commands to `package.json`, register deterministic checks in
   `scripts/run-game-invariants.mjs`, and wire integration/browser checks into
   `.github/workflows/ci.yml` with disposable data and no repository secrets.

Run `npm run db:migrate` after adding the migration. Keep the new game score-only
until maintainers explicitly approve tickets, XP, achievements, quests, or
leaderboard payouts. Those systems require separate mappings and economy tests.
See [integration points](contributing-games.md#integration-points) for their boundaries.

## 5. Verify a clean checkout

Verify the starter before changing its design, then run equivalent tests for your
new game. In the checkout with dependencies installed:

```sh
npm run typecheck
npm run lint
npm run test:starter-game
npm run test:floor-registry
npm run test:game-invariants:changed
npm run build
```

The starter integration suite requires its own explicitly named disposable
PostgreSQL database, separate from the app database. Never use production or a
database containing data you want to keep. With the local Compose instance,
create a database named `arcade_starter_game_test`:

```sh
docker compose -f compose.dev.yaml exec postgres createdb -U arcade arcade_starter_game_test
```

Then run the suite (POSIX shell):

```sh
STARTER_GAME_TEST_DATABASE_URL=postgres://arcade:arcade@localhost:5432/arcade_starter_game_test npm run test:starter-game-integration
```

On PowerShell, set `$env:STARTER_GAME_TEST_DATABASE_URL` to that URL, then run
`npm run test:starter-game-integration`. The suite requires the database name
`arcade_starter_game_test`, applies its required migrations internally, and does
not load local env files. It is allowed to change that disposable database.

For browser verification, install Chromium and run the local app in another
terminal. The suite creates its own synthetic account; point it at your disposable
local test instance, whose database it will change:

```sh
npx playwright install chromium
QA_BASE_URL=http://127.0.0.1:3000 npm run test:starter-game-browser
```

On PowerShell, set `$env:QA_BASE_URL = 'http://127.0.0.1:3000'` before running
`npm run test:starter-game-browser`.

Set `QA_SCREENSHOTS=1` to save browser evidence under
`output/playwright/starter-match-desktop.png` and `starter-match-mobile.png`.

On Linux, Playwright may require `npx playwright install --with-deps chromium`.
Also manually play with the keyboard, a narrow viewport, reduced motion, and the
supported themes. Check loading, signed-out, restart, and save-retry states.

Finally, commit your contribution on your local feature branch and clone that
branch into another directory. This catches missing tracked files and accidental
dependence on existing local configuration:

```sh
git clone --no-local --branch game/your-game /absolute/path/to/your/tixy ../tixy-clean-check
cd ../tixy-clean-check
npm ci
cp env/.env.example env/.env.local
```

Generate new secrets and configure an empty local database. For Compose, the
existing service can host another database created with `createdb`; set the new
checkout's `DATABASE_URL` to it. Run migrations and the checks above, start the
app, register a synthetic account, and complete a browser run. Do not copy
`node_modules`, `.next`, `env/.env.local`, or database contents from your working
checkout. Record the commands and results in your PR.

## 6. Submit for review

Open a PR to `dev` with the proposal, controls/scoring, rules version and replay
limits, test results, screenshots or a recording, and asset licenses. Complete the
[game review checklist](game-review-checklist.md). Maintainers review and release
approved source through private ops; you do not need deployment access.
