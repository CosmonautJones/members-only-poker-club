---
adr: 0003
slice: 1
risk: high
acceptance_commands:
  - 'pnpm typecheck'
  - 'pnpm migrate:check'
  - 'pnpm test tests/migrations/profiles-shape.test.ts'
  - 'pnpm test tests/db/rls-profiles.test.ts'
  - 'pnpm test scripts/conductor/'
---

# Spec: Authorization model — `profiles` + role enum + RLS (ADR-0003 slice 1)

- **ADR:** [0003](../adr/0003-authorization-model-roles-and-rls.md)
- **Status:** Draft (revision 2)
- **Date:** 2026-05-09

## Goal

Land the authorization substrate the rest of the app builds on: a `profiles`
table keyed to `auth.users`, the `role_t` enum (`member | cashier | manager |
owner`), the `auth.role_at_least(text)` helper, RLS enabled on `profiles` with
the four canonical policies, and a column-level role-change guard. No
application code binds to it yet — auth flow
([ADR-0002](../adr/0002-authentication-and-session-management.md)), identity
verification ([ADR-0009](../adr/0009-member-identity-and-id-verification.md)),
and admin UI ([ADR-0027](../adr/0027-support-operations.md)) all sit downstream
in subsequent cycles. This is the schema + policy skeleton; full enforcement
across other tables is Slice 2.

**Test substrate decision (Open Q #3 RESOLVED):** the RLS test suite uses
[`@electric-sql/pglite`](https://github.com/electric-sql/pglite), an in-process
WASM build of Postgres. pglite is the real Postgres engine — RLS, triggers,
sequences, `security definer` functions, and SQLSTATE codes all behave as in
production. It is npm-installable and requires no Docker daemon, no Supabase
CLI, and no network. The Supabase Auth schema is **not** bundled with pglite,
so the test suite installs a small `auth.uid()` / `auth.role()` stub that
swaps identity per test via Postgres GUCs. See AC8 for the exact contract.

## Acceptance criteria

Numbered, testable. Each is verified by one of the acceptance commands above.

1. Migration `supabase/migrations/0002_profiles_and_roles.sql` exists, follows
   the four-digit `NNNN_<snake_case>.sql` naming convention, and applies cleanly
   when its SQL text is fed to a fresh pglite instance via the pglite client's
   raw-SQL entrypoint (passing `readFileSync(migrationPath, 'utf8')`). (No
   `supabase db reset` dependency — the test owns its own DB; see AC8.)
   Verified by `pnpm test tests/migrations/profiles-shape.test.ts` and the
   `beforeAll` in `pnpm test tests/db/rls-profiles.test.ts`.
2. The migration creates a `role_t` enum (Postgres `CREATE TYPE … AS ENUM`)
   with exactly the values `member`, `cashier`, `manager`, `owner`. No other
   values accepted. (Open Q #4 RESOLVED — name is `role_t`, not `user_role`.)
   Verified by the migration shape test.
3. The migration creates a `profiles` table with these columns and properties:
   `id uuid primary key references auth.users(id) on delete cascade`,
   `full_name text not null`, `dob date not null`, `phone text`,
   `email text not null unique`, `role role_t not null default 'member'`,
   `created_at timestamptz not null default now()`,
   `updated_at timestamptz not null default now()`. No other columns are added
   in this migration (other ADRs own additions — see Out of scope). Verified by
   the migration shape test.
4. The migration creates a `set_updated_at()` trigger function and attaches a
   `BEFORE UPDATE` trigger on `profiles` named **`set_updated_at`** that bumps
   `updated_at = now()` on every update. **Trigger-name ordering invariant:**
   Postgres fires multiple BEFORE UPDATE triggers in alphabetical order by
   name. The role-change protection trigger (AC7) is named
   `profiles_protect_role_change`. Because `'p' < 's'`, the protection
   trigger fires **first** by default. Documented + asserted in AC8 sub-cases
   so a future rename can't silently invert the order. Verified by the
   migration shape test (trigger presence + name) and the RLS test suite
   (round-trip update reflects new `updated_at`; failed-update sub-case
   confirms `updated_at` is not advanced after rollback).
5. The migration creates `auth.role_at_least(target text) returns boolean
   language sql stable security definer` with the precedence ladder verbatim
   from ADR-0003 (`member` → always true for authenticated; `cashier` →
   `cashier|manager|owner`; `manager` → `manager|owner`; `owner` → `owner`;
   anything else → false). Verified by `pnpm test tests/db/rls-profiles.test.ts`
   exercising the full 4×4 caller-role × target matrix.
6. `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY` is set, and the four
   canonical policies are present with stable names:
   - `profiles_select_self_or_staff` — `select using (id = auth.uid() or auth.role_at_least('cashier'))`
   - `profiles_update_self_or_manager` — `update using (id = auth.uid() or auth.role_at_least('manager'))` with a `with check (id = auth.uid() or auth.role_at_least('manager'))` clause
   - `profiles_delete_manager` — `delete using (auth.role_at_least('manager'))`
   - **No insert policy.** RLS denies inserts by default; signup runs through
     the service-role key in a server-side handler (deferred to ADR-0002).
   Verified by the migration shape test (policy names + commands present) and
   the RLS test suite (cross-tenant denial + privilege-escalation + anon-INSERT
   denial sub-cases per AC8).
7. A `profiles_protect_role_change()` trigger function and `BEFORE UPDATE OF
   role` trigger named **`profiles_protect_role_change`** on `profiles` raise
   `EXCEPTION` with `SQLSTATE '42501'` (`insufficient_privilege`) when the
   calling session's effective caller is not `manager+` and is not the
   service-role bypass path. **Tests assert `error.code === '42501'`; they do
   NOT match the EXCEPTION message string** — message text is implementation
   detail and may change. The exact bypass predicate is a t4 prerequisite (see
   Open Questions §2): the planner reads current Supabase docs and picks one of
   `auth.uid() IS NULL`, `auth.role() = 'service_role'`, or a session-level
   GUC. Whichever predicate is chosen, the pglite stub matches it (test sets
   `test.uid` / `test.role` GUC accordingly). Verified by AC8 sub-cases.
8. RLS unit tests at `tests/db/rls-profiles.test.ts` use **pglite** as the
   test DB. The contract:
   - **Substrate:** `@electric-sql/pglite` (devDependency added by planner).
     `beforeAll` constructs a fresh in-memory Postgres
     (`new PGlite()`), runs the auth-stub setup
     (`tests/db/_fixtures/auth-stub.ts`; see below), then applies
     `supabase/migrations/0002_profiles_and_roles.sql` by passing the file
     contents to pglite's raw-SQL entrypoint, then seeds fixtures.
     `afterAll` closes the pglite instance. No external infra.
   - **Auth stub** (`tests/db/_fixtures/auth-stub.ts`): runs
     `CREATE SCHEMA IF NOT EXISTS auth;`
     plus
     `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;`
     and
     `CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('test.role', true), ''), 'authenticated') $$;`.
     Exports a helper `set_test_uid(pglite, uuid | null)` that runs
     `select set_config('test.uid', $1::text, true)` and similarly
     `set_test_role(pglite, role | null)` for `test.role`. Identity is
     switched per-test by calling these helpers.
   - **Service-role bypass simulation:** because there is no Supabase auth
     in pglite, "service-role" is simulated by clearing `test.uid` (so
     `auth.uid()` returns NULL) AND/OR setting `test.role = 'service_role'`,
     matching whichever production predicate the planner picks at concern
     §2. Fixture seeding itself runs without auth context (postgres
     superuser session in pglite); it is RLS-bypassed because the seed
     statements run before any policies engage on those rows. RLS enforcement
     is exercised by the per-test queries that switch identity first.
   - **Env vars:** the test suite does **not** require
     `SUPABASE_SERVICE_ROLE_KEY` (or any other Supabase env var) — pglite
     is local. Removing this dependency simplifies Slice 1; production
     env-var-loaded tests are deferred to Slice 4 CI integration.
   - **Sub-cases asserted (each must pass):**
     1. **Cross-tenant SELECT denial:** Member-A authenticated as themselves
        cannot `select` member-B's row → zero rows returned, no error
        (RLS filters silently).
     2. **Cross-tenant UPDATE denial:** Member-A authenticated cannot `update`
        member-B's row → zero rows affected.
     3. **Cross-tenant DELETE denial:** Member-A authenticated cannot
        `delete` any row → zero rows affected.
     4. **Cashier read:** a `cashier`-role caller can `select` any member's
        row.
     5. **Manager write:** a `manager`-role caller can `update` any member's
        row including the `role` column.
     6. **`auth.role_at_least()` 4×4 matrix:** matches the ADR ladder for
        every (caller-role, target) pair.
     7. **Anon SELECT:** anonymous (no JWT — `test.uid` cleared) returns
        zero rows for `select`.
     8. **Anon write:** anonymous `update` / `delete` are denied (zero rows
        affected).
     9. **Anon-INSERT denial (NEW):** anon-key INSERT into `profiles` raises
        SQLSTATE `42501` (RLS denies; no insert policy exists). Verifies the
        "no insert policy" property of AC6.
    10. **Privilege-escalation via own-row update (NEW):** Member-A
        authenticated as themselves UPDATEs their own row to set
        `role = 'manager'`. Expected: trigger raises SQLSTATE `42501`; row
        unchanged. The RLS update policy permits the row update (caller owns
        it) — only the `profiles_protect_role_change` trigger blocks the
        role-column change. This sub-case is the regression test if the
        trigger gets disabled or reordered.
    11. **Trigger-firing-order invariant (NEW):** when an unauthorized
        role-change is attempted on Member-A's row, `updated_at` is NOT
        advanced (the txn aborts; `set_updated_at` either never fires
        because protection fires first alphabetically, or its bump is rolled
        back atomically with the abort).
    12. **Service-role bypass (NEW, predicate-aware):** with `test.uid`
        cleared (or `test.role = 'service_role'`, depending on the predicate
        the planner selects at Open Q §2), an UPDATE that changes `role`
        succeeds. Confirms the bypass path is wired the same way the
        production predicate will be.
9. Migration shape tests at `tests/migrations/profiles-shape.test.ts` parse
   `0002_profiles_and_roles.sql` and assert the structural properties below.
   **Two assertion fidelity tiers** — regex is acceptable for surface-level
   tokens, but anything that depends on SQL semantics uses
   [`pg-query-emscripten`](https://www.npmjs.com/package/pg-query-emscripten)
   (npm package, no native deps, parses to Postgres AST). Both classes are
   asserted in the same test file.
   - **Regex-safe assertions:**
     - filename matches `/^\d{4}_[a-z0-9_]+\.sql$/`;
     - column names presence (substring match for `full_name`, `dob`,
       `phone`, `email`, `role`, `created_at`, `updated_at`);
     - presence of the literal `enable row level security` (case-insensitive)
       on `profiles`;
     - presence of policy name strings: `profiles_select_self_or_staff`,
       `profiles_update_self_or_manager`, `profiles_delete_manager`;
     - presence of trigger name strings: `set_updated_at`,
       `profiles_protect_role_change`;
     - **absence** of any `for insert` policy on `profiles`.
   - **Parser-fidelity assertions (use `pg-query-emscripten` AST):**
     - `profiles_select_self_or_staff.using` clause body references
       `auth.uid()` and the disjunctive `auth.role_at_least('cashier')`;
     - `profiles_update_self_or_manager` has both `using` and `with check`
       clauses, each referencing `auth.uid()` and
       `auth.role_at_least('manager')`;
     - `profiles_delete_manager.using` references
       `auth.role_at_least('manager')`;
     - `profiles_protect_role_change` trigger function body references
       `auth.role_at_least('manager')` and the chosen service-role bypass
       predicate;
     - `role` column has `NOT NULL` and `DEFAULT 'member'`;
     - `id` column has the FK to `auth.users(id)` with `ON DELETE CASCADE`.
10. `pnpm migrate:check` (the existing safety scanner at
    `scripts/check-migration-safety.mjs`) passes on the new migration file
    with no findings.
11. `pnpm typecheck` passes — including any new TypeScript introduced by the
    test substrate or fixture helpers (`@electric-sql/pglite` types,
    `pg-query-emscripten` types, the fixture row types in
    `tests/db/_fixtures/profiles.ts`, the auth-stub helper types in
    `tests/db/_fixtures/auth-stub.ts`). `tsc --noEmit` over the repo must be
    green with these additions; if any of them lack shipped type declarations,
    the planner adds a minimal `.d.ts` ambient module declaration.
12. `pnpm test scripts/conductor/` continues to pass — no conductor regression.

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Tests-first is preferred
where feasible (RLS denial tests can be authored before the policies exist
and used to drive policy authoring).

- **t0 — Dev-dependency bumps + scaffolding.** Add `@electric-sql/pglite` and
  `pg-query-emscripten` to `devDependencies`. Run `pnpm install`. Create the
  empty test fixture files (`tests/db/_fixtures/auth-stub.ts`,
  `tests/db/_fixtures/profiles.ts`) so subsequent tasks can import from a
  stable path. Validate with `pnpm typecheck` (should still be green; nothing
  imports the new stubs yet). **Note:** if the planner discovers that
  `pg-query-emscripten` is not maintained or fails to install, fallback is
  `libpg-query` (newer fork) — either works for the AST assertions. The choice
  is non-load-bearing as long as one of them produces a parsed AST.
- **t1 — Migration: enum + table + indices.** Author the `role_t` enum,
  `profiles` table with FK + cascade, `created_at` / `updated_at` columns. No
  policies, no triggers yet. Validate with `pnpm migrate:check`.
- **t2 — Migration: `set_updated_at` trigger.** Function + trigger named
  `set_updated_at` (alphabetically after `profiles_protect_role_change`). The
  alphabetical name ordering is load-bearing per AC4 — do not rename.
- **t3 — Migration: `auth.role_at_least()` helper.** Author the function
  exactly per the ADR. `security definer`, `stable`. Test the 4×4 matrix
  (acceptance criterion 5) before moving on.
- **t4 — Migration: RLS enable + four policies + role-change protection
  trigger.** **Prerequisite (must resolve before this task starts):** confirm
  the production service-role-detection idiom against current Supabase docs.
  See Open Questions §2 — the candidates are `auth.uid() IS NULL`,
  `auth.role() = 'service_role'`, or a session-level GUC. Wrong predicate is a
  privilege-escalation path. Encode the chosen predicate in the trigger and in
  the auth-stub `set_test_role` / `set_test_uid` semantics. Stable policy
  names per AC6. Insert policy deliberately omitted. Trigger named
  `profiles_protect_role_change` (not `protect_role_change` — the prefix is
  load-bearing for alphabetical ordering per AC4).
- **t5 — Migration shape tests.** `tests/migrations/profiles-shape.test.ts`
  splits assertions into the two fidelity tiers per AC9. Regex-safe assertions
  use simple string/regex match against the migration file content;
  parser-fidelity assertions parse via `pg-query-emscripten` and walk the AST
  for the policy / trigger / column constraints listed in AC9.
- **t6 — RLS integration tests.** `tests/db/rls-profiles.test.ts` uses
  pglite. `beforeAll` does the full pglite setup chain per AC8 (construct,
  install auth stub, apply migration, seed fixtures). Each test calls
  `set_test_uid` / `set_test_role` to assume a role, runs the SQL, and asserts
  the AC8 sub-case. All 12 sub-cases land here.
- **t7 — Test fixtures: `seedProfile` helper.** `tests/db/_fixtures/profiles.ts`
  exports `seedProfile(pglite, overrides: Partial<ProfileRow>): Promise<ProfileRow>`.
  Applies sensible defaults for every v1 column (`full_name`, `dob`, `phone`,
  `email`, `role`) and accepts overrides. **Column-permissive constraint:**
  the helper must **never require columns that are not in the v1 schema**.
  When ADR-0009 (cycle 4) adds `id_verified_at`, `id_doc_path`,
  `member_agreement_signed_at`, `member_number`, the helper stays
  backward-compatible — the new columns flow through as optional fields in
  `Partial<ProfileRow>` (the `ProfileRow` type widens; the defaults stay v1).
  This prevents future cycles from rewriting the fixture every time a column
  lands.
- **t8 — Test runbook documentation.** The RLS test file documents at the top
  how to run it locally (`pnpm test tests/db/rls-profiles.test.ts` — no
  prerequisites; pglite spins up automatically). No `db:reset`, no Docker, no
  Supabase CLI. CI integration with a real Supabase project is explicitly
  deferred to Slice 4 (see Out of scope).

## Touched-files inventory

Best estimate; workers may exceed if needed.

- Create: `supabase/migrations/0002_profiles_and_roles.sql`
- Create: `tests/db/rls-profiles.test.ts`
- Create: `tests/db/_fixtures/profiles.ts` (column-permissive `seedProfile`)
- Create: `tests/db/_fixtures/auth-stub.ts` (pglite `auth.uid()` /
  `auth.role()` stub + `set_test_uid` / `set_test_role` helpers)
- Create: `tests/migrations/profiles-shape.test.ts`
- Modify: `package.json` — add `@electric-sql/pglite` and
  `pg-query-emscripten` (or the `libpg-query` fork — see t0) to
  `devDependencies`. Run `pnpm install` to update `pnpm-lock.yaml`.
- Modify: (no application code changes in this slice)

If the planner determines that an additional ambient `.d.ts` file is needed
for a devDependency that lacks shipped types, that file (e.g.,
`tests/db/_fixtures/types.d.ts`) is in scope. The principle: anything required
to run the acceptance commands deterministically is in scope; anything that
touches production application code is not.

## Risk flags

This is the project's high-risk auto-flag list per the spec-writer template
(linked ADRs ∈ {0003, 0004, 0005, 0006, 0009, 0023}). Phase 1 is expected to
auto-trigger `premortem(mode=task)` on this spec.

- **0003 (this ADR — authorization):** an incorrect RLS policy is the
  difference between "members can't see each other's data" and a privacy
  breach. The acceptance criteria deliberately include cross-tenant denial
  tests, privilege-escalation via own-row update, and anon-INSERT denial —
  not just permitted-access tests — because the bug class is "policy permits
  more than intended." Premortem mandatory.
- **pglite vs production-Supabase fidelity gap (NEW):** pglite is real
  Postgres compiled to WASM, so RLS, triggers, sequences, and SQLSTATE codes
  behave identically. **However**, the Supabase Auth schema (`auth.uid()`,
  `auth.role()`, JWT claims, session GUCs) is replaced with a stub. A real
  Supabase production deployment may behave subtly differently — for example,
  Supabase has been migrating service-role detection toward session GUCs and
  away from `auth.uid() IS NULL`. **Mitigation:** Open Q §2 forces the planner
  to pin the production predicate against current Supabase docs; the stub
  matches that predicate. Slice 2 / cycle 3 (ADR-0002 auth) re-runs the same
  acceptance contract against a real Supabase project once API keys are
  available, providing the cross-validation. This is acceptable for Slice 1
  because the production substrate isn't reachable yet (no API keys, no
  Supabase project provisioned).
- **0006 (audit log) — deferred coupling:** ADR-0003 specifies "every role
  change writes an `audit_log` row in the same transaction (enforced via a
  Postgres trigger on `profiles`)." `audit_log` does not exist yet — it lands
  in cycle 2 (ADR-0006). The `profiles_protect_role_change` trigger in this
  slice **only blocks unauthorized role changes**; it does not write to
  `audit_log`. The audit-write side of the trigger is explicitly deferred and
  must be added when ADR-0006's migration ships. Tracked in Out of scope.
- **0007 (secrets) — service-role key handling (re-scoped):** the Slice 1
  test suite does **not** use `SUPABASE_SERVICE_ROLE_KEY` (pglite is local).
  When Slice 4 adds CI integration against a real Supabase project, the env
  var contract must be re-introduced and tested. Not a Slice 1 risk.
- **Naming convention drift:** the existing migration is `0001_feature_flags.sql`
  (four-digit prefix). This migration must be `0002_profiles_and_roles.sql` to
  match. Mistake here breaks ordering for every subsequent migration. The
  migration shape test asserts the filename pattern explicitly.
- **Trigger name ordering (NEW):** `profiles_protect_role_change` and
  `set_updated_at` are both BEFORE UPDATE triggers on `profiles`. Postgres
  fires them alphabetically by name. The protection trigger's `'p'` prefix
  comes before `set_updated_at`'s `'s'` prefix, so protection fires first by
  default. Future renames that invert this ordering would let `updated_at`
  bump on rolled-back unauthorized updates, which (combined with a future
  ADR-0006 audit-log integration that hooks `set_updated_at`) could write an
  audit row for a change that didn't actually persist. AC8 sub-case 11
  asserts the invariant explicitly.
- **Postgres enum vs CHECK-constrained text:** Postgres enums are slightly
  less flexible (can't drop values without a complex dance) but are the
  ADR-idiomatic choice and Supabase's recommended pattern. This spec adopts
  enum; if the planner downgrades to CHECK-constrained text, the migration
  shape test must be updated to match. (Open Q #1 stays open as a
  planner-time defaultable decision.)

## Out of scope

What this slice deliberately does **not** do. Each item is bound to a future
ADR cycle.

- **Audit log on role changes.** ADR-0003 specifies it; ADR-0006 owns the
  `audit_log` table. The `profiles_protect_role_change` trigger in this slice
  only enforces authorization. The audit-write half lands in cycle 2 when
  ADR-0006's migration adds the table; that migration must extend (or replace)
  this trigger to write the `audit_log` row in the same transaction.
- **MFA enforcement on staff routes.** ADR-0003 specifies `aal=aal2`
  middleware checks for `cashier+` routes. No middleware ships in this slice
  because no staff routes exist yet. ADR-0027 (cycle 5, admin dashboard)
  introduces `app/(staff)/layout.tsx` and the MFA gate.
- **Auth signup flow.** Insert into `profiles` is RLS-denied by design in this
  slice. Members cannot yet sign up. ADR-0002 (cycle 3) introduces the signup
  Server Action that runs with the service-role key and creates the row.
- **Profile column additions.** `member_number`, `id_verified_at`,
  `id_doc_path`, `member_agreement_signed_at`, `sms_opt_in_at`, `deleted_at`
  are listed in `docs/spec.md` but each is owned by a later ADR migration:
  `id_verified_at` / `id_doc_path` / `member_agreement_signed_at` /
  `member_number` → ADR-0009 (cycle 4); `sms_opt_in_at` → ADR-0025 (Slice 3);
  `deleted_at` → ADR-0023 (cycle 6, soft-delete). Adding any of them here
  steals scope from those cycles. The fixture's column-permissive design (t7)
  ensures those additions don't break the Slice 1 fixture.
- **RLS on other tables.** This slice enables RLS on `profiles` only.
  `feature_flags` (existing) intentionally has no RLS per its ADR-0020 spec.
  Other tables (`memberships`, `time_wallets`, `time_ledger`, etc.) ship in
  their own slices with their own policies.
- **Service-role admin client wrapper.** `lib/supabase/admin.ts` is referenced
  by ADR-0007 but does not exist yet. ADR-0002 (cycle 3, auth) introduces it
  alongside `lib/supabase/{server,client,middleware}.ts`. Slice 1's tests
  do **not** instantiate a Supabase admin client at all — they use pglite
  directly with the auth-stub. Production code lives in cycle 3.
- **Env-var-loaded service-role tests (production).** With pglite the test
  suite needs no env vars. Tests that exercise a real Supabase project via
  `SUPABASE_SERVICE_ROLE_KEY` are deferred to Slice 4 CI integration —
  they require API keys (blocked) and a Supabase project (blocked).
- **Real-Supabase integration tests (Slice 4 CI integration).** The pglite +
  auth-stub combination is high-fidelity but not identical to production
  Supabase. A second pass running the same acceptance contract against a real
  Supabase project lands in Slice 4 alongside CI integration.
- **CI integration of `pnpm test tests/db/`.** Running RLS tests in CI was
  previously blocked on a Supabase test container (ADR-0017); with pglite
  there is now no infrastructure barrier — the tests run on any node host. CI
  wiring of these specific tests is still Slice 4 scope (CI-test-matrix
  decisions belong there, not here).
- **Soft-delete semantics on `profiles`.** ADR-0023 owns this. Deleting a
  profile in this slice is a hard delete. The `profiles_delete_manager` policy
  exists for admin cleanup of test data, not for member-initiated deletion.
- **`role` enum value additions** (e.g., `superadmin`, `auditor`). Not in the
  ADR. Out of scope; reconsider in a later ADR if multi-location support
  arrives.

## Open questions

Surfaced for resolution during planning. **Defaults are the spec author's
recommendation; the planner confirms before t-zero.**

1. **Postgres enum vs CHECK-constrained text for `role`.** Default: enum (per
   ADR + Supabase idiom). If the planner prefers CHECK-text for easier value
   evolution, AC2 / AC3 / migration shape test must be updated. **Default:
   enum.** Status: open.
2. **Service-role bypass predicate in the role-change trigger** —
   **PROMOTED to t4 prerequisite.** Status: must-resolve before t4 lands.
   Action: planner reads current Supabase docs and picks one of:
   - `auth.uid() IS NULL` (the historical "service-role key has no user"
     pattern);
   - `auth.role() = 'service_role'` (the JWT-claim-based pattern);
   - a session-level GUC (`current_setting('request.jwt.claims', true)::jsonb
     ->> 'role' = 'service_role'` or similar).
   The trigger predicate is `auth.role_at_least('manager') OR
   <bypass-predicate>`. Wrong predicate is a privilege-escalation path. With
   pglite, the test suite simulates either predicate by setting the
   corresponding GUC (`test.uid` or `test.role`) — the planner picks the
   production predicate from Supabase docs and the stub matches.
3. **RLS test substrate** — **RESOLVED.** Choice: `@electric-sql/pglite`
   (in-process WASM Postgres). Rationale: real Postgres engine, no Docker
   daemon, no Supabase CLI, no network. Auth schema is stubbed via
   `tests/db/_fixtures/auth-stub.ts` per AC8. Production-Supabase fidelity
   gap is documented in Risk Flags and revalidated in Slice 4.
4. **Enum naming.** **RESOLVED.** Choice: `role_t`. Rationale: column is
   named `role`, suffix disambiguates type from column. (Closing this open
   question saves the planner a round-trip; rename is cheap if a later ADR
   prefers `user_role`.)

## Iteration history

- **Revision 1 (2026-05-09):** initial spec authored.
- **Revision 2 (2026-05-09):** addressed all 12 critic concerns from
  `.conductor/0003/dispatches/0002-critic-spec.md`. Substrate switched from
  local Supabase (Docker-dependent) to pglite (in-process). AC8 expanded with
  privilege-escalation, anon-INSERT, trigger-ordering, and predicate-aware
  service-role-bypass sub-cases. AC9 split into regex-safe vs parser-fidelity
  tiers. Open Q §2 promoted to t4 prerequisite. Open Q §3 RESOLVED with
  pglite. Open Q §4 RESOLVED with `role_t`. Env-var-loaded service-role
  tests removed from this slice and pushed to Slice 4. SQLSTATE-not-message
  assertion contract pinned in AC7. Trigger name ordering invariant pinned
  in AC4 / AC8. Fixture column-permissive constraint pinned in t7. AC11
  tightened to require typecheck across newly-introduced test code.
