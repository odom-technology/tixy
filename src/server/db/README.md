# Database Layer

The standalone arcade uses Postgres.

- `client.ts` owns the shared `pg` pool and transaction helper.
- `migrations/` contains idempotent SQL migrations.
- `schema.ts` still contains extracted table placeholders for game modules that
  need a later Drizzle/Postgres migration pass.

Run migrations with:

Windows PowerShell:

```powershell
npm run db:migrate
```

Mac Terminal:

```bash
npm run db:migrate
```
