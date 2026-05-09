# ADR-0018: Database migrations

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 1

## Context

Schema changes are the most dangerous deploys. A missing index, a NOT NULL added to a populated column, a CONSTRAINT under heavy write load — any of these can cause prod outage.

## Decision

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

## Open questions (deferred)

- **Drizzle Kit for typed schema** — declined for v1. Supabase CLI is the canonical path with Supabase; layering Drizzle adds complexity for a single-developer team. Re-evaluate if/when we adopt Drizzle as the runtime ORM (currently using Supabase JS client directly).
- **Shadow database for migration verification** — deferred to Slice 4. v1 default: PR review + staging dry-run is the gate. Shadow DB adds CI complexity worth introducing only when migration cadence picks up.
