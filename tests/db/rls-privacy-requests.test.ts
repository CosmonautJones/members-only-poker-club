/**
 * RLS unit tests for `privacy_requests` (ADR-0035 Slice 4, spec AC1).
 *
 * Run locally:    pnpm test tests/db/rls-privacy-requests.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC1.
 * Migrations under test:
 *   - supabase/migrations/0001_feature_flags.sql       (cycle 1 schema)
 *   - supabase/migrations/0002_profiles_and_roles.sql  (role ladder + auth.role_at_least)
 *   - supabase/migrations/0003_audit_log.sql           (cycle 2)
 *   - supabase/migrations/0004_privacy_soft_delete.sql (pgcrypto + soft-delete)
 *   - supabase/migrations/0005_privacy_requests.sql    (the table under test)
 *
 * The three policies pinned by AC1:
 *   1. privacy_requests_select_self_or_manager — SELECT where
 *      `profile_id = auth.uid() OR auth.role_at_least('manager')`.
 *   2. privacy_requests_insert_self — INSERT WITH CHECK `profile_id = auth.uid()`.
 *      Managers do NOT have an insert-on-behalf-of-member policy in v1.
 *   3. privacy_requests_update_manager — UPDATE USING/WITH CHECK
 *      `auth.role_at_least('manager')`.
 * NO DELETE policy — privacy requests are audit-equivalent and never removed.
 *
 * Sub-case map:
 *   1. structural — RLS enabled + forced; exactly 3 named policies.
 *   2. SELECT: member sees only their own; manager+ sees all.
 *   3. INSERT: self-only — a member CAN insert with their own profile_id,
 *      another member CANNOT insert with someone else's profile_id, and a
 *      manager CANNOT insert with a non-self profile_id (no manager-on-behalf
 *      policy in v1).
 *   4. UPDATE: manager+ only — members get rowCount=0 (silent filter);
 *      managers can transition status.
 *   5. DELETE: blocked for everyone subject to RLS — service-role bypass
 *      remains the only physical-delete path.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite, type Results } from '@electric-sql/pglite';
// pglite ships pgcrypto as a contrib extension; migration 0004 calls
// `CREATE EXTENSION IF NOT EXISTS pgcrypto` so we MUST register it on
// the PGlite constructor (otherwise the extension fails with
// "extension 'pgcrypto' is not available").
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAuthStub, setTestUid, resetAuthStub } from './_fixtures/auth-stub';
import { seedProfile } from './_fixtures/profiles';
import { setupAppAuthenticatedRole, asServiceRole, withRollback } from './_fixtures/rls-helpers';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const MIGRATIONS_DIR = resolve(TEST_DIR, '..', '..', 'supabase', 'migrations');

let pg: PGlite;

async function runSqlBlock(sql: string): Promise<void> {
  // pglite multi-statement raw-SQL entrypoint (named to avoid the JS
  // ProcessBuilder method on Node's child_process module).
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> })['exec'];
  await runner.call(pg, sql);
}

// Seeded ids — populated in beforeAll.
let memberA = '';
let memberB = '';
let manager = '';
let owner = '';

beforeAll(async () => {
  pg = new PGlite({ extensions: { pgcrypto } });

  await setupAuthStub(pg);

  // Stub auth.users — production Supabase ships this; pglite does not.
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  // Apply migrations 0001..0005 in order. 0006 is unrelated (feature_flags RLS).
  for (const name of [
    '0001_feature_flags.sql',
    '0002_profiles_and_roles.sql',
    '0003_audit_log.sql',
    '0004_privacy_soft_delete.sql',
    '0005_privacy_requests.sql',
  ]) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    await runSqlBlock(sql);
  }

  // Seed profiles. Service-role context (uid cleared) so RLS does not deny
  // the INSERT.
  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@privacy-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  memberB = await seedAs('member', 'member-b');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // Seed one pending privacy_request per member under service-role so the
  // SELECT denial sub-cases have something to filter.
  await pg.query(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'export', 'pending')`,
    [memberA, `member-a@privacy-test.local`],
  );
  await pg.query(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'delete', 'pending')`,
    [memberB, `member-b@privacy-test.local`],
  );

  // Grant the app_authenticated role access to privacy_requests + the
  // role-ladder helper.
  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'privacy_requests'],
  });
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  await resetAuthStub(pg);
  await pg.query('SET ROLE app_authenticated');
});

// =============================================================================
// Structural — RLS enabled + forced; exactly 3 named policies.
// =============================================================================
describe('structural — RLS posture on privacy_requests', () => {
  it('relrowsecurity = true AND relforcerowsecurity = true', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE oid = 'public.privacy_requests'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('exactly three policies exist with the expected names', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid = 'public.privacy_requests'::regclass
        ORDER BY polname ASC`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual([
      'privacy_requests_insert_self',
      'privacy_requests_select_self_or_manager',
      'privacy_requests_update_manager',
    ]);
  });

  it('no DELETE policy exists (audit-equivalent invariant)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polcmd: string }>(
      `SELECT polcmd FROM pg_policy
        WHERE polrelid = 'public.privacy_requests'::regclass`,
    );
    // polcmd codes: 'r' SELECT, 'a' INSERT, 'w' UPDATE, 'd' DELETE, '*' ALL.
    expect(r.rows.map((row) => row.polcmd)).not.toContain('d');
  });
});

// =============================================================================
// SELECT — self OR manager+.
// =============================================================================
describe('SELECT policy — self OR manager+', () => {
  it('memberA sees ONLY their own request', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ profile_id: string }>(
      'SELECT profile_id FROM privacy_requests ORDER BY submitted_at',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.profile_id).toBe(memberA);
  });

  it('memberB sees ONLY their own request', async () => {
    await setTestUid(pg, memberB);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM privacy_requests');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.profile_id).toBe(memberB);
  });

  it('manager sees ALL requests', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ profile_id: string }>(
      'SELECT profile_id FROM privacy_requests ORDER BY submitted_at',
    );
    expect(r.rows).toHaveLength(2);
  });

  it('owner sees ALL requests', async () => {
    await setTestUid(pg, owner);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM privacy_requests');
    expect(r.rows).toHaveLength(2);
  });

  it('anon (uid cleared) sees zero rows', async () => {
    // beforeEach already cleared uid and set role to app_authenticated.
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM privacy_requests');
    expect(r.rows).toHaveLength(0);
  });
});

// =============================================================================
// INSERT — self-only WITH CHECK.
// =============================================================================
describe('INSERT policy — self only', () => {
  it('memberA CAN insert a request with their own profile_id', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const r = (await pg.query(
        `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
           VALUES ($1, $2, $3, $4)`,
        [memberA, `member-a@privacy-test.local`, 'delete', 'pending'],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('memberA CANNOT insert a request with another members profile_id (42501)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(
          `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
             VALUES ($1, $2, $3, $4)`,
          [memberB, `member-b@privacy-test.local`, 'delete', 'pending'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('manager CANNOT insert a request for a member (no manager-on-behalf policy in v1; 42501)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      await expect(
        pg.query(
          `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
             VALUES ($1, $2, $3, $4)`,
          [memberA, `member-a@privacy-test.local`, 'delete', 'pending'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// UPDATE — manager+ only.
// =============================================================================
describe('UPDATE policy — manager+ only', () => {
  it('memberA UPDATE of their own request affects zero rows (RLS silent filter)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const upd = (await pg.query(
        `UPDATE privacy_requests SET status = 'rejected' WHERE profile_id = $1`,
        [memberA],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      await asServiceRole(pg);
      const after = await pg.query<{ status: string }>(
        'SELECT status FROM privacy_requests WHERE profile_id = $1',
        [memberA],
      );
      expect(after.rows[0]?.status).toBe('pending');
    });
  });

  it('manager CAN UPDATE any privacy request (post-state verified)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(
        `UPDATE privacy_requests SET status = 'rejected', resolved_by = $2 WHERE profile_id = $1`,
        [memberA, manager],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      const after = await pg.query<{ status: string; resolved_by: string | null }>(
        'SELECT status, resolved_by FROM privacy_requests WHERE profile_id = $1',
        [memberA],
      );
      expect(after.rows[0]?.status).toBe('rejected');
      expect(after.rows[0]?.resolved_by).toBe(manager);
    });
  });

  it('owner CAN UPDATE any privacy request', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, owner);
      const upd = (await pg.query(
        `UPDATE privacy_requests SET status = 'completed', resolved_by = $2 WHERE profile_id = $1`,
        [memberB, owner],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);
    });
  });
});

// =============================================================================
// DELETE — blocked for everyone subject to RLS.
// =============================================================================
describe('DELETE — blocked for everyone (no policy exists)', () => {
  it('member DELETE affects zero rows', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const del = (await pg.query(`DELETE FROM privacy_requests WHERE profile_id = $1`, [
        memberA,
      ])) as Results;
      expect(del.affectedRows ?? 0).toBe(0);
    });
  });

  it('manager DELETE affects zero rows (no manager DELETE policy exists)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const del = (await pg.query(`DELETE FROM privacy_requests WHERE profile_id = $1`, [
        memberA,
      ])) as Results;
      expect(del.affectedRows ?? 0).toBe(0);
    });
  });

  it('service-role CAN DELETE (BYPASSRLS escape hatch)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const del = (await pg.query(`DELETE FROM privacy_requests WHERE profile_id = $1`, [
        memberA,
      ])) as Results;
      expect(del.affectedRows ?? 0).toBe(1);
    });
  });
});
