---
date: 2026-05-09
adrs: [0003]
slice: 1
type: implementation
status: complete
---

# Conductor run — ADR-0003 roles + RLS schema

## Context

Cycle 1 of the visible-surface push (a six-cycle queue: 0003 → 0006 → 0002 → 0009 → 0027 → 0023). ADR-0003 is the foundational gate — every downstream cycle that touches member data needs the `profiles` table, the `role_t` enum, `auth.role_at_least(text)`, and the canonical RLS policy set in the ground before anything can sit on top of it. The slice-1 scope is intentionally narrow: schema + policies on `profiles` only, no audit-log writes (cycle 2), no auth wiring (cycle 3), no MFA middleware (cycle 5), no soft-delete plumbing (cycle 6). ADR-0003 itself ratified at 2026-05-04 as part of the foundation batch; this run is the first time the policies actually exist as runnable SQL and the first time RLS is exercised against an in-process Postgres engine.

The run end-to-end: spec-writer + critic (2 iterations to ship rev 2) → planner (`.conductor/0003/plan.json`, 8 tasks t0–t7) → mandatory premortems on the three risk:high migration / fixture / test tasks (t1, t2, t4 — 30 risks surfaced across the three) → 4 worker waves with 3 retry loops → slice-level validator + critic-diff + scope-judge in Phase 3, all returning PASS / ship / `ship_ready: true` → this Phase 4 documentation step. The retry loops were where the lessons came from: t5 needed one retry (libpg_query bitfield decoding), t1 needed one retry (FORCE RLS for the test substrate), t4 needed three retries (pgcrypto extension drop, then `SET ROLE` to a non-superuser to escape BYPASSRLS, then a smoke-test fix on the auth-stub). Each retry surfaced a real, durable lesson about the test substrate, not a sloppy-worker artifact.

## Changes

Concrete things landed in the working tree (uncommitted; Phase 5 shipper composes the commits):

**Migration (t1, dispatch 0011 + retry 0024):**

- `supabase/migrations/0002_profiles_and_roles.sql` — `role_t` enum (`'member' | 'cashier' | 'manager' | 'owner'`, lowercase, ordered by precedence); `profiles` table with `id uuid PK FK auth.users(id) ON DELETE CASCADE`, `full_name`, `dob`, `phone`, `email UNIQUE`, `role role_t NOT NULL DEFAULT 'member'`, `created_at` / `updated_at`; `auth.role_at_least(target text)` helper with the exact role-set tuples from the ADR (cashier ∈ {cashier, manager, owner}, manager ∈ {manager, owner}, owner = {owner}); `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` (defense-in-depth, no-op in production but required for the pglite test substrate to exercise RLS — see Decisions); three policies (`profiles_select_self_or_staff`, `profiles_update_self_or_manager` with both USING and WITH CHECK, `profiles_delete_manager`) — explicitly NO INSERT policy with a comment block documenting why; `profiles_protect_role_change()` trigger function raising SQLSTATE 42501 with bypass `auth.role_at_least('manager') OR auth.uid() IS NULL`; `set_updated_at` trigger registered after `profiles_protect_role_change` so alphabetical pg_trigger ordering puts the protect trigger first. Heavily commented with the "why" of every load-bearing decision.

**Test fixtures (t2 + t3, dispatches 0012 / 0014):**

- `tests/db/_fixtures/auth-stub.ts` — `setupAuthStub(pg)` creates `auth` schema, `auth.users` table, `auth.uid()` / `auth.role()` SQL functions reading `test.uid` / `test.role` GUCs; exports `setTestUid()` / `setTestRole()` helpers. Runs four smoke-test invariants on boot (GUC session-scoping, NULL-on-clear, default 'authenticated' role, return-type signature) so substrate drift fails loudly at setup time, not silently inside a downstream test.
- `tests/db/_fixtures/profiles.ts` — `seedProfile(pg, overrides: Partial<ProfileRow>)` with v1 defaults; `ProfileRow` carries an `[extra: string]: unknown` index signature so cycles 4 (ADR-0009 columns) and 6 (ADR-0023 `deleted_at`) can extend without breaking callers. Email default `seed.${id.slice(0, 8)}@test.local` (UUID-prefix-derived, unique by construction) to avoid collisions across the 43-test suite.

**RLS suite (t4, dispatches 0020 → 0022 → 0026 → 0028, three retries):**

- `tests/db/rls-profiles.test.ts` (~41KB, 43 sub-tests). `beforeAll` constructs PGlite, runs auth-stub, applies the migration via raw-SQL entrypoint, seeds fixtures *as superuser* (mirroring production seeds-via-service-role), then `CREATE ROLE app_authenticated NOBYPASSRLS NOINHERIT` + GRANTs + `SET ROLE`. Helpers: `asAuthenticated(uid)`, `asServiceRole()` (`RESET ROLE` then clears `test.uid`), `withRollback(body)` (manual BEGIN/ROLLBACK that doesn't auto-commit on success like pglite's `transaction()` does). All 12 AC8 sub-cases plus a bonus WITH CHECK behavioral test (id-rewrite that passes USING but violates WITH CHECK). All `rejects.toMatchObject` calls assert on `code: '42501'` only — never on message text. Sub-case 10 (privilege-escalation) has three variants (simple SET, multi-column SET, no-op `SET role = role`).

**Migration shape suite (t5, dispatches 0015 + retry 0018):**

- `tests/migrations/profiles-shape.test.ts` (~19KB, 19 tests). Tier 1 regex/substring assertions (filename pattern, column-name presence, `enable row level security`, three policy names, two trigger names, comment-stripped absence of any `FOR INSERT`). Tier 2 AST assertions via pg-query-emscripten, including the load-bearing claim that `profiles_update_self_or_manager` has BOTH `qual` (USING) AND `with_check` clauses — string substring matching alone cannot distinguish the two, only the parse tree can. Trigger-AST assertions use bitfield equality (`timing === 2`, `(events & 16) === 16`) instead of `JSON.stringify(...).toContain('UPDATE')`, after the first attempt discovered libpg_query emits numeric bitfields, not keyword strings.

**Type ambient + devDeps (t0, dispatch 0009):**

- `package.json` — added `@electric-sql/pglite` and `pg-query-emscripten` as devDependencies.
- `tests/db/_fixtures/pg-query-emscripten.d.ts` — minimal ambient types for pg-query-emscripten (the dep ships without TS types).

**Total:** 9 files, +2487 lines across the slice diff.

## Decisions

Non-obvious choices made during the run that are worth pinning:

- **pglite over Docker Supabase as the test substrate.** ADR-0003's spec drafted with both options open under "Open Q #3"; the planner resolved to pglite because the conductor host has no Docker daemon. The trade-off accepted: pglite is real Postgres (16) so RLS, triggers, `security definer` functions, and SQLSTATE codes all behave as in production, BUT pglite does not bundle Supabase's `auth` schema, the contrib extensions catalog is reduced, and the default user is the table owner. The first two are addressable in the test harness (auth-stub + drop pgcrypto); the third is the dominant new lesson — see KB delta on pglite. Picking pglite trades "matches Supabase exactly" for "no infra dependency, runs in CI on any host" — appropriate for slice 1 schema-only work, will need re-verification against real Supabase in slice 4 integration tests.
- **`FORCE ROW LEVEL SECURITY` in the migration, not just `ENABLE`.** Discovered during t1's first validator → t4's first run cycle: `ENABLE ROW LEVEL SECURITY` does NOT apply policies to the table OWNER; `FORCE` is needed for owner-connected sessions. In production this is moot because Supabase's `anon` and `authenticated` roles never own the table; in pglite the default `postgres` user owns everything. We added FORCE to the migration anyway, with an inline comment marking it as defense-in-depth that aligns with Supabase's own documentation. This is the safe direction (`FORCE` cannot make production less secure; it can only fail closed) and it makes the test substrate's RLS behavior match production semantics.
- **Test-side `CREATE ROLE app_authenticated NOBYPASSRLS NOINHERIT` + `SET ROLE`, not `FORCE` alone.** This was the t4-attempt-2 surprise that cost the most retries. After we added `FORCE RLS`, 11 of 43 RLS sub-tests still failed because pglite's default user has the `BYPASSRLS` user-attribute, which short-circuits ALL policy evaluation BEFORE `FORCE` is even consulted. The fix is harness-side: create a non-superuser role (`NOBYPASSRLS`) that mirrors Supabase's `authenticated` role shape, GRANT it the precise privileges it needs, and `SET ROLE` to it for the per-test connection. For the service-role bypass test (AC8.12), `RESET ROLE` back to superuser temporarily. This dual-axis model — Postgres role controls BYPASSRLS, `auth.uid()` GUC controls the policy predicate — is the durable pattern; cycles 2/4 RLS work will lean on it.
- **Service-role bypass predicate `auth.uid() IS NULL` (v1).** This is Supabase's older idiom — service-role connections don't have a `request.jwt.claims` set, so `auth.uid()` returns NULL. Newer Supabase docs sometimes use `auth.jwt() ->> 'role' = 'service_role'` instead. We picked v1 explicitly with a planner note that cycle 3 (ADR-0002 auth) must re-verify against current Supabase docs. If the predicate needs to change, it's a one-line migration update and the test stub already simulates both axes.
- **Three variants of the privilege-escalation test.** AC8.10 (own-row role escalation rejected) has variant A (simple `UPDATE … SET role = 'manager'`), variant B (multi-column `SET role + full_name`), and variant C (no-op `SET role = role`). Variant C catches a class of subtle drift: triggers on `BEFORE UPDATE OF role` fire whenever the column appears in the SET clause, even if the new value equals the old. If a future migration switched the trigger to "value actually changed" semantics, variant C would catch it; the other two would still pass.
- **Error-code-only assertions, never message-text.** Every `rejects.toMatchObject` call uses only `{ code: '42501' }`. The migration's RAISE EXCEPTION message string `'role change requires manager+'` appears nowhere in tests. This insulates the suite from copy edits to the message and from translation if we ever localize errors.
- **`expect.assertions(N)` on every rejection-branch test.** Without this, a test like `await expect(badThing()).rejects.toMatchObject(...)` silently passes if `badThing()` actually resolves and the rejection branch never runs. Premortem t4 R3 called this out; every rejection test in the suite has the assertions count pinned.
- **Wave bundling.** t0 solo (foundations); t1 solo (migration, risk:high, premortem-required); t2+t3 bundled (test fixtures, disjoint files); t4+t5+t6 bundled (RLS suite + shape suite + migrate:check, three workers in parallel against the same migration); t7 solo (final gauntlet). 8 plan tasks compressed into 4 implementation waves. The retry loops on t1, t4, t5 each ran sequentially within their own task — the wave structure didn't bottleneck recovery.

## Tests

**Ran (slice validator, all 5 spec acceptance commands + standard gauntlet):**

- `pnpm typecheck` — exit 0 (`tsc --noEmit`, including the new ambient `.d.ts` for pg-query-emscripten).
- `pnpm lint` — "No ESLint warnings or errors."
- `pnpm test` — 47 files / 422 passed + 1 skipped (preserved from prior cycle, unrelated to this slice). Among them: `tests/migrations/profiles-shape.test.ts` 19/19, `tests/db/rls-profiles.test.ts` 43/43, `scripts/conductor/` 65/65 (no conductor regression).
- `pnpm migrate:check` — exit 0, "All migrations passed safety + naming checks." (2 migration files scanned: `0001_*` from prior infra and the new `0002_profiles_and_roles.sql`.)
- `pnpm test tests/migrations/profiles-shape.test.ts` — 19/19, 1.22s.
- `pnpm test tests/db/rls-profiles.test.ts` — 43/43, 3.01s.
- `pnpm test scripts/conductor/` — 65/65 across 3 files (canonical-hash + schemas + validate-skill).

**Did NOT run (out of slice-1 scope):**

- Real-Supabase integration tests against env-var SUPABASE_SERVICE_ROLE_KEY — explicitly deferred to Slice 4 per the ADR-0003 alternatives section. The pglite suite is the slice-1 substitute, with the trade-offs documented above.

## Next

What the next shift should pick up:

- **Cycle 2 — ADR-0006 audit log table.** The `profiles_protect_role_change` trigger currently only rejects unauthorized role changes; it doesn't write an audit row on legitimate ones. ADR-0006's slice will add the `audit_log` table, then extend the existing trigger function with an INSERT into `audit_log` for every successful role transition. The pglite test substrate, the `asAuthenticated` / `asServiceRole` helpers, and the `withRollback` pattern from this cycle are all reusable as-is.
- **Cycle 3 — ADR-0002 auth + signup + login.** Re-verify the `auth.uid() IS NULL` service-role bypass predicate against current Supabase Auth docs and adjust the migration if needed. Land the signup Server Action that inserts the `profiles` row matching the `auth.users` row created by Supabase Auth (this is why the slice-1 schema has no INSERT policy — service-role does the insert).
- **Phase 5 shipper for ADR-0003** — compose the slice commit on the `feature/conductor-v0.3` branch (or wherever the shipper convention lands).

## Notes for future me

- **The retry loops were the lessons.** Five retries across t1/t4/t5, four of which surfaced durable substrate gotchas (pgcrypto / BYPASSRLS / FORCE / libpg_query bitfields) and one was a smoke-test refinement. None were sloppy-worker artifacts. The pattern: when the validator says "the migration is fine, but 11 RLS sub-tests fail," you're staring at a substrate-vs-production gap, not a logic bug. Future cycles testing RLS against pglite should pre-load the BYPASSRLS lesson before writing the test setup.
- **The test-harness role split is reusable.** `asAuthenticated(uid)` / `asServiceRole()` / `withRollback(body)` live in the RLS suite for now; cycle 2 will need them for audit-log RLS, cycle 4 for ID-verification rows. When the second cycle reaches for them, lift them into a shared `tests/db/_fixtures/rls-helpers.ts` rather than copy-pasting. The dual-axis model (Postgres role × `auth.uid()` GUC) is the load-bearing abstraction.
- **The migration's inline "why" comments earn their keep.** The ON-DELETE-CASCADE direction comment, the lowercase enum "DO NOT capitalize" comment, the FORCE-RLS defense-in-depth comment, and the `OR not AND` bypass comment are exactly the things a future migration author would otherwise re-discover the hard way. Keep this density on cycle 2's audit-log migration.
- **Two-checker Phase 3 caught zero issues this run, and that's still useful information.** Critic-diff and scope-judge both returned ship/ship_ready independently. They duplicated effort (both walked the 12 ACs against the diff) but that duplication confirmed there were no semantic gaps the mechanical validator missed. On a heavier behavioral slice, the duplication is the value; on a schema-only slice, it's a low-cost confirmation. Worth keeping as default Phase 3 shape.
- **`FORCE RLS` is defense-in-depth, not the answer to BYPASSRLS.** Documenting this bluntly in the new pglite KB topic so cycle 2 doesn't re-discover it: FORCE applies RLS to table-owners; BYPASSRLS is a user attribute checked first. They live on different axes.
