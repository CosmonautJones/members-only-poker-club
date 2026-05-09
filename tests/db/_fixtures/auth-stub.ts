/**
 * pglite auth-schema stub — bridges pglite (no Supabase Auth) to the RLS
 * policies / triggers landed in t1 of ADR-0003 (which all call `auth.uid()`
 * and `auth.role()`).
 *
 * Stub surface validated against current Supabase docs as of 2026-05-09.
 * Future cycles MUST diff this against current Supabase behavior before
 * relying on it. See:
 *   https://supabase.com/docs/guides/database/postgres/row-level-security
 *
 * --------------------------------------------------------------------------
 * BYPASS PREDICATE (load-bearing — see ADR-0003 spec §AC7, §AC8.12)
 *
 * The t1 production trigger predicate for service-role bypass is:
 *
 *     auth.uid() IS NULL
 *
 * To simulate service-role in tests: call `setTestUid(pg, null)`. Do NOT use
 * `setTestRole` for this — `setTestRole` exercises the `auth.role_at_least()`
 * ladder (member / cashier / manager / owner), NOT service-role bypass. If
 * the production predicate ever changes (cycle 3 / ADR-0002 must re-verify
 * against current Supabase docs), update this stub AND the trigger in
 * `supabase/migrations/0002_profiles_and_roles.sql` in the same commit.
 *
 * CYCLE-3-REVALIDATE: rerun AC8 sub-cases against real Supabase, confirm
 * bypass predicate matches current docs.
 * --------------------------------------------------------------------------
 *
 * STUB SURFACE — kept deliberately minimal (only `auth.uid()` and
 * `auth.role()`). No `auth.jwt()`, no `auth.email()`, no `auth.session_id()`.
 * Adding speculative helpers grows the drift surface against production for
 * no current benefit. Before any future ADR cycle adds new RLS policies that
 * use additional `auth.*` helpers, the planner for that cycle MUST diff this
 * stub against current Supabase docs and extend the stub in the same slice.
 *
 * GUC SCOPING — helpers use `set_config(key, value, false)` (third arg is
 * `is_local`; `false` = session-scoped, NOT transaction-local). pglite runs
 * `pg.query()` calls in implicit transactions, so transaction-local GUCs
 * would evaporate before the next statement. Session-scoped GUCs persist
 * for the life of the `PGlite` instance — call `resetAuthStub(pg)` in
 * `beforeEach` to prevent identity leaks between tests.
 *
 * NULLIF GUARD — `auth.uid()` body is
 * `NULLIF(current_setting('test.uid', true), '')::uuid` verbatim from spec
 * AC8. The empty-string guard is load-bearing: `current_setting` with the
 * `is_missing_ok = true` flag returns `''` for unset GUCs in real Postgres,
 * and `''::uuid` raises `invalid input syntax for type uuid`. NULLIF
 * coerces `''` → NULL before the cast. Do NOT simplify by dropping NULLIF.
 */

import type { PGlite } from '@electric-sql/pglite';

/**
 * Strict union of role-claim values the test harness may set on `auth.role()`.
 * Narrowed deliberately so a test author cannot accidentally pass `'admin'`
 * (which would silently fail `auth.role_at_least()` with no warning — a
 * silent denial bug).
 */
export type StaffRole = 'cashier' | 'manager' | 'owner';
export type AuthRole = 'authenticated' | 'service_role' | 'anon' | StaffRole;

/**
 * Apply the auth-schema stub to a fresh PGlite instance.
 *
 * Re-creates Supabase Auth's `auth.uid()` and `auth.role()` against test-only
 * GUCs (`test.uid` and `test.role`). Runs smoke tests after install to catch
 * pglite/postgres semantic divergence on day one — throws with a clear
 * message if any invariant fails.
 *
 * MUST be called in the test harness's `beforeAll` before any migration that
 * references `auth.uid()` or `auth.role()` is applied.
 */
export async function setupAuthStub(pg: PGlite): Promise<void> {
  // 1. Auth schema — Supabase ships this; pglite does not.
  await pg.query('CREATE SCHEMA IF NOT EXISTS auth');

  // 2. auth.uid() — returns uuid (NOT text — production Supabase returns
  //    uuid, and the RLS predicate `id = auth.uid()` would mis-compare under
  //    a text return type since Postgres does not auto-cast uuid = text).
  //    NULLIF guard: see file header for why the empty-string guard is
  //    load-bearing.
  await pg.query(`
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$
  `);

  // 3. auth.role() — returns text. Production Supabase defaults the role
  //    claim to 'authenticated' for any logged-in user; COALESCE matches
  //    that behavior when `test.role` is unset/empty.
  await pg.query(`
    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$ SELECT COALESCE(NULLIF(current_setting('test.role', true), ''), 'authenticated') $$
  `);

  // 4. Clear both GUCs so the stub starts in a known state. Session-scoped
  //    (`is_local = false`) — see file header on GUC SCOPING.
  await pg.query("SELECT set_config('test.uid', '', false)");
  await pg.query("SELECT set_config('test.role', '', false)");

  // 5. Smoke test — assert pglite GUC session-scoping behaves like Postgres.
  //    pglite < 0.2.x had known session-model bugs where GUCs failed to
  //    persist across `pg.query()` calls; if that regresses, every "anon"
  //    test would silently inherit identity from the previous test.
  await pg.query("SELECT set_config('test.smoke', 'X', false)");
  const smokeSet = await pg.query<{ v: string | null }>(
    "SELECT current_setting('test.smoke', true) AS v",
  );
  if (smokeSet.rows[0]?.v !== 'X') {
    throw new Error(
      'auth-stub: pglite GUC session-scoping broken — set_config did not persist across queries. ' +
        'Identity isolation between tests cannot be guaranteed. ' +
        `Got: ${JSON.stringify(smokeSet.rows[0]?.v)} (expected 'X').`,
    );
  }
  await pg.query("SELECT set_config('test.smoke', '', false)");

  // 6. Smoke test — auth.uid() returns NULL when test.uid is unset.
  //    This is the bypass-predicate invariant: t1's trigger uses
  //    `auth.uid() IS NULL`. If this assertion fails, the bypass simulation
  //    is broken and every service-role test will lie.
  const uidProbe = await pg.query<{ is_null: boolean }>(
    'SELECT auth.uid() IS NULL AS is_null',
  );
  if (uidProbe.rows[0]?.is_null !== true) {
    throw new Error(
      'auth-stub: auth.uid() did not return NULL when test.uid was cleared. ' +
        'Bypass-predicate simulation is broken — service-role tests would be unreliable. ' +
        `Got: ${JSON.stringify(uidProbe.rows[0])}.`,
    );
  }

  // 7. Smoke test — auth.role() defaults to 'authenticated' when test.role
  //    is unset. This matches production Supabase behavior for any logged-in
  //    user without an explicit role claim.
  const roleProbe = await pg.query<{ r: string }>(
    'SELECT auth.role() AS r',
  );
  if (roleProbe.rows[0]?.r !== 'authenticated') {
    throw new Error(
      `auth-stub: auth.role() default was not 'authenticated'. ` +
        `Got: ${JSON.stringify(roleProbe.rows[0]?.r)}.`,
    );
  }

  // 8. Smoke test — return-type drift detection. If a future refactor
  //    changes auth.uid() to RETURNS text, the RLS policy `id = auth.uid()`
  //    silently misbehaves under uuid = text comparison. Pin the signature.
  const sigProbe = await pg.query<{ rt: string }>(`
    SELECT pg_get_function_result(p.oid) AS rt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  `);
  if (!sigProbe.rows[0]?.rt?.includes('uuid')) {
    throw new Error(
      `auth-stub: auth.uid() return type drifted from 'uuid'. ` +
        `Got: ${JSON.stringify(sigProbe.rows[0]?.rt)}.`,
    );
  }
}

/**
 * Set the simulated `auth.uid()` for subsequent queries on this PGlite
 * instance. Pass `null` to clear (simulates service-role bypass — `auth.uid()`
 * returns NULL).
 *
 * Session-scoped (`is_local = false`) — persists across `pg.query()` calls
 * until cleared. Always call `resetAuthStub(pg)` in `beforeEach` to prevent
 * identity leaks between tests.
 */
export async function setTestUid(
  pg: PGlite,
  uid: string | null,
): Promise<void> {
  await pg.query("SELECT set_config('test.uid', $1, false)", [uid ?? '']);
}

/**
 * Set the simulated `auth.role()` for subsequent queries on this PGlite
 * instance. Pass `null` to clear (resets `auth.role()` to its default of
 * `'authenticated'` via the COALESCE in the stub function body).
 *
 * NOTE: this does NOT trigger the protection-trigger bypass — only
 * `setTestUid(pg, null)` does. The t1 trigger predicate is
 * `auth.uid() IS NULL`, NOT `auth.role() = 'service_role'`. This helper
 * exists to exercise the `auth.role_at_least()` ladder
 * (member / cashier / manager / owner), nothing more.
 *
 * The `role` parameter type is a strict union — passing an unknown role like
 * `'admin'` is a compile-time error, preventing silent denial bugs.
 */
export async function setTestRole(
  pg: PGlite,
  role: AuthRole | null,
): Promise<void> {
  await pg.query("SELECT set_config('test.role', $1, false)", [role ?? '']);
}

/**
 * Reset both auth GUCs to empty (clears `test.uid` and `test.role`).
 *
 * MUST be called by the test runner in `beforeEach` (not just `afterEach` —
 * defense in depth) to prevent identity from leaking between tests on the
 * shared PGlite session.
 */
export async function resetAuthStub(pg: PGlite): Promise<void> {
  await setTestUid(pg, null);
  await setTestRole(pg, null);
}
