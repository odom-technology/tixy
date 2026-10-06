# tixy

An arcade by ODOM Tech: skill games, multiplayer, ticket machines, player cards,
and a cosmetic prize counter. Play at [tixy.lol](https://tixy.lol).

Contributions that improve existing games or add thoughtful new games are welcome.
See [Contributing](CONTRIBUTING.md) and the [game guide](docs/contributing-games.md).

## Local development

Requires Node.js 24, npm, and Docker Compose (or PostgreSQL 18).

```sh
git clone https://github.com/odom-technology/tixy.git
cd tixy
git switch dev
npm ci
cp env/.env.example env/.env.local
npm run db:up
```

PowerShell users can use `Copy-Item env/.env.example env/.env.local`.
Generate two different secrets with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set `GAME_SESSION_SECRET` and `CRON_SECRET` in your local env file. Set
`ARCADE_ADMIN_EMAILS` to the email for your **local test account**. The example
DATABASE_URL matches the disposable local Compose database.

```sh
npm run db:migrate
npm run dev
```

Open <http://localhost:3000> and register your test account. Use synthetic data.
Ads and payments are optional; contributors do not need production credentials.
Ticket purchases use standard Stripe-hosted Checkout with cards, eligible Apple
Pay/Google Pay card wallets, and Link. Buy-now-pay-later methods and paid Checkout
add-ons are not enabled; normal payment processing fees still apply.
Local PostgreSQL binds to loopback. For another development hostname, configure
`ARCADE_ALLOWED_DEV_ORIGINS` as described in the environment reference.

## Verification

```sh
npm run typecheck
npm run lint
npm run build
npm run test:themes
npm run test:floor-registry
npm run test:weekly-boards
npm run test:profile-showcase
```

Run the relevant replay/invariant checks for changed games. Integration tests
require explicitly named disposable databases; CI creates its own databases.

## Architecture

- Next.js / React UI; custom Node server for HTTP, realtime, and `/ws`.
- PostgreSQL stores accounts, scores, tickets, catalog, and site settings.
- Server replay validates outcomes. Browser code does not award tickets.
- [Environment reference](env/README.md), [game catalog](docs/game-catalog.json),
  [admin metrics](docs/admin-metrics.md), and [self-hosting](docs/self-hosting.md).

This repository contains source, schemas, sample configuration, and tests.
Production operations live in a separate private repository. User data, backups,
credentials, and production access are never needed to contribute.

## License and credits

Project code is **AGPL-3.0-only**. Branding and assets have separate terms:
[Licensing](LICENSING.md), [asset provenance](docs/ASSET_PROVENANCE.md), and
[Credits](CREDITS.md). ODOM Tech and tixy branding are reserved.

Report vulnerabilities using the [security policy](SECURITY.md).
