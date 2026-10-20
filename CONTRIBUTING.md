# Contributing to tixy

Bug fixes, accessibility, performance, game polish, and new game ideas are welcome.

## Workflow

1. Fork the public repository. Fetch public upstream `dev` and create your
   feature branch from `upstream/dev`, following the
   [tutorial setup](docs/first-game.md#1-start-from-a-fresh-public-checkout).
   Your fork may contain only `main`; it does not need a separate `dev` branch.
2. For a new game or substantial gameplay change, open an issue describing its
   controls, scoring, replay validation, and assets first. Maintainer-authorized
   local pilots may record that proposal in the repository instead.
3. Develop against your own disposable PostgreSQL database with synthetic accounts.
4. Run typecheck, lint, build, and relevant game tests. Follow the
   [game review checklist](docs/game-review-checklist.md) for a new game.
5. Push your feature branch to your fork (`git push -u origin game/your-game`)
   and open a PR targeting upstream `dev`. Explain changes and verification, with screenshots
   or a recording for visible changes.
6. Maintainers review contributions; releases move reviewed changes to `main`
   through the separate private ops repository. Contributors need no ops access.

Build and play the complete Pattern Match example with the
[first-game tutorial](docs/first-game.md). See [the game guide](docs/contributing-games.md)
for the supported game interface and integration points. Run checks locally and
include the results in PRs to `dev`. GitHub Actions runs only on pushes to `main`
or guarded manual runs targeting `main` to limit usage; keep contributions focused
enough to review alone.

## Requirements

- Keep score validation, permissions, and ticket mutations on the server.
- Honor section/game availability checks, account rules, and rate limits.
- Preserve keyboard access, reduced motion, and supported themes.
- Use original or suitably licensed assets; include source and license notices.
- Add meaningful tests for gameplay changes; never connect tests to production.
- Never include secrets, cookies, user exports, or real account data in code,
  screenshots, issues, PRs, or Actions logs.

Submit only material you have the right to contribute. Unless explicitly noted
otherwise, code contributions are offered under AGPL-3.0-only. Preserve third-party
notices and document asset licenses separately. Contributing does not grant rights
to ODOM Tech or tixy trademarks.

Report security findings privately using [SECURITY.md](SECURITY.md).
