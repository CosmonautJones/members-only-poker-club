/**
 * Tests for `app/(admin)/admin/members/[id]/_actions/initiateMemberDeletion.ts`
 * — the AC34 / WD.T24 manager-initiated deletion-request action.
 *
 * Run locally:    pnpm test tests/admin/initiate-member-deletion-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC34
 *
 * SUT contract (per AC34):
 *   - First runtime statement is `await requireRole('manager');`.
 *   - Self-edit guard throws `SelfEditViolation` BEFORE the audit tx.
 *   - Reason length 1..500 (else `RejectReasonInvalid`).
 *   - Inside `withAudit('admin.member.deletion_initiated', 'profile', profileId)`:
 *     SELECT id, email FROM profiles WHERE id=$1 FOR UPDATE — assert
 *     exists AND NOT already anonymized (email NOT LIKE 'del:%');
 *     INSERT INTO privacy_requests; capture new id for audit `after`.
 *   - before = null, after = { request_id: <uuid> } — NO PII.
 *   - Post-tx: `revalidateTag('admin-dashboard-counts')`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
// pgcrypto contrib — migration 0004 enables it for softDeleteProfile's
// sha256 hash. pglite ships it as an explicit-load extension; without
// the `extensions: { pgcrypto }` PGlite ctor option the CREATE EXTENSION
// statement in 0004 fails with "extension 'pgcrypto' is not available".
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

vi.mock('server-only', () => ({}));

const requireRoleState = vi.hoisted(() => ({
  currentActor: null as { id: string; role: 'manager' | 'owner' } | null,
}));

vi.mock('@/lib/auth/requireRole', async () => {
  const { InsufficientRoleError } =
    await vi.importActual<typeof import('@/lib/auth/errors')>('@/lib/auth/errors');
  return {
    requireRole: vi.fn(async (required: 'manager' | 'owner') => {
      const actor = requireRoleState.currentActor;
      if (!actor) {
        throw new Error('test bug: currentActor not set before requireRole call');
      }
      const rank: Record<string, number> = {
        member: 0,
        cashier: 1,
        manager: 2,
        owner: 3,
      };
      if (rank[actor.role]! < rank[required]!) {
        throw new InsufficientRoleError(required, actor.role);
      }
      return { profile: { id: actor.id, role: actor.role } };
    }),
  };
});

const cacheSpy = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: cacheSpy.revalidateTag }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('test bug: defaultDb() reached — tests must inject db param');
  },
}));

// eslint-disable-next-line import/first
import {
  initiateMemberDeletion,
  type TransactionRunner,
} from '@/app/(admin)/admin/members/[id]/_actions/initiateMemberDeletion';
// eslint-disable-next-line import/first
import { SelfEditViolation, RejectReasonInvalid, BadRequest } from '@/app/(admin)/admin/_errors';
// eslint-disable-next-line import/first
import { setupAuthStub, resetAuthStub, setTestUid } from '../db/_fixtures/auth-stub';
// eslint-disable-next-line import/first
import { seedProfile } from '../db/_fixtures/profiles';
// eslint-disable-next-line import/first
import {
  setupAppAuthenticatedRole,
  asAuthenticated,
  asServiceRole,
} from '../db/_fixtures/rls-helpers';

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
const MIG_0004 = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0004_privacy_soft_delete.sql',
);
const MIG_0005 = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0005_privacy_requests.sql',
);
const ACTION_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'app',
  '(admin)',
  'admin',
  'members',
  '[id]',
  '_actions',
  'initiateMemberDeletion.ts',
);

let pg: PGlite;
let manager1: string;
let target1: string;
let anonymizedTarget: string;

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * pglite adapter for the action's `TransactionRunner` shape. The
 * production action uses `createAdminClient()` (service-role / BYPASSRLS)
 * for its tx, so the test runner switches to service-role for the
 * duration of the callback. This mirrors the production trust model:
 * the INSERT into privacy_requests is performed by the manager-initiated
 * path using the BYPASSRLS service-role connection (the privacy_requests
 * INSERT policy is `profile_id = auth.uid()` — self-only — which would
 * deny the manager-on-behalf-of-target write under authenticated role).
 * We RESET ROLE inside the tx, run the callback, then SET ROLE back to
 * app_authenticated when done so subsequent test assertions can still
 * exercise RLS-subject reads.
 */
function pgliteRunner(p: PGlite): TransactionRunner {
  return {
    transaction: async (callback) => {
      await p.query('RESET ROLE');
      try {
        return await p.transaction(async (tx: PgliteTxLike) => {
          return callback({
            query: async (sql, params) => {
              const r = await tx.query(sql, params);
              return { rows: r.rows as unknown[] };
            },
          });
        });
      } finally {
        // Restore authenticated role so post-action assertions run
        // against the RLS-subject substrate. Tests that read via
        // service-role (`asServiceRole`) explicitly do so afterward.
        await p.query('SET ROLE app_authenticated');
      }
    },
  };
}

async function runSqlBlock(sql: string): Promise<void> {
  // Cast through unknown to reach pglite's multi-statement raw-SQL entry.
  type RawSqlRunner = { exec: (s: string) => Promise<unknown> };
  const runner = (pg as unknown as RawSqlRunner).exec;
  await runner.call(pg, sql);
}

beforeAll(async () => {
  pg = new PGlite({ extensions: { pgcrypto } });
  await setupAuthStub(pg);
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);
  await runSqlBlock(readFileSync(MIG_0002, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0003, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0004, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0005, 'utf8'));

  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@initiate-deletion-test.local`,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  target1 = await seedAs('member', 'target1');
  anonymizedTarget = await seedAs('member', 'anonymizedTarget');

  // Simulate softDeleteProfile on anonymizedTarget — set email to the
  // `del:<hash>` sentinel directly per ADR-0023.
  await asServiceRole(pg);
  await pg.query(
    "UPDATE profiles SET email = 'del:abc123def456', deleted_at = now() WHERE id = $1",
    [anonymizedTarget],
  );

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log', 'privacy_requests'],
    sequences: ['audit_log_id_seq'],
  });
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  await resetAuthStub(pg);
  cacheSpy.revalidateTag.mockClear();
  requireRoleState.currentActor = null;
  await asServiceRole(pg);
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');
  await pg.query('DELETE FROM privacy_requests');
});

async function readAuditRows(
  targetId: string,
): Promise<Array<{ action: string; actor_id: string | null; before: unknown; after: unknown }>> {
  await asServiceRole(pg);
  const result = await pg.query<{
    action: string;
    actor_id: string | null;
    before: unknown;
    after: unknown;
  }>(
    `SELECT action, actor_id::text AS actor_id, before, after
       FROM audit_log
      WHERE target_type = 'profile' AND target_id = $1
      ORDER BY id ASC`,
    [targetId],
  );
  return result.rows;
}

async function readPrivacyRequests(profileId: string): Promise<
  Array<{
    id: string;
    profile_id: string;
    requester_email: string;
    kind: string;
    status: string;
    resolved_by: string | null;
  }>
> {
  await asServiceRole(pg);
  const result = await pg.query<{
    id: string;
    profile_id: string;
    requester_email: string;
    kind: string;
    status: string;
    resolved_by: string | null;
  }>(
    `SELECT id::text, profile_id::text, requester_email, kind::text AS kind, status::text AS status, resolved_by::text
       FROM privacy_requests
      WHERE profile_id = $1
      ORDER BY submitted_at ASC`,
    [profileId],
  );
  return result.rows;
}

// =============================================================================
// AC34.1 — Happy path: creates one privacy_requests row + one audit row
// =============================================================================
describe('initiateMemberDeletion — AC34 happy path', () => {
  it('creates one privacy_requests row + one audit row', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await initiateMemberDeletion(
      { profileId: target1, reason: 'duplicate account submitted by member' },
      pgliteRunner(pg),
    );

    expect(result.ok).toBe(true);
    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const requests = await readPrivacyRequests(target1);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.kind).toBe('delete');
    expect(requests[0]!.status).toBe('pending');
    expect(requests[0]!.resolved_by).toBeNull();
    expect(requests[0]!.requester_email).toMatch(/@initiate-deletion-test\.local$/);
    expect(requests[0]!.id).toBe(result.requestId);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.member.deletion_initiated');
    expect(rows[0]!.actor_id).toBe(manager1);
    expect(rows[0]!.before).toBeNull();
    expect(rows[0]!.after).toEqual({ request_id: result.requestId });

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });
});

// =============================================================================
// AC34.2 — Self-edit guard
// =============================================================================
describe('initiateMemberDeletion — AC34 self-edit guard', () => {
  it('throws SelfEditViolation when profileId === actor.id; no audit, no insert', async () => {
    expect.assertions(3);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      initiateMemberDeletion(
        { profileId: manager1, reason: 'self-edit attempt' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(SelfEditViolation);

    const rows = await readAuditRows(manager1);
    expect(rows).toHaveLength(0);
    const requests = await readPrivacyRequests(manager1);
    expect(requests).toHaveLength(0);
  });
});

// =============================================================================
// AC34.3 — Reason length validation
// =============================================================================
describe('initiateMemberDeletion — AC34 reason length validation', () => {
  it('throws RejectReasonInvalid on empty reason; no audit, no insert', async () => {
    expect.assertions(3);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      initiateMemberDeletion({ profileId: target1, reason: '' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RejectReasonInvalid);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
    const requests = await readPrivacyRequests(target1);
    expect(requests).toHaveLength(0);
  });

  it('throws RejectReasonInvalid on reason > 500 chars; no audit, no insert', async () => {
    expect.assertions(3);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const longReason = 'x'.repeat(501);
    await expect(
      initiateMemberDeletion({ profileId: target1, reason: longReason }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RejectReasonInvalid);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
    const requests = await readPrivacyRequests(target1);
    expect(requests).toHaveLength(0);
  });

  it('accepts reason = 500 chars exactly (boundary)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const exactReason = 'x'.repeat(500);
    const result = await initiateMemberDeletion(
      { profileId: target1, reason: exactReason },
      pgliteRunner(pg),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts reason = 1 char exactly (boundary)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await initiateMemberDeletion(
      { profileId: target1, reason: 'x' },
      pgliteRunner(pg),
    );
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// AC34.4 — Already-anonymized profile
// =============================================================================
describe('initiateMemberDeletion — AC34 already-anonymized guard', () => {
  it('throws BadRequest when email starts with del:; no audit, no insert', async () => {
    expect.assertions(3);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      initiateMemberDeletion(
        { profileId: anonymizedTarget, reason: 'attempt against anonymized profile' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(BadRequest);

    const rows = await readAuditRows(anonymizedTarget);
    expect(rows).toHaveLength(0);
    const requests = await readPrivacyRequests(anonymizedTarget);
    expect(requests).toHaveLength(0);
  });
});

// =============================================================================
// AC34.5 — Nonexistent profile
// =============================================================================
describe('initiateMemberDeletion — AC34 nonexistent profile', () => {
  it('throws BadRequest when profile does not exist', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const ghostId = '00000000-0000-4000-8000-000000000000';
    await expect(
      initiateMemberDeletion(
        { profileId: ghostId, reason: 'attempt against ghost profile' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(BadRequest);

    await asServiceRole(pg);
    const all = await pg.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM audit_log');
    expect(all.rows[0]!.count).toBe('0');
  });
});

// =============================================================================
// AC34.6 — AC28 no-PII in audit row
// =============================================================================
describe('initiateMemberDeletion — AC28 no PII in audit row', () => {
  it('before/after JSON does not match /email|full_name|phone|dob/', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await initiateMemberDeletion(
      { profileId: target1, reason: 'pii redaction test' },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target1);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const beforeJson = JSON.stringify(row.before);
      const afterJson = JSON.stringify(row.after);
      expect(beforeJson).not.toMatch(/email|full_name|phone|dob/);
      expect(afterJson).not.toMatch(/email|full_name|phone|dob/);
    }
  });
});

// =============================================================================
// Source-shape invariants
// =============================================================================
describe('initiateMemberDeletion — source-shape invariants', () => {
  it("first line is `import 'server-only';`", () => {
    const src = readFileSync(ACTION_PATH, 'utf8').replace(/^﻿/, '');
    const firstLine = src.split(/\r?\n/)[0]!.trim();
    expect(firstLine).toBe("import 'server-only';");
  });

  it("contains the literal `await requireRole('manager')` call", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/await\s+requireRole\(\s*['"]manager['"]\s*\)/);
  });

  it('contains the literal `admin.member.deletion_initiated` audit-action string', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/admin\.member\.deletion_initiated/);
  });

  it("contains the literal `revalidateTag('admin-dashboard-counts')` call (AC35)", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/revalidateTag\(\s*['"]admin-dashboard-counts['"]\s*\)/);
  });

  it('contains the privacy_requests INSERT statement', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/INSERT\s+INTO\s+privacy_requests/i);
  });

  it('contains the `del:` anonymization-prefix check', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/del:/);
  });
});
