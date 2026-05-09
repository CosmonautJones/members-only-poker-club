---
adr: 0018
slice: 1
risk: medium
acceptance_commands:
  - 'pnpm test tests/migrations/'
  - 'node scripts/check-migration-safety.mjs --self-test'
---

# Spec: Database migrations workflow (ADR-0018 slice 1)

- **ADR:** [0018](../adr/0018-database-migrations.md)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Establish the shipping infrastructure for `supabase/migrations/` so that future
ADRs (0009 ID, 0010 subscriptions, 0011 time-bank, 0012 tournament, 0020 flags,
0023 privacy) can land migrations safely. No business migrations ship in this
slice — only the workflow + guardrails.

## Acceptance criteria

1. `supabase/migrations/README.md` documents naming convention (`NNNN_<name>.sql`),
   workflow (`supabase migration new`, `supabase db reset`, `supabase db diff`),
   and the MIGRATION-REVIEW checklist members of any PR adding a migration.
2. `scripts/check-migration-safety.mjs` exists and is runnable. Given any new or
   modified migration file under `supabase/migrations/`, it scans for risky
   SQL patterns (DROP TABLE/COLUMN without comment, ALTER TYPE, CREATE INDEX
   without CONCURRENTLY on production-scale tables, NOT NULL added without a
   prior backfill migration). Exits non-zero on findings; exits 0 when clean.
3. `--self-test` flag on the safety script runs an internal fixture suite
   (positive + negative cases) and exits 0 only if every fixture matches its
   expected outcome.
4. `.github/PULL_REQUEST_TEMPLATE.md` includes the MIGRATION-REVIEW checklist
   from ADR-0018 verbatim. Reviewers tick the boxes when a migration is part of
   the PR; PRs without migrations leave the checklist unticked.
5. CI workflow (`.github/workflows/ci.yml`) replaces the `migrate-staging`
   placeholder with a `migrations` job that:
   - Runs `node scripts/check-migration-safety.mjs --against-base` on every PR
     (compares the PR head against the base branch and flags risky changes).
   - Validates that every file in `supabase/migrations/` follows the naming
     pattern `[0-9]{14}_[a-z0-9_-]+\.sql` (Supabase CLI convention) OR
     `[0-9]{4}_[a-z0-9_-]+\.sql` (ADR-0018-documented convention; both
     accepted).
   - Skips the actual `supabase db push` call (deferred to a follow-up slice
     once a staging project is provisioned).
6. Vitest coverage at `tests/migrations/` for: (a) the safety scanner's
   risky-pattern regexes; (b) the file-naming validator; (c) the `--self-test`
   exit code behavior.
7. Backstop grep added to CI: no `*_cents` columns introduced with non-INTEGER
   types in any new migration (mirrors ADR-0004; the existing backstop covers
   `.sql` and `.ts` source but the migration scanner adds an explicit check
   when SQL is the surface).
8. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` all pass.

## Task decomposition hints

- **t0** — `supabase/migrations/README.md` (documentation)
- **t1** — `scripts/check-migration-safety.mjs` (the scanner)
- **t2** — `tests/migrations/check-migration-safety.test.ts` (vitest coverage)
- **t3** — `.github/PULL_REQUEST_TEMPLATE.md` (PR template with checklist)
- **t4** — `.github/workflows/ci.yml` migrations-job replacement
- **t5** — Wire `--self-test` fixture suite into the scanner

## Touched-files inventory

- Create: `supabase/migrations/README.md`
- Create: `scripts/check-migration-safety.mjs`
- Create: `tests/migrations/check-migration-safety.test.ts`
- Create: `tests/migrations/file-naming.test.ts`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `.github/workflows/ci.yml` (replace `migrate-staging` placeholder)
- Modify: `package.json` (add `migrate:check` script convenience)

## Risk flags

- **0004 (money) cross-cutting:** the migration scanner enforces ADR-0004's
  integer-cents rule. Mis-implementing the regex creates a silent gap in the
  money-safety chain.
- **0017 (CI/CD) dependency:** the new CI job replaces an existing placeholder.
  Mistake here breaks the gauntlet for every subsequent PR.

## Out of scope

- Running actual `supabase db push` against a staging project. Deferred until
  the staging Supabase project is provisioned (escalation: Supabase API key).
- Authoring any business migrations. Other ADRs (0009, 0010, 0011, 0020) ship
  their own.
- Drizzle Kit integration. ADR-0018 declined Drizzle for v1.
- Shadow database for migration verification. ADR-0018 deferred to Slice 4.

## Open questions

None at planning time.
