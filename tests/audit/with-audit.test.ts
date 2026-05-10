/**
 * Helper unit tests for `lib/audit/withAudit.ts` (ADR-0006 cycle 2, AC9).
 *
 * Run locally:    pnpm test tests/audit/with-audit.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 * No Docker. No Supabase CLI. No network.
 *
 * Spec: docs/specs/0006-audit-log-implementation.md AC9 (8 sub-cases).
 * Helper under test: lib/audit/withAudit.ts (cycle 2 t2, attempt 2 — caller
 * owns the transaction; the helper assumes `tx` is already a transaction-
 * scoped client and does NOT issue BEGIN/COMMIT itself).
 *
 * Substrate: @electric-sql/pglite (real Postgres compiled to WASM — RLS,
 * triggers, sequences, SQLSTATE codes, transaction semantics all behave
 * as in production). Pure mocks were considered and REJECTED — only a
 * real txn catches the load-bearing AC9.3 invariant
 * ("audit-INSERT-throws rolls back the mutation").
 *
 * Transaction discipline (load-bearing — see t6 attempts 2→3):
 *   Each `it()` that exercises `withAudit` wraps the call in
 *   `pg.transaction(async (tx) => withAudit(txClient, params, mutate))`.
 *   pglite's `pg.transaction(callback)` API
 *     - BEGINs before the callback;
 *     - COMMITs on resolve;
 *     - ROLLBACKs on reject.
 *   This delivers proper atomicity AND test isolation — a thrown
 *   `withAudit` rolls back inside the wrapper, so the connection never
 *   ends up in an aborted-tx state that would cascade into subsequent
 *   tests. Manual `pg.query('BEGIN'/'COMMIT')` calls do NOT compose with
 *   pglite's connection model and were tried + rejected in t6 attempt 2.
 *
 * Caller-axis discipline (load-bearing — AC9 preamble):
 *   - sub-cases 1, 2, 3, 5, 6, 7  → app_authenticated + auth.uid()=manager
 *   - sub-case 4                 → service-role (RESET ROLE + cleared test.uid)
 *   - sub-case 8                 → static source-text check, no DB
 *
 * Each it() that touches the DB explicitly pins its Postgres role at the
 * top via `asAuthenticated(pg, manager)` or `asServiceRole(pg)` — mixing
 * roles in one sub-case is a fidelity bug.
 *
 * Assertion contract: SQLSTATE assertions match `error.code`, never the
 * message text. `expect.assertions(N)` declared on every test that uses
 * `rejects.toMatchObject` so the rejection branch is required to run.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Neutralise `server-only` so importing the audit helper does not throw
// under vitest's happy-dom environment. (`server-only` is a build-time
// guard in Next.js — its client entry throws by design; it is irrelevant
// inside a unit-test process.) `vi.mock` is hoisted by vitest, so this
// runs before the `withAudit` import below resolves the package.
// Mirrors the existing project pattern in tests/seo/*-jsonld.test.ts.
// AC9.8's source-text assertion is unaffected — it reads the helper file
// with `readFileSync`, not by importing it.
vi.mock('server-only', () => ({}));

import {
  withAudit,
  type TransactionClient,
  type WithAuditMutateResult,
} from '../../lib/audit/withAudit';
import { setupAuthStub, resetAuthStub } from '../db/_fixtures/auth-stub';
import { seedProfile } from '../db/_fixtures/profiles';
import {
  setupAppAuthenticatedRole,
  asAuthenticated,
  asServiceRole,
} from '../db/_fixtures/rls-helpers';

// Path resolution that works on Windows (backslash-safe via path.resolve).
const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const MIG_0002 = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0002_profiles_and_roles.sql',
);
const MIG_0003 = resolve(TEST_DIR, '..', '..', 'supabase', 'migrations', '0003_audit_log.sql');
const HELPER_FILE = resolve(TEST_DIR, '..', '..', 'lib', 'audit', 'withAudit.ts');

let pg: PGlite;

// Helper: run a multi-statement SQL block via pglite's raw-SQL entrypoint.
// Wrapping the call here keeps the rest of the file using `pg.query()` for
// parameterized single statements; this helper is the only place that
// touches the multi-statement path (for migration application + the
// CHECK-constraint scaffold installed in beforeAll).
async function runSqlBlock(sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> }).exec;
  await runner.call(pg, sql);
}

// Module-scope seeded uuids — populated in beforeAll, reused across describes.
// We need at least one manager (for sub-cases 1, 2, 3, 5, 6, 7 where the
// caller axis is `app_authenticated` with `auth.uid()` set to a real seeded
// non-NULL user) and one member to act as the mutation target.
let memberA = '';
let manager = '';

// Adapter that makes a pglite `Transaction` (the value pg.transaction(cb)
// hands to its callback) satisfy the helper's `TransactionClient`
// interface (`query(sql, params): Promise<{ rows: unknown[] }>`).
//
// pglite's Transaction.query<T> returns `Results<T>` which has `rows`
// plus other fields. The helper only inspects `rows`, but the interface
// narrows the return type — explicitly wrapping makes the contract clear
// and shields the helper from any future PGlite return-shape additions.
//
// `tx` is typed as the same shape as `PGlite.query` here; using a
// structural query-only type avoids importing the internal `Transaction`
// type alias and keeps the adapter driver-agnostic.
interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
function txClient(tx: PgliteTxLike): TransactionClient {
  return {
    query: async (sql, params) => {
      const r = await tx.query(sql, params);
      return { rows: r.rows as unknown[] };
    },
  };
}

beforeAll(async () => {
  pg = new PGlite();

  // 1. Auth-stub FIRST — creates schema `auth` plus auth.uid() / auth.role()
  //    bound to the test.uid / test.role GUCs.
  await setupAuthStub(pg);

  // 2. Stub auth.users — the cycle-1 migration FK target. Same minimal shape
  //    as the cycle-1 RLS suite uses.
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  // 3. Apply BOTH migrations in order: cycle 1 first (introduces profiles +
  //    auth.role_at_least + the trigger declaration), then cycle 2 (adds
  //    audit_log + replaces the trigger function body).
  await runSqlBlock(readFileSync(MIG_0002, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0003, 'utf8'));

  // 4. Seed a manager + a target member. Each needs a real auth.users row
  //    first (FK constraint), then a matching profile.
  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@with-audit-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  manager = await seedAs('manager', 'manager');

  // 5. Install the contrived CHECK constraint that AC9.3 uses to simulate
  //    a server-side audit-INSERT failure WITHOUT triggering RLS denial
  //    (which would contradict AC9.4's setup and is a fidelity bug per
  //    the spec preamble). The constraint rejects rows whose `action`
  //    matches the `__force_fail__` sentinel; the sub-case calls
  //    `withAudit({ action: '__force_fail__', ... })` from inside a
  //    mutate that has already mutated a profile row, and asserts the
  //    profile mutation rolled back (proving the single-tx invariant).
  //
  //    The CHECK violation produces SQLSTATE 23514 — a server-side error,
  //    NOT an RLS denial — which is exactly the failure shape the spec
  //    calls for.
  await runSqlBlock(`
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_test_action_nonempty
      CHECK (action <> '__force_fail__');
  `);

  // 6. Create app_authenticated NOBYPASSRLS role + grants. Audit-log
  //    suite-style grants: SELECT/INSERT/UPDATE/DELETE on profiles and
  //    audit_log, USAGE+SELECT on the audit_log_id_seq sequence (so the
  //    bigserial id can be advanced under app_authenticated INSERTs).
  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log'],
    sequences: ['audit_log_id_seq'],
  });
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  // Clear both GUCs before every test so no test inherits identity from a
  // prior one. Identity must always be set explicitly by the test that
  // uses it. Each it() that touches the DB pins its Postgres role at the
  // top via asAuthenticated/asServiceRole (caller-axis discipline).
  await resetAuthStub(pg);
  await pg.query('SET ROLE app_authenticated');
});

// =============================================================================
// AC9.1 — Happy path.
// Caller axis: app_authenticated + auth.uid()=manager (real seeded user).
// Asserts: withAudit returns the result, exactly one audit_log row written
// with the expected shape under service-role read.
//
// Transaction wrapper: pg.transaction(async (tx) => withAudit(...)) — the
// callback resolves on success, so pglite COMMITs automatically.
// =============================================================================
describe('AC9.1 — happy path', () => {
  it('mutate returns {before,after,result}; helper commits and returns result; exactly 1 audit row visible', async () => {
    await asAuthenticated(pg, manager);

    const targetId = memberA;
    const result = await pg.transaction(async (tx) => {
      return withAudit(
        txClient(tx),
        {
          action: 'profile.test_happy',
          targetType: 'profile',
          targetId,
          actorId: manager,
        },
        async (txInner): Promise<WithAuditMutateResult<{ ok: true; n: number }>> => {
          // Capture before — txInner IS the same transaction-scoped client
          // the wrapper handed in (the helper does NOT promote/wrap it).
          const beforeRead = await txInner.query('SELECT full_name FROM profiles WHERE id = $1', [
            targetId,
          ]);
          const beforeRow = beforeRead.rows[0] as { full_name: string };

          // Mutate.
          await txInner.query(`UPDATE profiles SET full_name = $1 WHERE id = $2`, [
            'Renamed By Happy Path',
            targetId,
          ]);

          // Capture after.
          const afterRead = await txInner.query('SELECT full_name FROM profiles WHERE id = $1', [
            targetId,
          ]);
          const afterRow = afterRead.rows[0] as { full_name: string };

          return {
            before: { full_name: beforeRow.full_name },
            after: { full_name: afterRow.full_name },
            result: { ok: true, n: 42 },
          };
        },
      );
    });

    // The helper returns the `result` field verbatim, and pg.transaction
    // forwards its callback's return value verbatim on COMMIT.
    expect(result).toEqual({ ok: true, n: 42 });

    // Service-role read so RLS-filtering can't mask a missing row.
    await asServiceRole(pg);
    const audit = await pg.query<{
      n: number;
      action: string;
      target_id: string;
      actor_id: string | null;
    }>(
      `SELECT COUNT(*)::int AS n,
              MAX(action) AS action,
              MAX(target_id) AS target_id,
              MAX(actor_id::text) AS actor_id
         FROM audit_log
        WHERE action = 'profile.test_happy'`,
    );
    expect(audit.rows[0]!.n).toBe(1);
    expect(audit.rows[0]!.action).toBe('profile.test_happy');
    expect(audit.rows[0]!.target_id).toBe(targetId);
    expect(audit.rows[0]!.actor_id).toBe(manager);
  });
});

// =============================================================================
// AC9.2 — mutate-throws rolls back AND writes no audit row.
// Caller axis: app_authenticated + auth.uid()=manager.
// Helper MUST propagate (NOT catch); under service-role read audit_log
// has zero rows for the sub-case's marker action; profile is unchanged.
//
// Transaction wrapper: pg.transaction rejects when the callback throws,
// auto-issuing ROLLBACK. The connection is NOT left in an aborted-tx
// state, so subsequent tests in the file are not impacted.
// =============================================================================
describe('AC9.2 — mutate throws', () => {
  it('helper propagates the error; rollback leaves no audit row and no profile mutation', async () => {
    expect.assertions(3);
    await asAuthenticated(pg, manager);

    const targetId = memberA;
    const markerAction = 'profile.test_mutate_throws';

    // Snapshot the profile's full_name before so we can prove it didn't
    // change. Read OUTSIDE the transaction-under-test so the read survives
    // independent of that transaction's COMMIT/ROLLBACK fate.
    await asServiceRole(pg);
    const before = await pg.query<{ full_name: string }>(
      'SELECT full_name FROM profiles WHERE id = $1',
      [targetId],
    );
    const beforeName = before.rows[0]!.full_name;
    await asAuthenticated(pg, manager);

    await expect(
      pg.transaction(async (tx) =>
        withAudit(
          txClient(tx),
          {
            action: markerAction,
            targetType: 'profile',
            targetId,
            actorId: manager,
          },
          async (txInner) => {
            // Mutate first — this write must roll back when the throw
            // propagates out of withAudit and out of pg.transaction.
            await txInner.query(`UPDATE profiles SET full_name = $1 WHERE id = $2`, [
              'Should Not Persist',
              targetId,
            ]);
            throw new Error('boom — mutate failed before returning');
            // Unreachable but satisfies the type for the callback.
            return {
              before: null,
              after: null,
              result: undefined as never,
            } as WithAuditMutateResult<never>;
          },
        ),
      ),
    ).rejects.toThrow(/boom/);

    // Service-role read — no audit row was written.
    await asServiceRole(pg);
    const audit = await pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1`,
      [markerAction],
    );
    expect(audit.rows[0]!.n).toBe(0);

    // Service-role read — profile.full_name is unchanged (rollback proof).
    const after = await pg.query<{ full_name: string }>(
      'SELECT full_name FROM profiles WHERE id = $1',
      [targetId],
    );
    expect(after.rows[0]!.full_name).toBe(beforeName);
  });
});

// =============================================================================
// AC9.3 — audit-INSERT throws rolls back the mutation. LOAD-BEARING.
// Caller axis: app_authenticated + auth.uid()=manager (NOT anon, NOT service-role).
// Failure simulated via the contrived CHECK constraint installed in
// beforeAll. The mutate runs a profile UPDATE first, then the helper's
// audit INSERT trips the constraint — must roll back the profile UPDATE.
//
// This sub-case proves the single-transaction invariant. If the worker
// implemented two separate transactions, the profile UPDATE would have
// already committed by the time the audit INSERT failed and this test
// would catch it.
//
// Transaction wrapper: pg.transaction rejects with the CHECK violation;
// pglite issues ROLLBACK; the post-tx service-role read sees the
// pre-mutation full_name.
// =============================================================================
describe('AC9.3 — audit-INSERT throws rolls back the mutation', () => {
  it('CHECK constraint violation on audit INSERT rolls back the profile mutation', async () => {
    expect.assertions(3);
    await asAuthenticated(pg, manager);

    const targetId = memberA;

    // Snapshot the profile's full_name before so we can prove the mutate
    // did NOT commit. Read OUTSIDE the transaction-under-test.
    await asServiceRole(pg);
    const before = await pg.query<{ full_name: string }>(
      'SELECT full_name FROM profiles WHERE id = $1',
      [targetId],
    );
    const beforeName = before.rows[0]!.full_name;
    await asAuthenticated(pg, manager);

    await expect(
      pg.transaction(async (tx) =>
        withAudit(
          txClient(tx),
          {
            // The contrived CHECK constraint rejects exactly this sentinel.
            // SQLSTATE 23514 (check_violation) — server-side error, NOT an
            // RLS denial. The helper does NOT catch; rollback propagates
            // through the pg.transaction wrapper.
            action: '__force_fail__',
            targetType: 'profile',
            targetId,
            actorId: manager,
          },
          async (txInner) => {
            // Mutate FIRST — this write must roll back when the audit INSERT
            // trips the CHECK constraint. If the helper split this into two
            // transactions, this UPDATE would have already committed by the
            // time the audit INSERT failed; the post-rollback service-role
            // read below would see the rename and the test would fail.
            await txInner.query(`UPDATE profiles SET full_name = $1 WHERE id = $2`, [
              'Should Not Persist (CHECK guard)',
              targetId,
            ]);
            return {
              before: { full_name: beforeName },
              after: { full_name: 'Should Not Persist (CHECK guard)' },
              result: { ok: true },
            };
          },
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // Service-role read — no audit row was written for the failed action.
    await asServiceRole(pg);
    const audit = await pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action = '__force_fail__'`,
    );
    expect(audit.rows[0]!.n).toBe(0);

    // Service-role read — profile.full_name is unchanged. THIS is the
    // load-bearing assertion. A two-transaction implementation would
    // have committed the UPDATE before the second txn opened; this read
    // would then see the rename and the test would fail.
    const after = await pg.query<{ full_name: string }>(
      'SELECT full_name FROM profiles WHERE id = $1',
      [targetId],
    );
    expect(after.rows[0]!.full_name).toBe(beforeName);
  });
});

// =============================================================================
// AC9.4 — actorId: null path under service-role.
// Caller axis: service-role (RESET ROLE + cleared test.uid → BYPASSRLS,
// auth.uid() returns NULL). The audit_log_insert_authenticated WITH CHECK
// (auth.uid() IS NOT NULL) clause does NOT evaluate (BYPASSRLS); the
// INSERT writes actor_id IS NULL.
//
// This sub-case proves the policy never fires under service-role and
// matches the trigger's NULL-actor path (AC7.12).
//
// Transaction wrapper: pg.transaction inherits the session-level role
// (RESET ROLE → superuser/BYPASSRLS) and GUCs (test.uid cleared → NULL).
// =============================================================================
describe('AC9.4 — actorId: null path (service-role context)', () => {
  it('writes actor_id IS NULL under BYPASSRLS', async () => {
    await asServiceRole(pg);

    const markerAction = 'profile.test_null_actor';

    const result = await pg.transaction(async (tx) =>
      withAudit(
        txClient(tx),
        {
          action: markerAction,
          targetType: 'profile',
          targetId: memberA,
          actorId: null, // explicit — caller decided system action
        },
        async () => ({
          before: null,
          after: { ok: true },
          result: 'returned-value',
        }),
      ),
    );

    expect(result).toBe('returned-value');

    // Still service-role — read back the row directly.
    const audit = await pg.query<{
      n: number;
      actor_id: string | null;
    }>(
      `SELECT COUNT(*)::int AS n, MAX(actor_id::text) AS actor_id
         FROM audit_log
        WHERE action = $1`,
      [markerAction],
    );
    expect(audit.rows[0]!.n).toBe(1);
    expect(audit.rows[0]!.actor_id).toBeNull();
  });
});

// =============================================================================
// AC9.5 — ip / userAgent are NULL when omitted.
// Caller axis: app_authenticated + auth.uid()=manager.
// Assert audit row has ip IS NULL and user_agent IS NULL — NOT empty
// string, NOT '0.0.0.0'.
// =============================================================================
describe('AC9.5 — ip/userAgent omitted', () => {
  it('audit row stores NULL for ip and user_agent when params do not include them', async () => {
    await asAuthenticated(pg, manager);

    const markerAction = 'profile.test_ip_omitted';

    await pg.transaction(async (tx) =>
      withAudit(
        txClient(tx),
        {
          action: markerAction,
          targetType: 'profile',
          targetId: memberA,
          actorId: manager,
          // ip and userAgent intentionally omitted.
        },
        async () => ({
          before: null,
          after: null,
          result: undefined,
        }),
      ),
    );

    await asServiceRole(pg);
    const audit = await pg.query<{
      ip_is_null: boolean;
      ua_is_null: boolean;
      ip_text: string | null;
      ua_text: string | null;
    }>(
      `SELECT
         (ip IS NULL) AS ip_is_null,
         (user_agent IS NULL) AS ua_is_null,
         ip::text AS ip_text,
         user_agent AS ua_text
       FROM audit_log WHERE action = $1`,
      [markerAction],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.ip_is_null).toBe(true);
    expect(audit.rows[0]!.ua_is_null).toBe(true);
    // Defense-in-depth — explicit non-empty-string / non-'0.0.0.0' guard.
    expect(audit.rows[0]!.ip_text).toBeNull();
    expect(audit.rows[0]!.ua_text).toBeNull();
    expect(audit.rows[0]!.ip_text).not.toBe('');
    expect(audit.rows[0]!.ip_text).not.toBe('0.0.0.0');
  });
});

// =============================================================================
// AC9.6 — ip / userAgent round-trip.
// Caller axis: app_authenticated + auth.uid()=manager.
// (a) when provided, both stored verbatim;
// (b) invalid IP like 'not-an-ip' throws SQLSTATE 22P02 (invalid_text_
//     representation) and rolls back the mutation per the audit-INSERT-
//     throws invariant.
// =============================================================================
describe('AC9.6 — ip/userAgent round-trip', () => {
  it('valid ip and userAgent are stored verbatim', async () => {
    await asAuthenticated(pg, manager);

    const markerAction = 'profile.test_ip_roundtrip';

    await pg.transaction(async (tx) =>
      withAudit(
        txClient(tx),
        {
          action: markerAction,
          targetType: 'profile',
          targetId: memberA,
          actorId: manager,
          ip: '203.0.113.5',
          userAgent: 'Mozilla/5.0 (TestSuite)',
        },
        async () => ({
          before: null,
          after: null,
          result: undefined,
        }),
      ),
    );

    await asServiceRole(pg);
    const audit = await pg.query<{
      ip_text: string;
      ua_text: string;
    }>(
      `SELECT host(ip) AS ip_text, user_agent AS ua_text
         FROM audit_log WHERE action = $1`,
      [markerAction],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.ip_text).toBe('203.0.113.5');
    expect(audit.rows[0]!.ua_text).toBe('Mozilla/5.0 (TestSuite)');
  });

  it('invalid ip throws SQLSTATE 22P02 and rolls back the mutation', async () => {
    expect.assertions(3);
    await asAuthenticated(pg, manager);

    const targetId = memberA;
    const markerAction = 'profile.test_ip_invalid';

    // Snapshot before so we can prove the mutate did NOT commit.
    await asServiceRole(pg);
    const before = await pg.query<{ full_name: string }>(
      'SELECT full_name FROM profiles WHERE id = $1',
      [targetId],
    );
    const beforeName = before.rows[0]!.full_name;
    await asAuthenticated(pg, manager);

    await expect(
      pg.transaction(async (tx) =>
        withAudit(
          txClient(tx),
          {
            action: markerAction,
            targetType: 'profile',
            targetId,
            actorId: manager,
            ip: 'not-an-ip', // inet parser rejects this with 22P02
            userAgent: 'Mozilla/5.0 (TestSuite)',
          },
          async (txInner) => {
            // Mutate first — must roll back when the audit INSERT trips the
            // inet parser.
            await txInner.query(`UPDATE profiles SET full_name = $1 WHERE id = $2`, [
              'Should Not Persist (inet guard)',
              targetId,
            ]);
            return {
              before: { full_name: beforeName },
              after: { full_name: 'Should Not Persist (inet guard)' },
              result: undefined,
            };
          },
        ),
      ),
    ).rejects.toMatchObject({ code: '22P02' });

    // No audit row written.
    await asServiceRole(pg);
    const audit = await pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1`,
      [markerAction],
    );
    expect(audit.rows[0]!.n).toBe(0);

    // Profile mutation rolled back — single-tx invariant proof.
    const after = await pg.query<{ full_name: string }>(
      'SELECT full_name FROM profiles WHERE id = $1',
      [targetId],
    );
    expect(after.rows[0]!.full_name).toBe(beforeName);
  });
});

// =============================================================================
// AC9.7 — before/after JSON shapes round-trip.
// Caller axis: app_authenticated + auth.uid()=manager.
// Objects, arrays, strings, numbers, booleans, null all round-trip
// preserved under service-role read.
//
// Bonus: BigInt / circular ref un-serializable inputs trigger a TypeError
// from the helper's pre-INSERT serializability check. JSON.stringify
// throws on those values; the throw propagates and rolls back any
// mutation the callback already performed — same atomicity property as
// the audit-INSERT-throws path.
// =============================================================================
describe('AC9.7 — before/after JSON shapes', () => {
  it('objects, arrays, strings, numbers, booleans, null all round-trip', async () => {
    await asAuthenticated(pg, manager);

    const markerAction = 'profile.test_json_shapes';

    const beforeShape = {
      object: { nested: { deep: 'value' }, k: 'v' },
      array: [1, 2, 3, 'four'],
      str: 'hello',
      num: 42,
      bool_t: true,
      bool_f: false,
      n: null,
    };
    const afterShape = [{ id: 1, ok: true }, { id: 2, ok: false }, 'tail', null];

    await pg.transaction(async (tx) =>
      withAudit(
        txClient(tx),
        {
          action: markerAction,
          targetType: 'profile',
          targetId: memberA,
          actorId: manager,
        },
        async () => ({
          before: beforeShape,
          after: afterShape,
          result: undefined,
        }),
      ),
    );

    await asServiceRole(pg);
    const audit = await pg.query<{
      before: unknown;
      after: unknown;
    }>(`SELECT before, after FROM audit_log WHERE action = $1`, [markerAction]);
    expect(audit.rows).toHaveLength(1);
    // pglite returns jsonb columns as already-parsed JS values. Use
    // toEqual for deep structural equality.
    expect(audit.rows[0]!.before).toEqual(beforeShape);
    expect(audit.rows[0]!.after).toEqual(afterShape);
  });

  it('BigInt before/after trips a TypeError; no audit row written', async () => {
    expect.assertions(2);
    await asAuthenticated(pg, manager);

    const markerAction = 'profile.test_json_bigint';

    await expect(
      pg.transaction(async (tx) =>
        withAudit(
          txClient(tx),
          {
            action: markerAction,
            targetType: 'profile',
            targetId: memberA,
            actorId: manager,
          },
          async () => ({
            before: { tooBig: BigInt(1) },
            after: null,
            result: undefined,
          }),
        ),
      ),
    ).rejects.toThrow(TypeError);

    // No audit row was written — JSON.stringify on BigInt throws before
    // the audit INSERT can run; pg.transaction ROLLBACKs.
    await asServiceRole(pg);
    const audit = await pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1`,
      [markerAction],
    );
    expect(audit.rows[0]!.n).toBe(0);
  });

  it('circular reference before/after trips a TypeError; no audit row written', async () => {
    expect.assertions(2);
    await asAuthenticated(pg, manager);

    const markerAction = 'profile.test_json_circular';

    type CircularNode = { name: string; self?: CircularNode };
    const node: CircularNode = { name: 'root' };
    node.self = node; // creates a cycle

    await expect(
      pg.transaction(async (tx) =>
        withAudit(
          txClient(tx),
          {
            action: markerAction,
            targetType: 'profile',
            targetId: memberA,
            actorId: manager,
          },
          async () => ({
            before: node,
            after: null,
            result: undefined,
          }),
        ),
      ),
    ).rejects.toThrow(TypeError);

    await asServiceRole(pg);
    const audit = await pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1`,
      [markerAction],
    );
    expect(audit.rows[0]!.n).toBe(0);
  });
});

// =============================================================================
// AC9.8 — server-only import present (static source-text assertion).
// Reads lib/audit/withAudit.ts as text and asserts the file starts with
// `import 'server-only';`. Defense-in-depth against a worker stripping
// the import per ADR-0007 (premortem risk #4). Pure file-text check —
// no DB, no role, no transaction wrapper.
// =============================================================================
describe('AC9.8 — server-only import present', () => {
  it("lib/audit/withAudit.ts begins with import 'server-only';", () => {
    const content = readFileSync(HELPER_FILE, 'utf8');
    // Strip an optional UTF-8 BOM that some Windows editors prepend, then
    // assert the first non-empty content is the server-only directive.
    const stripped = content.replace(/^﻿/, '');
    expect(stripped.startsWith("import 'server-only';")).toBe(true);
  });

  it('no other import precedes server-only (defense against mid-file burial)', () => {
    const content = readFileSync(HELPER_FILE, 'utf8').replace(/^﻿/, '');
    // Find the first `import` statement in the file and assert it is the
    // server-only directive. A future contributor who adds another import
    // above this line would have the audit-write path tree-shaken into a
    // client bundle under a misconfigured Next.js build (see premortem
    // risk #4).
    const firstImportMatch = content.match(/^\s*import\s+['"][^'"]+['"];?/m);
    expect(firstImportMatch).not.toBeNull();
    expect(firstImportMatch![0].trim()).toBe("import 'server-only';");
  });
});
