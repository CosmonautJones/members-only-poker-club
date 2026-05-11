/**
 * RLS test helpers — role-switching boilerplate lifted from cycle 1's
 * `tests/db/rls-profiles.test.ts` so cycle 2 (ADR-0006 audit log) and any
 * downstream RLS suite can reuse the exact same role-switching contract
 * without re-deriving it.
 *
 * --------------------------------------------------------------------------
 * SUBSTRATE NOTE — pglite default role has BYPASSRLS
 *
 * pglite's default `postgres` user has BYPASSRLS, which short-circuits ALL
 * policy evaluation regardless of `FORCE ROW LEVEL SECURITY` on the table.
 * In production Supabase, the `authenticated` and `anon` roles do NOT have
 * BYPASSRLS — they are subject to RLS. To match production semantics, every
 * per-test query in an RLS suite runs as `app_authenticated` (NOBYPASSRLS).
 * Seeding runs as superuser, which mirrors how Supabase's service-role
 * bypasses RLS for server-side seeds. Service-role bypass tests explicitly
 * `RESET ROLE` back to superuser to simulate that path.
 *
 * --------------------------------------------------------------------------
 * RELATIONSHIP TO `auth-stub.ts`
 *
 * `auth-stub.ts` owns the SQL-level GUC primitives (`setTestUid`,
 * `setTestRole`, `resetAuthStub`) — those simulate `auth.uid()` and
 * `auth.role()` at the function-body level. This file owns the higher-level
 * Postgres-role layer (CREATE ROLE, GRANT, SET ROLE) that mirrors Supabase's
 * `authenticated` vs service-role connection model. The two layers compose:
 * `asServiceRole` flips both axes (Postgres role + auth.uid()),
 * `asAuthenticated` flips Postgres role and optionally the auth GUCs.
 *
 * --------------------------------------------------------------------------
 * VERBATIM-FROM-CYCLE-1 INVARIANT
 *
 * The implementations below are byte-identical to cycle 1's inlined helpers
 * with three forward-compatible additions:
 *   (a) `setupAppAuthenticatedRole` — the inlined `CREATE ROLE … GRANT …`
 *       block from cycle 1's beforeAll, parameterized over tables / sequences
 *       / functions / schemas so cycle 2 can call with
 *       `tables: ['profiles', 'audit_log']` and
 *       `sequences: ['audit_log_id_seq']`.
 *   (b) `asAuthenticated` accepts optional `uid` / `role` args. Cycle 1's
 *       callsites pass none (just SET ROLE) — preserved. Cycle 2 may pass
 *       both to consolidate the per-test identity setup.
 *   (c) `withRollback` is generic over the body's return type. Cycle 1's
 *       callsites all return void — preserved. Forward-compatible for
 *       suites that want the return value.
 * No semantic change to cycle 1 behavior: same SQL contract, same role
 * attributes (NOBYPASSRLS NOINHERIT), same BEGIN/ROLLBACK pattern in
 * `withRollback`, same `RESET ROLE` + `resetAuthStub` pattern in
 * `asServiceRole`.
 */

import type { PGlite } from '@electric-sql/pglite';
import { resetAuthStub, setTestRole, setTestUid, type AuthRole } from './auth-stub';

/**
 * Options for {@link setupAppAuthenticatedRole}.
 *
 * Cycle 1 uses `tables: ['profiles']` plus a fixed function list. Cycle 2
 * uses `tables: ['profiles', 'audit_log']` and `sequences: ['audit_log_id_seq']`.
 */
export interface RoleSetupOptions {
  /** Tables to GRANT SELECT/INSERT/UPDATE/DELETE on. Required. */
  tables: string[];
  /** Sequences to GRANT USAGE+SELECT on. Optional. */
  sequences?: string[];
  /**
   * Functions to GRANT EXECUTE on. Optional. Defaults to the cycle 1 set:
   * `auth.role_at_least(text)`, `auth.uid()`, `auth.role()`.
   */
  functions?: string[];
  /** Schemas to GRANT USAGE on. Defaults to `['auth', 'public']`. */
  schemas?: string[];
}

const DEFAULT_FUNCTIONS = ['auth.role_at_least(text)', 'auth.uid()', 'auth.role()'];
const DEFAULT_SCHEMAS = ['auth', 'public'];

// pglite multi-statement raw-SQL entrypoint — cast to a narrow function type
// so the suite reads like the cycle-1 inlined block (which used the same
// raw-SQL entrypoint via a small type-cast helper).
type RawSqlBlock = (s: string) => Promise<unknown>;

async function runSqlBlock(pg: PGlite, sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: RawSqlBlock }).exec;
  await runner.call(pg, sql);
}

/**
 * Apply the cycle-1 role-switching boilerplate to a PGlite instance.
 *
 * Creates the `app_authenticated` role with `NOBYPASSRLS NOINHERIT`, then
 * GRANTs USAGE on the requested schemas, SELECT/INSERT/UPDATE/DELETE on the
 * requested tables, USAGE+SELECT on the requested sequences, and EXECUTE on
 * the requested functions.
 *
 * Caller MUST invoke this AFTER applying migrations and seeding fixtures
 * (the seeding runs as superuser, which mirrors Supabase's service-role
 * bypass for server-side seeds; per-test queries then SET ROLE to
 * `app_authenticated` for production-fidelity RLS evaluation).
 *
 * Idempotent on the role: uses a DO-block guard so a re-run inside the same
 * PGlite instance is safe.
 *
 * Reusable across cycles:
 *   cycle 1: `setupAppAuthenticatedRole(pg, { tables: ['profiles'] })`
 *   cycle 2: `setupAppAuthenticatedRole(pg, { tables: ['profiles', 'audit_log'], sequences: ['audit_log_id_seq'] })`
 */
export async function setupAppAuthenticatedRole(
  pg: PGlite,
  options: RoleSetupOptions,
): Promise<void> {
  const schemas = options.schemas ?? DEFAULT_SCHEMAS;
  const functions = options.functions ?? DEFAULT_FUNCTIONS;
  const sequences = options.sequences ?? [];

  // Role creation guarded by a DO block so re-running the helper inside the
  // same PGlite instance does not raise "role already exists". Postgres has
  // CREATE ROLE IF NOT EXISTS in 9.5+ but the explicit DO guard mirrors what
  // production migration tooling typically uses.
  await runSqlBlock(
    pg,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
        CREATE ROLE app_authenticated NOBYPASSRLS NOINHERIT;
      END IF;
    END
    $$;
  `,
  );

  const grants: string[] = [];
  for (const schema of schemas) {
    grants.push(`GRANT USAGE ON SCHEMA ${schema} TO app_authenticated;`);
  }
  for (const table of options.tables) {
    grants.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO app_authenticated;`);
  }
  for (const sequence of sequences) {
    grants.push(`GRANT USAGE, SELECT ON SEQUENCE ${sequence} TO app_authenticated;`);
  }
  for (const fn of functions) {
    grants.push(`GRANT EXECUTE ON FUNCTION ${fn} TO app_authenticated;`);
  }
  // Cycle 1 also granted SELECT, INSERT on auth.users and SELECT on
  // pg_catalog.pg_trigger. Those are cycle-1-suite-specific (auth.users seed
  // path runs under app_authenticated for AC8.9, pg_trigger introspection
  // for AC8.11). Suites that need them MUST pass them via the `tables` /
  // `functions` knobs OR issue the GRANT directly after this helper. Keeping
  // them out of the default set avoids leaking cycle-1-specific permissions
  // into cycle 2's surface area.

  await runSqlBlock(pg, grants.join('\n'));
}

/**
 * Switch the connection to `app_authenticated` (NOBYPASSRLS) so subsequent
 * queries run subject to RLS. Optionally also pin `auth.uid()` and
 * `auth.role()` for the per-test identity.
 *
 * Cycle 1 callers pass no uid/role — they call this to restore the role after
 * a service-role round-trip and then issue `setTestUid(pg, ...)` separately.
 * Cycle 2 callers may pass uid/role to consolidate.
 *
 * Idempotent on the role.
 */
export async function asAuthenticated(
  pg: PGlite,
  uid?: string | null,
  role?: AuthRole | null,
): Promise<void> {
  await pg.query('SET ROLE app_authenticated');
  if (uid !== undefined) {
    await setTestUid(pg, uid);
  }
  if (role !== undefined) {
    await setTestRole(pg, role);
  }
}

/**
 * Switch to "service-role" semantics for sentinel / snapshot / verification
 * reads: revert to the superuser (BYPASSRLS) AND clear `auth.uid()` /
 * `auth.role()` GUCs via `resetAuthStub`. Mirrors the production service-role
 * connection that performs server-side seeds, snapshots, and bypass-permitted
 * writes (ADR-0003 spec AC8.12).
 *
 * The follow-up `asAuthenticated()` MUST be called before any subsequent
 * RLS-subject query in the same test, otherwise the test silently falls back
 * to BYPASSRLS and the policy gate is not exercised.
 */
export async function asServiceRole(pg: PGlite): Promise<void> {
  await pg.query('RESET ROLE');
  await resetAuthStub(pg);
}

/**
 * Wrap a body in BEGIN / ROLLBACK so any mutations the body issues roll back
 * — even on success — keeping seeded fixtures intact for downstream tests.
 *
 * Use for any test that issues UPDATE / DELETE / INSERT against an
 * RLS-guarded table. SELECT-only tests can skip this.
 *
 * NOTE: `pg.transaction()` (the pglite higher-level API) commits on success
 * and rolls back on throw — we need rollback ALWAYS so test ordering doesn't
 * affect downstream row state. Hence the manual BEGIN / ROLLBACK pair.
 *
 * Generic over the body's return type so callers that want to surface a
 * computed value out of the rolled-back txn can do so. Cycle 1 callers
 * always return void, which `Promise<void>` satisfies.
 */
export async function withRollback<T>(pg: PGlite, body: () => Promise<T>): Promise<T> {
  await pg.query('BEGIN');
  try {
    return await body();
  } finally {
    // Always rollback — even on success — so mutations don't leak across
    // tests on the shared pglite session.
    await pg.query('ROLLBACK');
  }
}
