/**
 * Tests for `app/(admin)/admin/privacy/_actions/rejectRequest.ts` —
 * the AC26 / WC.T17 privacy-request reject server action.
 *
 * Run locally:    pnpm test tests/admin/reject-request-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC26.
 *
 * SUT contract:
 *   - First runtime statement is `await requireRole('manager');`.
 *   - Reason length 1..500 — else throws `RejectReasonInvalid`.
 *   - Inside withAudit('admin.privacy.request_rejected', 'privacy_request'):
 *     SELECT status FOR UPDATE; UPDATE status='rejected' WHERE status='pending';
 *     else throw RequestNotPending.
 *   - Audit `after = { status: 'rejected', reject_reason_length: <int> }`.
 *   - Post-tx revalidateTag('admin-dashboard-counts').
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

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

// eslint-disable-next-line import/first
import {
  rejectRequest,
  type TransactionRunner,
} from '@/app/(admin)/admin/privacy/_actions/rejectRequest';
// eslint-disable-next-line import/first
import { RequestNotPending, RejectReasonInvalid } from '@/app/(admin)/admin/_errors';
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
  'rejectRequest.ts',
);

let pg: PGlite;
let manager1: string;
let target1: string;
let pendingExportId: string;
let pendingDeleteId: string;
let alreadyCompletedId: string;

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
  pg = new PGlite();
  await setupAuthStub(pg);
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);
  await runSqlBlock(readFileSync(MIG_0002, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0003, 'utf8'));
  // Migration 0005 provides privacy_requests + its enums.
  await runSqlBlock(readFileSync(MIG_0005, 'utf8'));

  const seedAs = async (role: 'member' | 'manager', label: string): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@reject-request-test.local`,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  target1 = await seedAs('member', 'target1');

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
  // Reset privacy_requests + audit_log between tests.
  await pg.query('DELETE FROM privacy_requests');
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');

  // Seed three rows — a pending export, a pending delete, and an
  // already-completed export (to exercise the status-guard path).
  const pendingExport = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'export', 'pending')
     RETURNING id`,
    [target1, 'pending-export@reject-request-test.local'],
  );
  pendingExportId = pendingExport.rows[0]!.id;

  const pendingDelete = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'delete', 'pending')
     RETURNING id`,
    [target1, 'pending-delete@reject-request-test.local'],
  );
  pendingDeleteId = pendingDelete.rows[0]!.id;

  const completed = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status, resolved_at, resolved_by)
       VALUES ($1, $2, 'export', 'completed', now(), $3)
     RETURNING id`,
    [target1, 'completed@reject-request-test.local', manager1],
  );
  alreadyCompletedId = completed.rows[0]!.id;
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
      WHERE target_type = 'privacy_request' AND target_id = $1
      ORDER BY id ASC`,
    [targetId],
  );
  return result.rows;
}

async function readRequest(id: string): Promise<{ status: string; reject_reason: string | null }> {
  await asServiceRole(pg);
  const r = await pg.query<{ status: string; reject_reason: string | null }>(
    'SELECT status, reject_reason FROM privacy_requests WHERE id = $1',
    [id],
  );
  return r.rows[0]!;
}

// =============================================================================
// AC26.1 — Happy path
// =============================================================================
describe('rejectRequest — AC26 happy path', () => {
  it('sets status=rejected + reject_reason, writes audit row, calls revalidateTag', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const reasonText = 'Unable to verify identity — please contact support';
    const result = await rejectRequest(
      { requestId: pendingExportId, reason: reasonText },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true });

    // Row updated.
    const req = await readRequest(pendingExportId);
    expect(req.status).toBe('rejected');
    expect(req.reject_reason).toBe(reasonText);

    // Exactly one audit row.
    const rows = await readAuditRows(pendingExportId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.privacy.request_rejected');
    expect(rows[0]!.actor_id).toBe(manager1);

    const after = rows[0]!.after as {
      status: string;
      reject_reason_length: number;
    };
    expect(after.status).toBe('rejected');
    expect(after.reject_reason_length).toBe(reasonText.length);

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });

  it('reason at exactly 1 char succeeds', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await rejectRequest({ requestId: pendingExportId, reason: 'x' }, pgliteRunner(pg));

    const rows = await readAuditRows(pendingExportId);
    expect(rows).toHaveLength(1);
    const after = rows[0]!.after as { reject_reason_length: number };
    expect(after.reject_reason_length).toBe(1);
  });

  it('reason at exactly 500 chars succeeds', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const reasonText = 'r'.repeat(500);
    await rejectRequest({ requestId: pendingExportId, reason: reasonText }, pgliteRunner(pg));

    const rows = await readAuditRows(pendingExportId);
    expect(rows).toHaveLength(1);
    const after = rows[0]!.after as { reject_reason_length: number };
    expect(after.reject_reason_length).toBe(500);
  });

  it('works on a kind=delete pending row too', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await rejectRequest(
      { requestId: pendingDeleteId, reason: 'declined per legal review' },
      pgliteRunner(pg),
    );
    const req = await readRequest(pendingDeleteId);
    expect(req.status).toBe('rejected');
  });
});

describe('rejectRequest — transaction rollback', () => {
  it('rolls the status transition back when the audit insert fails', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      rejectRequest(
        { requestId: pendingExportId, reason: 'Cannot satisfy this request.' },
        pgliteRunner(pg, true),
      ),
    ).rejects.toThrow('forced audit insert failure');

    const request = await readRequest(pendingExportId);
    expect(request.status).toBe('pending');
    expect(request.reject_reason).toBeNull();
    expect(await readAuditRows(pendingExportId)).toHaveLength(0);
    expect(cacheSpy.revalidateTag).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AC26.2 — Reason length validation
// =============================================================================
describe('rejectRequest — reason length validation', () => {
  it('empty reason throws RejectReasonInvalid (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      rejectRequest({ requestId: pendingExportId, reason: '' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RejectReasonInvalid);

    const rows = await readAuditRows(pendingExportId);
    expect(rows).toHaveLength(0);
  });

  it('reason at exactly 501 chars throws RejectReasonInvalid (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      rejectRequest({ requestId: pendingExportId, reason: 'x'.repeat(501) }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RejectReasonInvalid);

    const rows = await readAuditRows(pendingExportId);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC26.3 — Status guard
// =============================================================================
describe('rejectRequest — status guard', () => {
  it('re-reject on a completed row throws RequestNotPending (no audit row)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      rejectRequest({ requestId: alreadyCompletedId, reason: 'too late' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RequestNotPending);

    const rows = await readAuditRows(alreadyCompletedId);
    expect(rows).toHaveLength(0);

    // Row still completed — no mutation.
    const req = await readRequest(alreadyCompletedId);
    expect(req.status).toBe('completed');
  });

  it('rejecting a non-existent row throws RequestNotPending (no audit row)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const fakeId = '00000000-0000-4000-8000-000000000000';
    await expect(
      rejectRequest({ requestId: fakeId, reason: 'no row here' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RequestNotPending);

    const rows = await readAuditRows(fakeId);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// Source-shape invariants (AC5, AC28, AC35)
// =============================================================================
describe('rejectRequest — source-shape invariants', () => {
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
    // The audit row uses `reject_reason_length:` — `reject_reason:` (full text)
    // is forbidden per AC28.
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\breject_reason\s*:[^_]/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\breject_reason\s*:[^_]/);
  });
});
