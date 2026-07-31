/**
 * Tests for `app/(admin)/admin/privacy/_actions/approveExport.ts` —
 * the AC24 / WC.T17 privacy-export approval server action.
 *
 * Run locally:    pnpm test tests/admin/approve-export-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC24.
 *
 * SUT contract:
 *   - First runtime statement is `await requireRole('manager');`.
 *   - Phase 1 (audit-tx): SELECT FOR UPDATE; assert kind='export' AND
 *     status='pending' (else RequestNotPending); UPDATE status='in_progress'.
 *     Audit row written once with before={status:'pending'}, after={status:'in_progress'}.
 *   - Phase 2 (post-tx): generate signed URL (24h TTL); second tx
 *     UPDATE status='completed', resolved_at, export_url.
 *   - Signed-URL failure path: emit
 *     'admin.privacy.export_url_generation_failed' audit event AND
 *     UPDATE status='failed'.
 *   - Post-tx revalidateTag('admin-dashboard-counts').
 *   - Re-approve on completed row throws RequestNotPending (no audit row).
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
    throw new Error('test bug: default adapter reached — tests must inject');
  },
}));

// eslint-disable-next-line import/first
import {
  approveExport,
  type TransactionRunner,
  type ExportStorage,
} from '@/app/(admin)/admin/privacy/_actions/approveExport';
// eslint-disable-next-line import/first
import { RequestNotPending } from '@/app/(admin)/admin/_errors';
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
  'approveExport.ts',
);

let pg: PGlite;
let manager1: string;
let target1: string;
let pendingExportId: string;
let pendingDeleteId: string;
let alreadyInProgressId: string;
let alreadyCompletedId: string;

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

function pgliteRunner(
  p: PGlite,
  options: { rejectAuditInsert?: boolean; events?: string[] } = {},
): TransactionRunner {
  return {
    transaction: async (callback) => {
      const result = await p.transaction(async (tx: PgliteTxLike) => {
        return callback({
          query: async (sql, params) => {
            if (options.rejectAuditInsert && /^\s*INSERT\s+INTO\s+audit_log/i.test(sql)) {
              throw new Error('forced audit insert failure');
            }
            const r = await tx.query(sql, params);
            return { rows: r.rows as unknown[] };
          },
        });
      });
      options.events?.push('transaction-committed');
      return result;
    },
  };
}

// Migration 0005 ships only 'pending' / 'in_progress' / 'completed' /
// 'rejected'; the 'failed' value is added by a future schema migration
// that ADR-0035's premortem-R2 mitigation tracks. For test isolation
// we ALTER the enum once at suite startup.
async function extendStatusEnumWithFailed(p: PGlite): Promise<void> {
  await (p as unknown as { exec: (s: string) => Promise<unknown> }).exec(
    `ALTER TYPE privacy_request_status_t ADD VALUE IF NOT EXISTS 'failed'`,
  );
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
  await runSqlBlock(readFileSync(MIG_0005, 'utf8'));
  await extendStatusEnumWithFailed(pg);

  const seedAs = async (role: 'member' | 'manager', label: string): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@approve-export-test.local`,
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
  await pg.query('DELETE FROM privacy_requests');
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');

  // Seed four rows for the state-transition assertions.
  const pendingExport = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'export', 'pending')
     RETURNING id`,
    [target1, 'pending-export@approve-export-test.local'],
  );
  pendingExportId = pendingExport.rows[0]!.id;

  const pendingDelete = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status)
       VALUES ($1, $2, 'delete', 'pending')
     RETURNING id`,
    [target1, 'pending-delete@approve-export-test.local'],
  );
  pendingDeleteId = pendingDelete.rows[0]!.id;

  const inProgress = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status, resolved_by)
       VALUES ($1, $2, 'export', 'in_progress', $3)
     RETURNING id`,
    [target1, 'inprogress@approve-export-test.local', manager1],
  );
  alreadyInProgressId = inProgress.rows[0]!.id;

  const completed = await pg.query<{ id: string }>(
    `INSERT INTO privacy_requests (profile_id, requester_email, kind, status, resolved_at, resolved_by, export_url)
       VALUES ($1, $2, 'export', 'completed', now(), $3, 'https://signed.test/old.json')
     RETURNING id`,
    [target1, 'completed@approve-export-test.local', manager1],
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

async function readRequest(id: string): Promise<{
  status: string;
  export_url: string | null;
  resolved_at: string | Date | null;
  resolved_by: string | null;
}> {
  await asServiceRole(pg);
  const r = await pg.query<{
    status: string;
    export_url: string | null;
    resolved_at: string | Date | null;
    resolved_by: string | null;
  }>('SELECT status, export_url, resolved_at, resolved_by FROM privacy_requests WHERE id = $1', [
    id,
  ]);
  return r.rows[0]!;
}

function makeStorageStub(opts: { signedUrl?: string; throws?: boolean }): {
  storage: ExportStorage;
  calls: Array<[string, number]>;
} {
  const calls: Array<[string, number]> = [];
  const storage: ExportStorage = {
    async signExportUrl(path, expiresInSeconds) {
      calls.push([path, expiresInSeconds]);
      if (opts.throws) {
        throw new Error('signed-url-rejection');
      }
      return { signedUrl: opts.signedUrl ?? `https://signed.test/${path}` };
    },
  };
  return { storage, calls };
}

// =============================================================================
// AC24.1 — State transitions pending => in_progress => completed
// =============================================================================
describe('approveExport — AC24 state transitions', () => {
  it('first call transitions pending to in_progress to completed, audit fires ONCE on first transition', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const { storage, calls } = makeStorageStub({});
    const result = await approveExport({ requestId: pendingExportId }, pgliteRunner(pg), storage);
    expect(result.ok).toBe(true);
    expect(typeof result.expiresAt).toBe('string');

    // Final status is 'completed' — phase 2 stamped the URL.
    const req = await readRequest(pendingExportId);
    expect(req.status).toBe('completed');
    expect(req.export_url).toMatch(/^https:\/\/signed\.test\//);
    expect(req.resolved_at).not.toBeNull();

    // Storage signing called once with the 24-hour TTL.
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe(86400);

    // Audit row fired ONCE on the pending=>in_progress transition.
    const rows = await readAuditRows(pendingExportId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.privacy.export_approved');
    expect(rows[0]!.actor_id).toBe(manager1);

    const before = rows[0]!.before as { status: string };
    const after = rows[0]!.after as { status: string };
    expect(before.status).toBe('pending');
    expect(after.status).toBe('in_progress');

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });
});

describe('approveExport — transaction and post-commit ordering', () => {
  it('rolls back phase 1 and never signs when the approval audit insert fails', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);
    const storage: ExportStorage = {
      signExportUrl: vi.fn(async () => ({ signedUrl: 'https://signed.test/unused' })),
    };

    await expect(
      approveExport(
        { requestId: pendingExportId },
        pgliteRunner(pg, { rejectAuditInsert: true }),
        storage,
      ),
    ).rejects.toThrow('forced audit insert failure');

    expect((await readRequest(pendingExportId)).status).toBe('pending');
    expect(await readAuditRows(pendingExportId)).toHaveLength(0);
    expect(storage.signExportUrl).not.toHaveBeenCalled();
    expect(cacheSpy.revalidateTag).not.toHaveBeenCalled();
  });

  it('does not call storage until the approval transaction has committed', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);
    const events: string[] = [];
    const storage: ExportStorage = {
      signExportUrl: vi.fn(async () => {
        events.push('storage-sign');
        return { signedUrl: 'https://signed.test/export.json' };
      }),
    };

    await approveExport({ requestId: pendingExportId }, pgliteRunner(pg, { events }), storage);

    expect(events.slice(0, 2)).toEqual(['transaction-committed', 'storage-sign']);
  });
});

// =============================================================================
// AC24.2 — Re-approve on completed row throws
// =============================================================================
describe('approveExport — AC24 status guard', () => {
  it('re-approve on a completed row throws RequestNotPending (no new audit row)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const { storage } = makeStorageStub({});
    await expect(
      approveExport({ requestId: alreadyCompletedId }, pgliteRunner(pg), storage),
    ).rejects.toBeInstanceOf(RequestNotPending);

    const rows = await readAuditRows(alreadyCompletedId);
    expect(rows).toHaveLength(0);
  });

  it('re-approve on an in_progress row throws RequestNotPending', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const { storage } = makeStorageStub({});
    await expect(
      approveExport({ requestId: alreadyInProgressId }, pgliteRunner(pg), storage),
    ).rejects.toBeInstanceOf(RequestNotPending);
  });

  it('approving a kind=delete row throws RequestNotPending (kind guard)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const { storage } = makeStorageStub({});
    await expect(
      approveExport({ requestId: pendingDeleteId }, pgliteRunner(pg), storage),
    ).rejects.toBeInstanceOf(RequestNotPending);

    const rows = await readAuditRows(pendingDeleteId);
    expect(rows).toHaveLength(0);
  });

  it('approving a non-existent row throws RequestNotPending', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const { storage } = makeStorageStub({});
    const fakeId = '00000000-0000-4000-8000-000000000000';
    await expect(
      approveExport({ requestId: fakeId }, pgliteRunner(pg), storage),
    ).rejects.toBeInstanceOf(RequestNotPending);
  });
});

// =============================================================================
// AC24.3 — Signed-URL failure path (premortem R2)
// =============================================================================
describe('approveExport — premortem R2 signed-URL failure', () => {
  it('on signed-URL failure: row to status=failed AND a separate failure audit event fires', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const { storage } = makeStorageStub({ throws: true });
    // The action still returns ok:true because phase 1 committed — the
    // audit-tx for the approval is forever; phase 2 records its own
    // failure event so ops can backfill.
    await approveExport({ requestId: pendingExportId }, pgliteRunner(pg), storage);

    const req = await readRequest(pendingExportId);
    expect(req.status).toBe('failed');
    // No export_url stamped.
    expect(req.export_url).toBeNull();

    // Two audit rows: the original approval AND the failure event.
    const rows = await readAuditRows(pendingExportId);
    expect(rows).toHaveLength(2);
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual([
      'admin.privacy.export_approved',
      'admin.privacy.export_url_generation_failed',
    ]);
  });
});

// =============================================================================
// AC24.4 — No PII in audit row (AC28)
// =============================================================================
describe('approveExport — AC28 no PII in audit row', () => {
  it('before/after JSON does not match /email|full_name|phone|dob/', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const { storage } = makeStorageStub({});
    await approveExport({ requestId: pendingExportId }, pgliteRunner(pg), storage);

    const rows = await readAuditRows(pendingExportId);
    const approvalRow = rows.find((r) => r.action === 'admin.privacy.export_approved');
    expect(approvalRow).toBeTruthy();
    const beforeJson = JSON.stringify(approvalRow!.before);
    const afterJson = JSON.stringify(approvalRow!.after);
    expect(beforeJson).not.toMatch(/email|full_name|phone|dob/);
    expect(afterJson).not.toMatch(/email|full_name|phone|dob/);
  });
});

// =============================================================================
// Source-shape invariants (AC5, AC28, AC35)
// =============================================================================
describe('approveExport — source-shape invariants', () => {
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
  });
});
