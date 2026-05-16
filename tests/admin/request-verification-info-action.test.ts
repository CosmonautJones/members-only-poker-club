/**
 * Tests for `app/(admin)/admin/verifications/_actions/requestVerificationInfo.ts`
 * — the AC14 / WB.T9 request-verification-info server action.
 *
 * Run locally:    pnpm test tests/admin/request-verification-info-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC14
 *       (message length 1..1000, MessageInvalid; NO schema mutation;
 *       before=null, after={message_length:<int>} — verbatim message
 *       NEVER stored in audit; revalidateTag post-tx).
 *
 * SUT contract (per AC14):
 *   - First runtime statement is `await requireRole('manager');`.
 *   - Self-edit guard throws `SelfEditViolation` BEFORE the audit tx.
 *   - Message length 1..1000 — else throws `MessageInvalid`.
 *   - Inside withAudit('admin.verification.info_requested', 'profile'):
 *     NO schema mutation against profiles. before=null,
 *     after={message_length:<int>}.
 *   - Verbatim message MUST NOT appear in the audit row.
 *   - Post-tx: email stub + revalidateTag('admin-dashboard-counts').
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

vi.mock('server-only', () => ({}));

// requireRole mock — mirrors reject-verification-action.test.ts.
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
  requestVerificationInfo,
  type TransactionRunner,
} from '@/app/(admin)/admin/verifications/_actions/requestVerificationInfo';
// eslint-disable-next-line import/first
import { SelfEditViolation, MessageInvalid } from '@/app/(admin)/admin/_errors';
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
const ACTION_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'app',
  '(admin)',
  'admin',
  'verifications',
  '_actions',
  'requestVerificationInfo.ts',
);

let pg: PGlite;
let manager1: string;
let target1: string;

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

function pgliteRunner(p: PGlite): TransactionRunner {
  return {
    transaction: async (callback) => {
      return p.transaction(async (tx: PgliteTxLike) => {
        return callback({
          query: async (sql, params) => {
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

  const seedAs = async (role: 'member' | 'manager', label: string): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@request-info-test.local`,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  target1 = await seedAs('member', 'target1');

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log'],
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

async function readProfileSnapshot(profileId: string): Promise<Record<string, unknown> | null> {
  await asServiceRole(pg);
  const result = await pg.query<Record<string, unknown>>('SELECT * FROM profiles WHERE id = $1', [
    profileId,
  ]);
  return result.rows[0] ?? null;
}

// =============================================================================
// AC14.1 — Happy path: audit row written, length-only after, no schema mutation
// =============================================================================
describe('requestVerificationInfo — AC14 happy path', () => {
  it('writes audit row with before=null + after={message_length:N}, no schema mutation, calls revalidateTag', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const messageText = 'Please re-upload a clearer photo of your ID — back side too.';
    const profileBefore = await readProfileSnapshot(target1);

    const result = await requestVerificationInfo(
      { profileId: target1, message: messageText },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true });

    // No schema mutation — every column of the profile is unchanged.
    const profileAfter = await readProfileSnapshot(target1);
    expect(profileAfter).toEqual(profileBefore);

    // Exactly one audit row.
    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.verification.info_requested');
    expect(rows[0]!.actor_id).toBe(manager1);

    // before = null, after = { message_length: <int> }. Verbatim
    // message is NEVER in the audit row (AC14 + AC28).
    expect(rows[0]!.before).toBeNull();
    expect(rows[0]!.after).toEqual({ message_length: messageText.length });

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });

  it('message at exactly 1 char succeeds', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await requestVerificationInfo({ profileId: target1, message: 'x' }, pgliteRunner(pg));

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toEqual({ message_length: 1 });
  });

  it('message at exactly 1000 chars succeeds', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await requestVerificationInfo(
      { profileId: target1, message: 'm'.repeat(1000) },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toEqual({ message_length: 1000 });
  });
});

// =============================================================================
// AC14.2 — Self-edit guard
// =============================================================================
describe('requestVerificationInfo — AC14 self-edit guard', () => {
  it('throws SelfEditViolation when profileId === actor.id (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      requestVerificationInfo(
        { profileId: manager1, message: 'self-edit attempt' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(SelfEditViolation);

    const rows = await readAuditRows(manager1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC14.3 — Message length validation
// =============================================================================
describe('requestVerificationInfo — AC14 message length validation', () => {
  it('empty message throws MessageInvalid (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      requestVerificationInfo({ profileId: target1, message: '' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(MessageInvalid);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
  });

  it('message at exactly 1001 chars throws MessageInvalid (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      requestVerificationInfo({ profileId: target1, message: 'x'.repeat(1001) }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(MessageInvalid);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC14.4 — Audit row contains ONLY {message_length:N}, NEVER verbatim message
// =============================================================================
describe('requestVerificationInfo — audit row contains ONLY message_length', () => {
  it('verbatim message text does not appear anywhere in the audit row', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // Pick a uniquely identifiable token so we can grep for it in the
    // serialized audit row.
    const uniqueToken = 'UNIQUE_MESSAGE_TOKEN_8675309';
    const messageText = `Hello, ${uniqueToken}, please re-upload your ID.`;

    await requestVerificationInfo({ profileId: target1, message: messageText }, pgliteRunner(pg));

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const beforeJson = JSON.stringify(rows[0]!.before);
    const afterJson = JSON.stringify(rows[0]!.after);

    // The verbatim message MUST NOT appear anywhere in the audit row.
    expect(beforeJson + afterJson).not.toContain(uniqueToken);
    expect(beforeJson + afterJson).not.toContain('Hello');
    expect(beforeJson + afterJson).not.toContain('please re-upload');

    // Audit `after` is exactly the length-only shape — no other keys.
    expect(rows[0]!.after).toEqual({ message_length: messageText.length });
    expect(Object.keys(rows[0]!.after as object)).toEqual(['message_length']);
  });

  it('audit before/after JSON does not match /email|full_name|phone|dob/ and does not contain the substring "message"', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // Use a message containing the verbatim word "email" — the audit
    // row MUST NOT include this content.
    await requestVerificationInfo(
      { profileId: target1, message: 'Please update your email + phone on file' },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const beforeJson = JSON.stringify(rows[0]!.before);
    const afterJson = JSON.stringify(rows[0]!.after);
    expect(beforeJson).not.toMatch(/email|full_name|phone|dob/);
    expect(afterJson).not.toMatch(/email|full_name|phone|dob/);

    // AC28: 'message:' full text forbidden — only `_length` allowed.
    // The audit must use the `message_length` key (which contains the
    // substring "message" but is paired with the suffix `_length`).
    // We assert the bare key `"message":` is NOT present — only the
    // `_length` variant.
    expect(afterJson).not.toMatch(/"message"\s*:/);
    expect(afterJson).toMatch(/"message_length"\s*:/);
  });
});

// =============================================================================
// AC14.5 — Source-grep: no PII column-name keys in before/after literals
// =============================================================================
describe('requestVerificationInfo — source-shape no-PII (AC28 spot-check)', () => {
  it("source file does not contain the forbidden 'message:' substring in before/after object literals", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // AC28: only `_length` is allowed — `message:` full text forbidden.
    // The negative lookahead permits `message_length:`.
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\bmessage\s*:(?!\s*_)/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\bmessage\s*:(?!\s*_)/);
    // The PII column names per AC28.
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

// =============================================================================
// Source-shape invariants (AC5, AC14, AC35)
// =============================================================================
describe('requestVerificationInfo — source-shape invariants', () => {
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

  it('source does not contain UPDATE/INSERT/DELETE statements against profiles (AC14: no schema mutation)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Be precise: the source MUST NOT issue any UPDATE/INSERT/DELETE
    // against the `profiles` table. INSERT INTO audit_log (which
    // withAudit issues from a separate module) is fine — we are
    // checking THIS source file's SQL strings only.
    expect(src).not.toMatch(/UPDATE\s+profiles\s+SET/i);
    expect(src).not.toMatch(/INSERT\s+INTO\s+profiles\s*\(/i);
    expect(src).not.toMatch(/DELETE\s+FROM\s+profiles\s+WHERE/i);
  });
});
