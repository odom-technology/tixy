# Contributing to Tixy

Bug fixes, accessibility, performance, game polish, and new game ideas are welcome.

## Workflow

1. Fork the public repository and branch from `dev`.
2. For a new game or substantial gameplay change, open an issue describing its
   controls, scoring, replay validation, and assets first.
3. Develop against your own disposable PostgreSQL database with synthetic accounts.
4. Run typecheck, lint, build, and relevant game tests.
5. Open a PR targeting `dev`. Explain changes and verification, with screenshots
   or a recording for visible changes.
6. Maintainers review contributions; releases move reviewed changes to `main`.

See [the game guide](docs/contributing-games.md) for integration points.

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
to ODOM Tech or Tixy trademarks.

Report security findings privately using [SECURITY.md](SECURITY.md).
