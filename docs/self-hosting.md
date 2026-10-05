# Self-hosting

Requires PostgreSQL 18 and Node.js 24, or Docker with the supplied Dockerfile.
Use your own database, domains, secrets, and branding. Review [licensing](../LICENSING.md).

1. Configure runtime variables from `env/.env.example` and `env/README.md`.
2. Generate distinct session/cron secrets and configure admin emails.
3. Back up your database, then run `npm run db:migrate`.
4. Build with `npm run build` and start with `npm run start`, or use the Dockerfile
   `runner` target. The `migrate` target handles database migrations.
5. Configure HTTPS and forward `/ws` WebSocket upgrades to the custom server.
6. Verify `/api/health` and `/ws`. Privately schedule backups and required cron
   endpoints using your runtime configuration.

Run `dist/server.mjs`: the standalone Next server does not attach `/ws`.
Real secrets are never needed to build an image. Keep database access private
and backup storage separate from source.

Configure your own ad publisher and payment provider. IDs in the source identify
the official service; they grant no account access or permission to process
payments for ODOM Tech.
