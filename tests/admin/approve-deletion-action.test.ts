/**
 * Tests for `app/(admin)/admin/privacy/_actions/approveDeletion.ts` —
 * the AC25 / WC.T17 privacy-deletion approval server action.
 *
 * Run locally:    pnpm test tests/admin/approve-deletion-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC25.
 *
 * SUT contract (premortem R10 — ORDER IS LOAD-BEARING):
 *   - First runtime statement is `await requireRole('manager');`.
 *   - Inside withAudit('admin.privacy.deletion_approved', 'profile'):
 *     (1) SELECT FOR UPDATE on privacy_requests.
 *     (2) Assert status='pending' AND kind='delete' (else RequestNotPending).
 *     (3) Assert confirmEmail === requester_email (else ConfirmEmailMismatch).
 *     (4) Call softDeleteProfile(profile_id, tx).
 *     (5) UPDATE privacy_requests SET status='completed'.
 *   - before = { deleted_at: null }, after = { deleted_at: <iso>, request_id }.
 *   - Wrong confirmEmail throws AND softDeleteProfile NOT called AND no audit row.
 *   - Re-approve on completed throws.
 *   - Audit JSON does not match /email|full_name|phone|dob/.
 *   - Post-tx revalidateTag('admin-dashboard-counts').
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
// pgcrypto contrib — softDeleteProfile uses encode(digest(..., 'sha256'), 'hex').
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

const cacheSpy = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidateTag: cacheSpy.revalidateTag,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('test bug: defaultDb() reached — tests must inject db param');
  },
}));

// softDeleteProfile spy — wraps the real helper so we can assert
// call-vs-no-call AND still get the real anonymization side-effects.
const softDeleteSpy = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/privacy/soft-delete', async () => {
  const real = await vi.importActual<typeof import('@/lib/privacy/soft-delete')>(
    '@/lib/privacy/soft-delete',
  );
  return {
    softDeleteProfile: vi.fn(async (userId: string, db: unknown) => {
      softDeleteSpy.fn(userId);
      return real.softDeleteProfile(userId, db as Parameters<typeof real.softDeleteProfile>[1]);
    }),
  };
});

// eslint-disable-next-line import/first
import {
  approveDeletion,
  type TransactionRunner,
} from '@/app/(admin)/admin/privacy/_actions/approveDeletion';
// eslint-disable-next-line import/first
import { RequestNotPending, ConfirmEmailMismatch } from '@/app/(admin)/admin/_errors';
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
  'privacy',
  '_actions',
  'approveDeletion.ts',
);

let pg: PGlite;
let manager1: string;
let target1: string;
let target2: string;
let pendingDeleteId: string;
let pendingDeleteWrongConfirmId: string;
let pendingExportId: string;
let alreadyCompletedDeleteId: string;
const REQUESTER_EMAIL_1 = 'target1.requester@approve-deletion-test.local';
const REQUESTER_EMAIL_2 = 'target2.requester@approve-deletion-test.local';

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

function pgliteRunner(p: PGlite, rejectAuditInsert = false): TransactionRunner {
  return {
    transaction: async (callback) => {
      return p.transaction(async (tx: PgliteTxLike) => {
        return callback({
          query: async (sql, params) => {
            if (rejectAuditInsert && /^\s*INSERT\s+INTO\s+audit_log/i.test(sql)) {
              throw new Error('forced audit insert failure');
            }
            const r = await tx.query(sql, params);
            return { rows: r.rows as unknown[] };
          },
        });
      });
    },
  };
}

async function runSqlBlock(sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> }).exec;
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
  // Migration 0004 enables pgcrypto + adds profiles.deleted_at — softDeleteProfile
  // depends on both.
  await runSqlBlock(readFileSync(MIG_0004, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0005, 'utf8'));

  const seedAs = async (
    role: 'member' | 'manager',
    label: string,
    extras: Record<string, unknown> = {},
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@approve-deletion-test.local`,
      ...extras,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  target1 = await seedAs('member', 'target1');
  target2 = await seedAs('member', 'target2');

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
  softDeleteSpy.fn.mockClear();
  requireRoleState.currentActor = null;

  await asServiceRole(pg);
  await pg.query('DELETE FROM privacy_requests');
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');
  // Reset profile anonymization state so tests run from a clean slate.
  await pg.query(
    `UPDATE profiles
        SET full_name = $2,
            email = $3,
            phone = NULL,
            deleted_at = NULL
      WHERE id = $1`,
    [target1, 'Target One Real Name', `target1.real@approve-deletion-test.local`],
  );
  await pg.query(
    `UPDATE profiles
        SET full_name = $2,
            email = $3,
            phone = NULL,
            deleted_at = NULL
      WHERE id = $1`,
    [target2, 'Target Two Real Name', `target2.real@approve-deletion-test.local`],
  );

  // Pending delete request for target1 (the happy-path subject).
  const pendingDelete = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'delete', 'pending')
     RETURNING id`,
    [target1, REQUESTER_EMAIL_1],
  );
  pendingDeleteId = pendingDelete.rows[0]!.id;

  // Pending delete request for target2 — used by the wrong-confirm test.
  const pendingDeleteWrong = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'delete', 'pending')
     RETURNING id`,
    [target2, REQUESTER_EMAIL_2],
  );
  pendingDeleteWrongConfirmId = pendingDeleteWrong.rows[0]!.id;

  // Pending export request — used to assert the kind guard.
  const pendingExport = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'export', 'pending')
     RETURNING id`,
    [target1, 'export@approve-deletion-test.local'],
  );
  pendingExportId = pendingExport.rows[0]!.id;

  // Already-completed delete request — re-approval guard.
  const alreadyCompleted = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status, resolved_at, resolved_by)
       VALUES ($1, $2, 'delete', 'completed', now(), $3)
     RETURNING id`,
    [target1, 'completed-delete@approve-deletion-test.local', manager1],
  );
  alreadyCompletedDeleteId = alreadyCompleted.rows[0]!.id;
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
      WHERE target_id = $1
      ORDER BY id ASC`,
    [targetId],
  );
  return result.rows;
}

async function readProfile(id: string): Promise<{
  full_name: string;
  email: string;
  phone: string | null;
  deleted_at: string | Date | null;
}> {
  await asServiceRole(pg);
  const r = await pg.query<{
    full_name: string;
    email: string;
    phone: string | null;
    deleted_at: string | Date | null;
  }>('SELECT full_name, email, phone, deleted_at FROM profiles WHERE id = $1', [id]);
  return r.rows[0]!;
}

async function readRequest(id: string): Promise<{ status: string }> {
  await asServiceRole(pg);
  const r = await pg.query<{ status: string }>(
    'SELECT status FROM privacy_requests WHERE id = $1',
    [id],
  );
  return r.rows[0]!;
}

// =============================================================================
// AC25.1 — Happy path
// =============================================================================
describe('approveDeletion — AC25 happy path', () => {
  it('anonymizes profile (del: prefix), sets deleted_at, marks request completed, writes audit row', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await approveDeletion(
      { requestId: pendingDeleteId, confirmEmail: REQUESTER_EMAIL_1 },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true });

    // softDeleteProfile was called for the correct profile id.
    expect(softDeleteSpy.fn).toHaveBeenCalledTimes(1);
    expect(softDeleteSpy.fn).toHaveBeenCalledWith(target1);

    // Profile row anonymized — del: prefix on PII cols, deleted_at set.
    const profile = await readProfile(target1);
    expect(profile.full_name.startsWith('del:')).toBe(true);
    expect(profile.email.startsWith('del:')).toBe(true);
    expect(profile.email.endsWith('@deleted.local')).toBe(true);
    expect(profile.phone).toBeNull();
    expect(profile.deleted_at).not.toBeNull();

    // Request row marked completed.
    const req = await readRequest(pendingDeleteId);
    expect(req.status).toBe('completed');

    // Audit row exists with action='admin.privacy.deletion_approved' and
    // target_id=profile_id (target1).
    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.privacy.deletion_approved');
    expect(rows[0]!.actor_id).toBe(manager1);

    // before/after shape per AC25.
    const before = rows[0]!.before as { deleted_at: string | null };
    const after = rows[0]!.after as {
      deleted_at: string | null;
      request_id: string;
    };
    expect(before.deleted_at).toBeNull();
    expect(after.deleted_at).toBeTruthy();
    expect(after.request_id).toBe(pendingDeleteId);

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });
});

describe('approveDeletion — transaction rollback', () => {
  it('rolls back anonymization and request completion when the audit insert fails', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      approveDeletion(
        { requestId: pendingDeleteId, confirmEmail: REQUESTER_EMAIL_1 },
        pgliteRunner(pg, true),
      ),
    ).rejects.toThrow('forced audit insert failure');

    const profile = await readProfile(target1);
    expect(profile.deleted_at).toBeNull();
    expect(profile.email).not.toMatch(/^del:/);
    expect((await readRequest(pendingDeleteId)).status).toBe('pending');
    expect(await readAuditRows(target1)).toHaveLength(0);
    expect(cacheSpy.revalidateTag).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AC25.2 — Wrong confirmEmail throws (load-bearing premortem R10)
// =============================================================================
describe('approveDeletion — AC25 confirmEmail guard (premortem R10)', () => {
  it('wrong confirmEmail throws ConfirmEmailMismatch AND softDeleteProfile NOT called AND no audit row', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      approveDeletion(
        {
          requestId: pendingDeleteWrongConfirmId,
          confirmEmail: 'wrong@example.com',
        },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(ConfirmEmailMismatch);

    // softDeleteProfile NOT called.
    expect(softDeleteSpy.fn).not.toHaveBeenCalled();

    // No audit row.
    const rows = await readAuditRows(target2);
    expect(rows).toHaveLength(0);

    // Profile NOT anonymized — still has original name/email.
    const profile = await readProfile(target2);
    expect(profile.full_name.startsWith('del:')).toBe(false);
    expect(profile.email.startsWith('del:')).toBe(false);
    expect(profile.deleted_at).toBeNull();

    // Request still pending.
    const req = await readRequest(pendingDeleteWrongConfirmId);
    expect(req.status).toBe('pending');
  });
});

// =============================================================================
// AC25.3 — Re-approve on completed throws
// =============================================================================
describe('approveDeletion — AC25 re-approval guard', () => {
  it('re-approve on a completed delete request throws RequestNotPending (no audit row, softDelete not called)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      approveDeletion(
        {
          requestId: alreadyCompletedDeleteId,
          confirmEmail: 'completed-delete@approve-deletion-test.local',
        },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(RequestNotPending);

    expect(softDeleteSpy.fn).not.toHaveBeenCalled();
  });

  it('approving a kind=export row via approveDeletion throws RequestNotPending', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      approveDeletion(
        {
          requestId: pendingExportId,
          confirmEmail: 'export@approve-deletion-test.local',
        },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(RequestNotPending);

    expect(softDeleteSpy.fn).not.toHaveBeenCalled();
  });

  it('approving a non-existent row throws RequestNotPending', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const fakeId = '00000000-0000-4000-8000-000000000000';
    await expect(
      approveDeletion(
        { requestId: fakeId, confirmEmail: 'whatever@example.com' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(RequestNotPending);

    expect(softDeleteSpy.fn).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AC25.4 — No PII in audit row (AC28)
// =============================================================================
describe('approveDeletion — AC28 no PII in audit row', () => {
  it('audit before/after JSON does not match /email|full_name|phone|dob/', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await approveDeletion(
      { requestId: pendingDeleteId, confirmEmail: REQUESTER_EMAIL_1 },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const beforeJson = JSON.stringify(rows[0]!.before);
    const afterJson = JSON.stringify(rows[0]!.after);
    expect(beforeJson).not.toMatch(/email|full_name|phone|dob/);
    expect(afterJson).not.toMatch(/email|full_name|phone|dob/);
  });
});

// =============================================================================
// Source-shape invariants (AC5, AC28, AC35)
// =============================================================================
describe('approveDeletion — source-shape invariants', () => {
  it("first line is `import 'server-only';`", () => {
    const src = readFileSync(ACTION_PATH, 'utf8').replace(/^﻿/, '');
    const firstLine = src.split(/\r?\n/)[0]!.trim();
    expect(firstLine).toBe("import 'server-only';");
  });

  it("contains the literal `await requireRole('manager')` call", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/await\s+requireRole\(\s*['"]manager['"]\s*\)/);
  });

  it("contains the literal `revalidateTag('admin-dashboard-counts')` call (AC35)", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/revalidateTag\(\s*['"]admin-dashboard-counts['"]\s*\)/);
  });

  it('contains the literal `softDeleteProfile(` call (AC25 ADR-0023 helper)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/softDeleteProfile\(/);
  });

  it('source does not contain forbidden PII column names in before/after literals (AC28)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\bemail\s*:/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\bemail\s*:/);
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\bfull_name\s*:/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\bfull_name\s*:/);
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\bphone\s*:/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\bphone\s*:/);
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\bdob\s*:/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\bdob\s*:/);
  });
});
