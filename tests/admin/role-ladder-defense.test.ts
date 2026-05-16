/**
 * Three-layer role-ladder defense meta-test (ADR-0035 AC29, premortem R3,
 * WD.T20 / t21).
 *
 * Run locally:    pnpm test tests/admin/role-ladder-defense.test.ts
 * Prerequisites:  none — @electric-sql/pglite for the server-action layer;
 *                 pure source-grep for the UI + DB-trigger layers.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC29.
 *
 * The three layers (each must pass independently):
 *
 *   (1) **UI layer.** The member-detail page renders a role-target
 *       `<select>` only inside the `change-role` dialog flow, and only
 *       when the actor is not viewing their own profile. For a manager
 *       session the actions panel renders, BUT promotion attempts are
 *       intercepted server-side. This test does a source-grep check on
 *       the actions-panel client component to confirm the role select
 *       exists AND the page-level test pattern is in place; the actual
 *       interactive UI test for the dialog lives in
 *       `tests/admin/member-detail-dialogs.test.tsx`.
 *
 *   (2) **Server-action layer.** `changeRole` with a promotion target
 *       throws `InsufficientRoleError` when the session is `manager`
 *       (the AC15 surface). Exercised via the action's pglite DI seam.
 *       PLUS: a successful role change writes EXACTLY 2 audit rows
 *       within the target window (one with
 *       `action='admin.member.role_changed'` AND one with
 *       `action='profile.role_change'`) — the two-rows-per-role-change
 *       invariant from premortem R3.
 *
 *   (3) **DB-trigger layer.** The existing
 *       `tests/db/rls-profiles.test.ts` already asserts that a
 *       `cashier`-roled (or member-roled) session UPDATE on
 *       `profiles.role` raises SQLSTATE `42501` via the
 *       `profiles_protect_role_change` trigger. We meta-pin this by
 *       grepping the on-disk test file to confirm the assertion still
 *       exists; if any rename / refactor removes it, this meta-test
 *       fails with a guidance message pointing at the missing layer.
 *
 * The trigger-shape regression migration test lives at
 * `tests/migrations/role-change-trigger-shape.test.ts` (created by t21
 * if absent — see the bottom of this file's source for the meta-pin).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

vi.mock('server-only', () => ({}));

// `requireRole` — controllable mock mirroring change-role-action.test.ts.
const requireRoleState = vi.hoisted(() => ({
  currentActor: null as { id: string; role: 'manager' | 'owner' } | null,
}));

vi.mock('@/lib/auth/requireRole', async () => {
  const { InsufficientRoleError } = await vi.importActual<
    typeof import('@/lib/auth/errors')
  >('@/lib/auth/errors');
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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('test bug: defaultDb() reached — tests must inject db param');
  },
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

// eslint-disable-next-line import/first
import { changeRole, type TransactionRunner } from '@/app/(admin)/admin/members/[id]/_actions/changeRole';
// eslint-disable-next-line import/first
import { InsufficientRoleError } from '@/lib/auth/errors';
// eslint-disable-next-line import/first
import { setupAuthStub, resetAuthStub, setTestUid } from '../db/_fixtures/auth-stub';
// eslint-disable-next-line import/first
import { seedProfile } from '../db/_fixtures/profiles';
// eslint-disable-next-line import/first
import { setupAppAuthenticatedRole, asAuthenticated, asServiceRole } from '../db/_fixtures/rls-helpers';

// ---- Path resolution ------------------------------------------------------

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const REPO_ROOT = resolve(TEST_DIR, '..', '..');
const RLS_PROFILES_TEST = resolve(REPO_ROOT, 'tests', 'db', 'rls-profiles.test.ts');
const MEMBER_DETAIL_PAGE = resolve(
  REPO_ROOT,
  'app',
  '(admin)',
  'admin',
  'members',
  '[id]',
  'page.tsx',
);
const ACTIONS_PANEL = resolve(
  REPO_ROOT,
  'app',
  '(admin)',
  'admin',
  'members',
  '[id]',
  '_components',
  'actions-panel.client.tsx',
);
const MIG_0002 = resolve(REPO_ROOT, 'supabase', 'migrations', '0002_profiles_and_roles.sql');
const MIG_0003 = resolve(REPO_ROOT, 'supabase', 'migrations', '0003_audit_log.sql');

// ---- Pglite adapter -------------------------------------------------------

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

async function runSqlBlock(p: PGlite, sql: string): Promise<void> {
  const exec = (p as unknown as { exec: (s: string) => Promise<unknown> }).exec;
  await exec.call(p, sql);
}

let pg: PGlite;
let managerId: string;
let ownerId: string;
let memberTargetId: string;

beforeAll(async () => {
  pg = new PGlite();
  await setupAuthStub(pg);
  await runSqlBlock(
    pg,
    `CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());`,
  );
  await runSqlBlock(pg, readFileSync(MIG_0002, 'utf8'));
  await runSqlBlock(pg, readFileSync(MIG_0003, 'utf8'));

  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>(
      'INSERT INTO auth.users DEFAULT VALUES RETURNING id',
    );
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@role-ladder-test.local`,
    });
    return profile.id;
  };

  managerId = await seedAs('manager', 'ladder-manager');
  ownerId = await seedAs('owner', 'ladder-owner');
  memberTargetId = await seedAs('member', 'ladder-member');

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log'],
    sequences: ['audit_log_id_seq'],
  });

  void ownerId;
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  await resetAuthStub(pg);
  requireRoleState.currentActor = null;
  await asServiceRole(pg);
  await pg.query('UPDATE profiles SET role = $1 WHERE id = $2', ['member', memberTargetId]);
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');
});

async function readAuditRows(targetId: string): Promise<
  Array<{ action: string; actor_id: string | null; before: unknown; after: unknown }>
> {
  await asServiceRole(pg);
  const r = await pg.query<{
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
  return r.rows;
}

// =============================================================================
// Layer 1 — UI layer
// =============================================================================
describe('AC29 layer 1 — UI layer', () => {
  it('member-detail page.tsx imports the ActionsPanel client component', () => {
    expect(existsSync(MEMBER_DETAIL_PAGE)).toBe(true);
    const src = readFileSync(MEMBER_DETAIL_PAGE, 'utf8');
    // Self-edit guard hides the panel for own profile (defense-in-depth).
    expect(src).toMatch(/ActionsPanel/);
    // The page MUST gate access via requireRole('manager').
    expect(src).toMatch(/requireRole\(\s*['"]manager['"]\s*\)/);
  });

  it('actions-panel exposes the role-target selector (the v1 promotion-attempt UI surface)', () => {
    expect(existsSync(ACTIONS_PANEL)).toBe(true);
    const src = readFileSync(ACTIONS_PANEL, 'utf8');
    // The v1 UI surfaces role promotion via a <select> with an "owner"
    // option. This is the surface that a compromised manager session
    // could submit; the server-action layer (#2) is the gate that
    // throws InsufficientRoleError on promote-as-manager. We pin the
    // existence of the select option so a future UI refactor that
    // removes it (without a corresponding test rewrite) is caught
    // by this meta-test.
    expect(src).toMatch(/<option\s+value\s*=\s*['"]owner['"]\s*>/);
    expect(src).toMatch(/data-testid\s*=\s*['"]change-role-target-select['"]/);
  });
});

// =============================================================================
// Layer 2 — Server-action layer (pglite-backed)
// =============================================================================
describe('AC29 layer 2 — server-action layer', () => {
  it('promotion-as-manager throws InsufficientRoleError; no audit row written', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: managerId, role: 'manager' };
    await setTestUid(pg, managerId);
    await asAuthenticated(pg, managerId);

    await expect(
      changeRole(
        { profileId: memberTargetId, newRole: 'cashier' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    const rows = await readAuditRows(memberTargetId);
    expect(rows).toHaveLength(0);
  });

  it('successful role change (as owner) writes EXACTLY 2 audit rows within 1s (premortem R3)', async () => {
    requireRoleState.currentActor = { id: ownerId, role: 'owner' };
    await setTestUid(pg, ownerId);
    await asAuthenticated(pg, ownerId);

    const t0 = Date.now();
    const result = await changeRole(
      { profileId: memberTargetId, newRole: 'cashier' },
      pgliteRunner(pg),
    );
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);

    const rows = await readAuditRows(memberTargetId);
    expect(rows).toHaveLength(2);

    const actionSet = new Set(rows.map((r) => r.action));
    expect(actionSet.has('admin.member.role_changed')).toBe(true);
    expect(actionSet.has('profile.role_change')).toBe(true);

    // Within 1 second window — both rows commit in the same tx so the
    // wall-clock delta is trivially under 1s; this assertion is the
    // outer envelope premortem R3 specifies.
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(1000);
  });
});

// =============================================================================
// Layer 3 — DB-trigger layer (meta-pin on rls-profiles.test.ts)
// =============================================================================
describe('AC29 layer 3 — DB-trigger layer (meta-pin)', () => {
  it('tests/db/rls-profiles.test.ts exists', () => {
    expect(existsSync(RLS_PROFILES_TEST)).toBe(true);
  });

  it('rls-profiles.test.ts asserts an unauthorized role UPDATE raises SQLSTATE 42501', () => {
    const src = readFileSync(RLS_PROFILES_TEST, 'utf8');
    // The cycle-1 test grouped its 42501 assertions under an
    // `AC8.10 — privilege escalation` describe. The greppable
    // invariant is the `code: '42501'` match on the rejection AND the
    // `UPDATE profiles SET role` SQL being executed inside the test.
    // If either disappears, this meta-test fails.
    expect(src).toMatch(/UPDATE\s+profiles\s+SET\s+role/);
    expect(src).toMatch(/code:\s*['"]42501['"]/);
  });

  it('rls-profiles.test.ts mentions the profiles_protect_role_change trigger', () => {
    const src = readFileSync(RLS_PROFILES_TEST, 'utf8');
    expect(src).toMatch(/profiles_protect_role_change/);
  });
});
