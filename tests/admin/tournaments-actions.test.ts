/**
 * Unit tests for `app/(admin)/admin/tournaments/_actions/*` (ADR-0037 §Audit).
 *
 * Run locally:    pnpm test tests/admin/tournaments-actions.test.ts
 * Prerequisites:  none — pure module mocks (no DB).
 *
 * Contract:
 *   1. Both actions require manager+ (defense in depth atop middleware/RLS).
 *   2. Both validate the target UUID before any DB call (BadRequest).
 *   3. Both refuse no-op transitions with NoChange (no audit noise).
 *   4. Happy path issues the UPDATE then the audit INSERT (in that order)
 *      and calls revalidatePath('/games') + the admin path.
 *
 * SQL-level guarantees (FK existence, RLS, constraint shapes) are exercised
 * by `tests/db/tournaments-rls.test.ts` against real pglite migrations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireRoleState = vi.hoisted(() => ({
  currentActor: null as { id: string; role: 'cashier' | 'manager' | 'owner' } | null,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/requireRole', async () => {
  const { InsufficientRoleError } =
    await vi.importActual<typeof import('@/lib/auth/errors')>('@/lib/auth/errors');
  return {
    requireRole: vi.fn(async (required: string) => {
      const actor = requireRoleState.currentActor;
      if (!actor) throw new Error('test bug: actor not set');
      const rank: Record<string, number> = { member: 0, cashier: 1, manager: 2, owner: 3 };
      if (rank[actor.role]! < rank[required]!) {
        throw new InsufficientRoleError(required as never, actor.role as never);
      }
      return { profile: { id: actor.id, role: actor.role } };
    }),
  };
});

const cacheSpy = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: cacheSpy.revalidatePath }));

interface FakeRow {
  id: string;
  active?: boolean;
  status?: string;
  slug?: string;
  source_template_id?: string | null;
}
const dbState = vi.hoisted(() => ({
  templates: new Map<string, FakeRow>(),
  tournaments: new Map<string, FakeRow>(),
  audits: [] as Array<Record<string, unknown>>,
  updateError: null as null | { message: string },
  insertError: null as null | { message: string },
}));

/** Tiny supabase-js-shaped query builder backed by Maps. */
function buildSupabaseShim() {
  return {
    from(table: 'tournament_templates' | 'tournaments' | 'audit_log') {
      const api: Record<string, unknown> = {};
      api.select = (_cols: string) => {
        api._mode = 'select';
        return api;
      };
      api.eq = (col: string, val: string) => {
        api._eq = { col, val };
        return api;
      };
      api.maybeSingle = async () => {
        const eq = api._eq as { col: string; val: string } | undefined;
        if (!eq || eq.col !== 'id') {
          throw new Error(`shim: only .eq('id', ...) supported`);
        }
        const map = table === 'tournament_templates' ? dbState.templates : dbState.tournaments;
        const row = map.get(eq.val);
        return { data: row ?? null, error: null };
      };
      api.update = (patch: Record<string, unknown>) => {
        api._update = patch;
        return api;
      };
      api.insert = async (row: Record<string, unknown>) => {
        if (table === 'audit_log') {
          if (dbState.insertError) return { error: dbState.insertError };
          dbState.audits.push(row);
          return { error: null };
        }
        throw new Error(`shim: insert into ${table} not supported in this test harness`);
      };
      // Chain terminator for update.eq() — returns Promise.
      const originalEq = api.eq;
      api.eq = (col: string, val: string) => {
        api._eq = { col, val };
        if (api._update) {
          if (dbState.updateError) {
            return Promise.resolve({ error: dbState.updateError });
          }
          const map = table === 'tournament_templates' ? dbState.templates : dbState.tournaments;
          const existing = map.get(val);
          if (existing) {
            map.set(val, { ...existing, ...api._update });
          }
          return Promise.resolve({ error: null });
        }
        return api;
      };
      // Preserve maybeSingle reference (test depends on it not being lost).
      void originalEq;
      return api;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => buildSupabaseShim(),
}));

// Imports AFTER mocks so the SUTs pick up our injected modules.
import { setTemplateActive } from '@/app/(admin)/admin/tournaments/_actions/setTemplateActive';
import { cancelTournament } from '@/app/(admin)/admin/tournaments/_actions/cancelTournament';
import { BadRequest, NoChange } from '@/app/(admin)/admin/_errors';
import { InsufficientRoleError } from '@/lib/auth/errors';

const VALID_UUID_1 = '11111111-1111-1111-1111-111111111111';
const VALID_UUID_2 = '22222222-2222-2222-2222-222222222222';
const ACTOR_UUID = '00000000-0000-0000-0000-000000000099';

beforeEach(() => {
  dbState.templates.clear();
  dbState.tournaments.clear();
  dbState.audits.length = 0;
  dbState.updateError = null;
  dbState.insertError = null;
  cacheSpy.revalidatePath.mockReset();
});

describe('setTemplateActive', () => {
  it('rejects a cashier session with InsufficientRoleError (defense in depth)', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'cashier' };
    dbState.templates.set(VALID_UUID_1, { id: VALID_UUID_1, active: true });

    await expect(
      setTemplateActive({ templateId: VALID_UUID_1, active: false }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(dbState.audits).toHaveLength(0);
  });

  it('throws BadRequest on a malformed templateId (no DB calls)', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    await expect(
      setTemplateActive({ templateId: 'not-a-uuid', active: true }),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(dbState.audits).toHaveLength(0);
  });

  it('throws BadRequest when the template does not exist', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    await expect(
      setTemplateActive({ templateId: VALID_UUID_1, active: true }),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(dbState.audits).toHaveLength(0);
  });

  it('throws NoChange when the requested value matches the current row', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    dbState.templates.set(VALID_UUID_1, { id: VALID_UUID_1, active: true });

    await expect(
      setTemplateActive({ templateId: VALID_UUID_1, active: true }),
    ).rejects.toBeInstanceOf(NoChange);
    expect(dbState.audits).toHaveLength(0);
  });

  it('happy path: updates row, writes audit row, revalidates pages', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    dbState.templates.set(VALID_UUID_1, { id: VALID_UUID_1, active: true });

    const result = await setTemplateActive({ templateId: VALID_UUID_1, active: false });
    expect(result.ok).toBe(true);

    expect(dbState.templates.get(VALID_UUID_1)?.active).toBe(false);
    expect(dbState.audits).toHaveLength(1);
    const row = dbState.audits[0]!;
    expect(row).toMatchObject({
      actor_id: ACTOR_UUID,
      action: 'tournament_template.set_active',
      target_type: 'tournament_template',
      target_id: VALID_UUID_1,
    });
    expect(row.before).toMatchObject({ active: true });
    expect(row.after).toMatchObject({ active: false });

    expect(cacheSpy.revalidatePath).toHaveBeenCalledWith('/admin/tournaments');
    expect(cacheSpy.revalidatePath).toHaveBeenCalledWith('/games');
  });
});

describe('cancelTournament', () => {
  it('rejects a member session', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'cashier' };
    dbState.tournaments.set(VALID_UUID_2, {
      id: VALID_UUID_2,
      status: 'scheduled',
      slug: 'tuesday-bounty-2026-06-09',
    });

    await expect(cancelTournament({ tournamentId: VALID_UUID_2 })).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
  });

  it('throws BadRequest on a malformed UUID', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    await expect(cancelTournament({ tournamentId: 'garbage' })).rejects.toBeInstanceOf(BadRequest);
  });

  it('throws NoChange when already canceled', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    dbState.tournaments.set(VALID_UUID_2, {
      id: VALID_UUID_2,
      status: 'canceled',
      slug: 'x',
    });
    await expect(cancelTournament({ tournamentId: VALID_UUID_2 })).rejects.toBeInstanceOf(NoChange);
  });

  it('throws BadRequest when the tournament is already complete', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    dbState.tournaments.set(VALID_UUID_2, {
      id: VALID_UUID_2,
      status: 'complete',
      slug: 'x',
    });
    await expect(cancelTournament({ tournamentId: VALID_UUID_2 })).rejects.toBeInstanceOf(
      BadRequest,
    );
  });

  it('happy path: status flips to canceled, audit row written, paths revalidated', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    dbState.tournaments.set(VALID_UUID_2, {
      id: VALID_UUID_2,
      status: 'scheduled',
      slug: 'tuesday-bounty-2026-06-09',
      source_template_id: '00000000-0000-0000-0000-000000000003',
    });

    const result = await cancelTournament({ tournamentId: VALID_UUID_2 });
    expect(result.ok).toBe(true);

    expect(dbState.tournaments.get(VALID_UUID_2)?.status).toBe('canceled');
    expect(dbState.audits).toHaveLength(1);
    const row = dbState.audits[0]!;
    expect(row).toMatchObject({
      actor_id: ACTOR_UUID,
      action: 'tournament.cancel',
      target_type: 'tournament',
      target_id: VALID_UUID_2,
    });
    expect(row.before).toMatchObject({ status: 'scheduled' });
    expect(row.after).toMatchObject({ status: 'canceled' });

    expect(cacheSpy.revalidatePath).toHaveBeenCalledWith('/games');
    expect(cacheSpy.revalidatePath).toHaveBeenCalledWith('/games/tuesday-bounty-2026-06-09');
  });

  it('audit-write failure surfaces a loud error AFTER the mutation has applied', async () => {
    requireRoleState.currentActor = { id: ACTOR_UUID, role: 'manager' };
    dbState.tournaments.set(VALID_UUID_2, {
      id: VALID_UUID_2,
      status: 'scheduled',
      slug: 'x',
    });
    dbState.insertError = { message: 'audit table out of disk' };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(cancelTournament({ tournamentId: VALID_UUID_2 })).rejects.toThrow(
      /audit write failed/i,
    );
    // Mutation already applied — that's the known posture and the test pins it.
    expect(dbState.tournaments.get(VALID_UUID_2)?.status).toBe('canceled');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
