# Environment Variables

Copy `env/.env.example` to `env/.env.local` for local development. Keep real
secrets out of git. The npm scripts load `env/.env.local` automatically.
Only the required variables need real values; commented values are optional
toggles or fallbacks.

## Required

`DATABASE_URL`
: Postgres connection string. Local example:
  `postgres://arcade:arcade@localhost:5432/arcade`.

`GAME_SESSION_SECRET`
: Long random secret used to sign game/session cookies and admin WIP bypass
  tokens. Use a unique production value.

`CRON_SECRET`
: Shared secret required by cron endpoints so they cannot be called publicly
  without authorization.

`ARCADE_ADMIN_EMAILS`
: Comma-separated list of admin account emails. These users get the `admin`
  role and can manage site settings after signing in. Production does not grant
  admin to the first account when this is omitted.

`ARCADE_ALLOW_FIRST_ADMIN_BOOTSTRAP`
: Emergency-only escape hatch that restores first-account admin bootstrap when
  set to `true`. Leave unset in production and prefer `ARCADE_ADMIN_EMAILS`.

`NEXT_PUBLIC_APP_URL`
: Recommended public app URL exposed to browser code. Use
  `http://localhost:3000` locally and `https://tixy.lol` in
  production. If omitted, the app falls back to localhost in local/dev
  contexts.

## Generate Secrets

Use different values for `GAME_SESSION_SECRET` and `CRON_SECRET`.

Windows PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Mac Terminal:

```bash
openssl rand -base64 32
```

## Site URLs

`APP_URL`
: Optional server-side canonical app URL override. Usually omit it when
  `NEXT_PUBLIC_APP_URL` already matches the deployed origin.

`NEXT_PUBLIC_SITE_URL`
: Optional public site URL fallback. Usually omit it if `NEXT_PUBLIC_APP_URL`
  is set.

`VERCEL_URL`
: Optional platform-provided fallback used only when present.

## Site Access

Maintenance redirects and public banners are stored in Postgres and managed from
`/admin/site-settings`.

`ARCADE_TRUST_PROXY_AUTH`
: Set to `true` only when a trusted reverse proxy injects authenticated user
  headers. Keep `false` for normal self-hosted account auth.

`POOL_GUEST_PRACTICE`
: Lets signed-out players practice 8-ball against the bot, with no tickets,
  rating or saved history. `true` turns it on, `false` turns it off. Unset, it
  is on in development and off in production. Only the bot-match routes
  accept guests; see `src/server/arcade/pool-guest-practice.ts`.

## Auth Rate Limiting

`TRUSTED_PROXY_COUNT`
: Number of reverse-proxy hops in front of the app (default `1`). The client IP
  used for rate limiting and audit logs is read this many entries from the right
  of `X-Forwarded-For` — the hop your own proxy appended — so a client cannot
  forge it. Set to `0` to ignore `X-Forwarded-For` entirely (direct exposure).

`SIGNIN_RATE_LIMIT` / `SIGNIN_ID_RATE_LIMIT` / `SIGNIN_IP_RATE_LIMIT`
: Signin attempts allowed per 15 minutes, per identifier+IP (default `10`) and
  per identifier across all IPs (default `20`), plus per IP across all
  identifiers (default `60`). The latter prevents username rotation from
  bypassing throttling.

`REGISTER_RATE_LIMIT` / `RECOVER_RATE_LIMIT`
: Registration attempts per hour per IP (default `60`) and recovery attempts per
  hour per identifier and per IP (default `5`).

`RATE_LIMIT_IP_ALLOWLIST`
: Comma-separated IPs that bypass auth rate limiting entirely (e.g. an office
  egress IP). Leave empty in normal operation.

`MAX_HTTP_BODY_BYTES`
: Maximum declared HTTP request-body size. Defaults to 1 MiB; oversized
  requests are rejected before application parsing.

## Anti-Cheat Logs

`ANTI_CHEAT_LOG_PASSES`
: `false` logs only flags and rejects. Set to `true` temporarily when debugging
  clean submissions.

`ANTI_CHEAT_LOG_RETENTION_DAYS`
: Number of days to retain anti-cheat logs. Defaults to `14` and is capped in
  code.

## Product Analytics

`PRODUCT_ANALYTICS_HASH_SECRET`
: Optional stable key used to create one-way account pseudonyms for aggregate
  D1/D7 retention. It falls back to `GAME_SESSION_SECRET`; setting a dedicated
  value lets session-signing keys rotate without resetting retention cohorts.
  Use at least 16 characters and never expose it to browser code.

## Ads

`NEXT_PUBLIC_ADSENSE_CLIENT_ID`
: Browser-exposed AdSense publisher/client ID for game ad units. The root
  layout loads the `ca-pub-9188105841935377` tag for consent messaging during
  review, while game ad units remain disabled until approval.

`ADSENSE_PUBLISHER_ID`
: Optional server-side publisher ID for `/ads.txt`. Defaults to
  `pub-9188105841935377`; if overridden, the app also derives `pub-...` from
  `NEXT_PUBLIC_ADSENSE_CLIENT_ID`.

`NEXT_PUBLIC_ADSENSE_ENABLE_GAME_ADS`
: Set to `true` to show guest display ads after site approval and consent
  setup. Defaults to disabled.

`NEXT_PUBLIC_ADSENSE_GAME_TOP_SLOT` / `NEXT_PUBLIC_ADSENSE_GAME_BOTTOM_SLOT`
: Manual AdSense ad unit slot IDs rendered above and below actual game pages
  for guests only.

`NEXT_PUBLIC_ADSENSE_DISABLED_GAME_ROUTES`
: Comma-separated route paths or game slugs where guest display ads should not
  render, e.g. `/8-ball`. Wager games are always excluded.

`NEXT_PUBLIC_GAM_REWARDED_AD_UNIT_PATH`
: Google Ad Manager rewarded ad unit path used by explicit opt-in reward
  buttons for signed-in users.

`AD_REWARD_STORE_TICKETS`
: Store-only Tickets granted by a rewarded ad. Defaults to `25`.

`AD_REWARD_DAILY_LIMIT`
: Maximum rewarded ad intents per user per 24 hours. Defaults to `10`.

`AD_REWARD_COOLDOWN_MS`
: Minimum time between rewarded ad intent requests. Defaults to `60000`.

`AD_REWARD_INTENT_TTL_MS`
: Reward intent expiry window. Defaults to `600000`.

## Stripe

`STRIPE_SECRET_KEY`
: Server-side Stripe secret key for Checkout Session creation and API lookups.

`STRIPE_WEBHOOK_SECRET`
: Stripe endpoint signing secret for `/api/stripe/webhook`.

`STRIPE_TICKET_PACKS_JSON`
: Optional JSON array overriding the default store-only ticket packs. Each entry
  must include `id`, `name`, `tickets`, `amount` in minor units, and `currency`.

Use keys from the `tixy.lol` Stripe account. Sandbox and live mode each need
their own secret key and matching endpoint signing secret; keep both secrets
in the host's private `.env`, never in Git. Stripe hosted Checkout uses inline
prices from the ticket pack configuration, so it does not require a publishable
key or manually created Stripe Products/Prices.

Paid ticket packs require a signed-in local tixy account and always grant
Store Tickets. Checkout stays unavailable until both the API key and webhook
signing secret are configured.

The webhook URL is `https://tixy.lol/api/stripe/webhook`. Subscribe to snapshot
events for `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `payment_intent.payment_failed`,
`charge.refunded`, and `charge.dispute.created`.

Run `npm run test:stripe-payments` for isolated payment regression checks with
`PAYMENT_TEST_DATABASE_URL` pointing to a disposable PostgreSQL database named
`arcade_payment_regression`. The suite initializes and resets that database,
uses mocked Stripe responses, and never loads `.env` or makes Stripe requests.
CI creates this separate test database automatically. These checks do not
replace an end-to-end sandbox purchase and webhook delivery check before live
payments are enabled.

## Local development tooling

- `ARCADE_ALLOWED_DEV_ORIGINS`: comma-separated development hostnames, without
  schemes; defaults to `localhost,127.0.0.1`. Configure this only when using a
  different development hostname.
- `PLAYWRIGHT_EXECUTABLE_PATH`: optional local Chromium executable for QA scripts.
  Omit it to use the browser installed by `npx playwright install chromium`.

Never use production credentials or customer data for contributor testing.
