# Game review checklist

Contributors complete this before a PR to `dev`; maintainers use it during review.
Link the proposal and record test commands/results in the PR. Mark genuinely
inapplicable items with an explanation.

## Gameplay and integration

- [ ] Controls, scoring, run length, failure, and completion are explained in game.
- [ ] A fresh local account can start, finish, save, see the result on the board,
      and start another run without production credentials or ops access.
- [ ] Slug, routes, metadata, registry, catalog, game types, and database names
      agree. The new game starts in reserve; floor promotion has maintainer review.
- [ ] Rules version is stored and incompatible versions cannot share a board.
- [ ] Loading, signed-out, unavailable, expired-session, and failed-submit states
      give a useful next action. Duplicate requests cannot save twice.

## Server authority and data

- [ ] Session and score routes enforce authentication, bans, and rate limits.
      Availability blocks new runs without stranding in-flight results;
      public reads follow the appropriate availability policy.
- [ ] Server binds owner, game, seed, start/expiry, and rules to the run. Cross-user,
      cross-game, forged, and expired sessions are rejected. Already-used sessions
      cannot create a second result; identical retries may recover their receipt.
- [ ] Input logs have explicit type, count, size, ordering, and timing bounds.
      Server replay derives the score and rejects malformed/incomplete runs.
- [ ] Replay limits are tested; server replay alone is not presented as proof that
      a human played, and automation-sensitive rewards need separate review.
- [ ] One database transaction consumes the run and persists the score. Concurrent
      submissions and failed transactions cannot duplicate or lose a valid result.
- [ ] Public boards resolve current account names from stable IDs, use deterministic
      tie ordering, and expose no emails or private account data.
- [ ] Migrations are additive, work on a fresh database, and preserve existing data.
      Any expensive operation has a deployment/rollback plan.
- [ ] Tickets, XP, quests, achievements, and leaderboard payouts are absent or have
      explicit maintainer approval, server-side integration, and economy tests.

## Presentation, accessibility, and assets

- [ ] Desktop and narrow touch layouts work without clipping or scrolling traps.
- [ ] All actions work with a keyboard; focus is visible and controls have labels.
- [ ] Feedback is understandable without color, sound, or animation alone.
- [ ] Reduced motion and all supported themes remain usable. Shared styles do not
      leak into other games.
- [ ] Screenshots or a recording show gameplay, results, and the leaderboard using
      synthetic accounts.
- [ ] Asset sources, licenses, attribution, and added dependency notices are listed;
      contributor has the right to submit them. Branding terms are preserved.

## Evidence and release

- [ ] Typecheck, lint, build, relevant game checks, and registry checks pass.
- [ ] Stored registry keys are compared against the recorded pre-contribution
      `dev` baseline using `FLOOR_REGISTRY_BASE_REF` and
      `FLOOR_REGISTRY_REQUIRE_BASE=1`; a missing comparison was not skipped.
- [ ] Engine tests cover deterministic replay, valid boundaries, and invalid inputs.
- [ ] Disposable-database checks cover ownership, forgery/expiry, one-use races,
      identity changes, and server gates. Browser checks cover a full played run.
- [ ] Copied checks use the new rules/fixtures, migration, SQL names, disposable
      database guard, account prefixes, and browser selectors. They exercise the
      new game rather than the unchanged starter.
- [ ] Tutorial/setup works from a clean checkout with `npm ci`, fresh migrations,
      synthetic data, and newly generated local secrets. Record any required tools.
- [ ] Clean-clone evidence identifies the source commit and any uncommitted
      snapshot transfer, including new source files. Dependencies, build output,
      env files, and database contents were created afresh.
- [ ] Local verification results are recorded in the PR to `dev`. Actions runs
      only on pushes to `main` or guarded manual runs targeting `main`; new tests
      are included in that CI workflow and changed-game selection where applicable,
      without repository secrets.
      No `dev` or pull-request Actions trigger was introduced.
- [ ] Maintainer review is complete before release to `main` through private ops.
      Contributors never need production data, credentials, or deployment access.
