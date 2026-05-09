# Database migrations

Schema changes for the project's Supabase Postgres database. Authored as
forward-only `.sql` files via the [Supabase CLI](https://supabase.com/docs/reference/cli/supabase-migration).

This directory is the source of truth: every schema change goes through a
migration file in this folder; nothing is applied via direct console editing
once the project is past Slice 1.

See [ADR-0018](../../docs/adr/0018-database-migrations.md) for the full
decision document.

## Workflow

### Authoring a new migration

```bash
# 1. Make schema changes locally (e.g., via Studio or SQL editor)
supabase db diff --use-migra -f <descriptive_name>

# 2. Or scaffold an empty migration to write by hand
supabase migration new <descriptive_name>
```

Both produce a file at `supabase/migrations/YYYYMMDDHHMMSS_<descriptive_name>.sql`.

### Naming convention

The Supabase CLI's default timestamp prefix is accepted:

```
20260509120000_add_profiles_table.sql
```

The MIGRATION-REVIEW checklist (below) accepts either timestamp prefixes (CLI
default) or sequential `NNNN_` prefixes (`0001_initial_schema.sql`). The
scanner enforces the format; see `scripts/check-migration-safety.mjs`.

### Resetting local DB

```bash
supabase db reset                    # wipes + replays migrations + seeds
supabase db reset --no-seed          # skip seed.sql
```

### Pushing to a remote project

```bash
supabase link --project-ref <ref>
supabase db push                     # applies pending migrations
```

Production application happens via Vercel deploy hook on `main` merges; do not
run `db push` from a developer machine against production.

## MIGRATION-REVIEW checklist (per ADR-0018)

Every PR that adds or modifies a file in this directory must tick this
checklist in the PR description (the `.github/PULL_REQUEST_TEMPLATE.md` puts
it there automatically):

- [ ] **Forward-only.** No `DROP TABLE` / `DROP COLUMN` without explicit
      owner approval in the PR description.
- [ ] **Defaults / backfill.** Adds a column? Default set or backfill plan
      documented.
- [ ] **NOT NULL.** Adds a NOT NULL? Backfill is in a separate, prior
      migration; this migration only flips the constraint.
- [ ] **Indexes on hot tables.** Uses `CREATE INDEX CONCURRENTLY` (cannot run
      inside a transaction; ensure the migration is split if needed).
- [ ] **RLS policies.** Tests cover both allow and deny paths in
      `tests/rls/`.
- [ ] **Foreign keys.** Cascade behavior matches the audit-log /
      data-deletion posture (ADR-0006, ADR-0023).
- [ ] **Money columns.** Any `*_cents` column is `INTEGER` (ADR-0004). The
      migration scanner enforces; this checkbox is a manual cross-check.
- [ ] **No `ALTER TYPE`.** Always add new column → migrate → drop old.
- [ ] **No long-locking ops during business hours.** Add a
      `-- safe-window: any|off-hours` comment at the top.

## Order of ops for risky changes

For column adds with NOT NULL constraint on a populated table:

1. Migration A: add column nullable.
2. Application code: write to both old and new column.
3. Migration B: backfill in batches (50–500 rows per batch with `pg_sleep`).
4. Migration C: add NOT NULL constraint.
5. Migration D (next slice): drop the old column.

Reviewers should reject single-PR attempts that combine these steps.

## Zero-downtime guarantees

- No `DROP COLUMN` without a deprecation window of at least one slice.
- No `ALTER TYPE` (always a parallel new column).
- No long-locking operations during business hours; flag the migration with
  the `-- safe-window: off-hours` comment.

## Local verification

```bash
# Run the safety scanner against your in-progress migration
pnpm migrate:check

# Or run the scanner's own test fixtures
pnpm migrate:check --self-test
```

The scanner is what CI runs; passing it locally means CI will pass.
