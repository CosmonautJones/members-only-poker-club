<!--
  Use this template for every PR. Sections that don't apply can be deleted
  rather than left empty. The MIGRATION-REVIEW checklist must stay if the PR
  touches `supabase/migrations/`.
-->

## Summary

<!-- 1-3 bullets: what changed and why -->

## Test plan

<!-- How you verified the change. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm format:check`
- [ ] CI gauntlet passes

## MIGRATION-REVIEW checklist

<!--
  Tick each box if the PR adds or modifies a file in `supabase/migrations/`.
  See ADR-0018 (Database migrations) for the underlying rules and
  `supabase/migrations/README.md` for the workflow.
-->

- [ ] Forward-only — no `DROP TABLE` / `DROP COLUMN` without explicit owner
      approval in this PR description.
- [ ] Defaults / backfill — adds a column? Default set or backfill plan
      documented.
- [ ] NOT NULL — adds a NOT NULL constraint to an existing column? The
      backfill is in a separate, prior migration referenced by a
      `-- migration-review: backfilled-by:NNNN` comment.
- [ ] Indexes on hot tables — uses `CREATE INDEX CONCURRENTLY`.
- [ ] RLS policies — tests cover both allow and deny paths in `tests/rls/`.
- [ ] Foreign keys — cascade behavior matches ADR-0006 (audit log) and
      ADR-0023 (data deletion) posture.
- [ ] Money columns — every `*_cents` column is `INTEGER` (ADR-0004). The
      migration scanner enforces this; the box is a manual cross-check.
- [ ] No `ALTER TYPE` on a column. Use new-column → migrate → drop.
- [ ] No long-locking operations during business hours. The migration carries
      a `-- safe-window: any|off-hours` comment at the top.

## Linked ADR(s) / spec(s)

<!-- e.g., ADR-0018, docs/specs/0018-database-migrations-implementation.md -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)
