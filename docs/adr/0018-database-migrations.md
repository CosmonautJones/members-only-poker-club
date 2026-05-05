# ADR-0018: Database migrations

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 1

## Context

Schema changes are the most dangerous deploys. A missing index, a NOT NULL added to a populated column, a CONSTRAINT under heavy write load — any of these can cause prod outage.

## Decision

To be drafted in Slice 1. Direction:

- **Tool:** Supabase CLI migrations (`supabase migration new <name>`, files at `supabase/migrations/NNNN_<name>.sql`).
- **Review:** Every migration PR includes a `MIGRATION-REVIEW` checklist:
  - [ ] Forward-only (no DROP without explicit owner approval)
  - [ ] Adds a column? Defaults set or backfill plan documented.
  - [ ] Adds a NOT NULL? Backfill first in a separate migration.
  - [ ] Adds an index on a hot table? Use `CREATE INDEX CONCURRENTLY`.
  - [ ] Adds RLS policies? Test denial in unit test.
  - [ ] Touches a foreign key? Check cascade behavior.
- **Order of ops for risky changes:**
  1. Add new column nullable
  2. Backfill in batches (50–500 rows per batch with sleep)
  3. Add NOT NULL constraint in a follow-up migration
  4. Cleanup
- **Zero-downtime guarantees:**
  - No `DROP COLUMN` without a deprecation window
  - No `ALTER TYPE` (always add new column, migrate, drop old)
  - No long-locking operations during business hours
- **Production application:** migrations run as part of Vercel deploy hook, not by an out-of-band cron. Failure rolls back the deploy.

### Local development

`supabase db reset` to wipe and re-apply. `supabase db diff` to author new migrations from local schema changes.

## Open questions

- Whether to switch to Drizzle Kit for migration generation (typed schema)
- Whether to use shadow database for migration verification before staging
