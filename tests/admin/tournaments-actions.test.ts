import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionRunner } from '@/lib/db/transactions';

const auth = vi.hoisted(() => ({
  actor: null as { id: string; role: 'cashier' | 'manager' | 'owner' } | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/requireRole', async () => {
  const { InsufficientRoleError } =
    await vi.importActual<typeof import('@/lib/auth/errors')>('@/lib/auth/errors');
  return {
    requireRole: vi.fn(async (required: string) => {
      const actor = auth.actor;
      if (!actor) throw new Error('test actor missing');
      const rank: Record<string, number> = { cashier: 1, manager: 2, owner: 3 };
      if (rank[actor.role]! < rank[required]!) {
        throw new InsufficientRoleError(required as never, actor.role as never);
      }
      return { profile: actor };
    }),
  };
});

const cache = vi.hoisted(() => ({ path: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  revalidatePath: cache.path,
  revalidateTag: cache.tag,
}));

import { setTemplateActive } from '@/app/(admin)/admin/tournaments/_actions/setTemplateActive';
import { cancelTournament } from '@/app/(admin)/admin/tournaments/_actions/cancelTournament';
import { BadRequest, NoChange } from '@/app/(admin)/admin/_errors';
import { InsufficientRoleError } from '@/lib/auth/errors';

const TEMPLATE_ID = '11111111-1111-1111-1111-111111111111';
const TOURNAMENT_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR_ID = '00000000-0000-0000-0000-000000000099';

interface Row {
  id: string;
  active?: boolean;
  status?: string;
  slug?: string;
  slug_prefix?: string;
  source_template_id?: string | null;
}

interface State {
  templates: Map<string, Row>;
  tournaments: Map<string, Row>;
  audits: Array<Record<string, unknown>>;
}

function initialState(): State {
  return { templates: new Map(), tournaments: new Map(), audits: [] };
}

function atomicRunner(
  state: State,
  options: { failMutation?: boolean; failAudit?: boolean } = {},
): TransactionRunner {
  return {
    async transaction(work) {
      const draft = structuredClone(state);
      const result = await work({
        async query(sql, params = []) {
          const normalized = sql.replace(/\s+/g, ' ').trim();
          if (/^SELECT id, active, slug_prefix FROM tournament_templates/i.test(normalized)) {
            const row = draft.templates.get(params[0] as string);
            return { rows: row ? [row] : [] };
          }
          if (/^UPDATE tournament_templates/i.test(normalized)) {
            if (options.failMutation) throw new Error('template update failed');
            const id = params[0] as string;
            draft.templates.set(id, { ...draft.templates.get(id)!, active: params[1] as boolean });
            return { rows: [] };
          }
          if (/^SELECT id, status, slug, source_template_id FROM tournaments/i.test(normalized)) {
            const row = draft.tournaments.get(params[0] as string);
            return { rows: row ? [row] : [] };
          }
          if (/^UPDATE tournaments/i.test(normalized)) {
            if (options.failMutation) throw new Error('tournament update failed');
            const id = params[0] as string;
            draft.tournaments.set(id, { ...draft.tournaments.get(id)!, status: 'canceled' });
            return { rows: [] };
          }
          if (/^INSERT INTO audit_log/i.test(normalized)) {
            if (options.failAudit) throw new Error('audit insert failed');
            draft.audits.push({
              actor_id: params[0],
              action: params[1],
              target_type: params[2],
              target_id: params[3],
              before: JSON.parse(params[4] as string),
              after: JSON.parse(params[5] as string),
            });
            return { rows: [] };
          }
          throw new Error(`unexpected SQL: ${normalized}`);
        },
      });
      state.templates = draft.templates;
      state.tournaments = draft.tournaments;
      state.audits = draft.audits;
      return result;
    },
  };
}

beforeEach(() => {
  auth.actor = { id: ACTOR_ID, role: 'manager' };
  cache.path.mockReset();
  cache.tag.mockReset();
});

describe('setTemplateActive', () => {
  it('enforces manager authorization and UUID validation before the transaction', async () => {
    const state = initialState();
    auth.actor = { id: ACTOR_ID, role: 'cashier' };
    await expect(
      setTemplateActive({ templateId: TEMPLATE_ID, active: true }, atomicRunner(state)),
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    auth.actor = { id: ACTOR_ID, role: 'manager' };
    await expect(
      setTemplateActive({ templateId: 'bad-id', active: true }, atomicRunner(state)),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(state.audits).toHaveLength(0);
  });

  it('refuses missing and no-change templates without audit noise', async () => {
    const state = initialState();
    await expect(
      setTemplateActive({ templateId: TEMPLATE_ID, active: true }, atomicRunner(state)),
    ).rejects.toBeInstanceOf(BadRequest);

    state.templates.set(TEMPLATE_ID, {
      id: TEMPLATE_ID,
      active: true,
      slug_prefix: 'weekly',
    });
    await expect(
      setTemplateActive({ templateId: TEMPLATE_ID, active: true }, atomicRunner(state)),
    ).rejects.toBeInstanceOf(NoChange);
    expect(state.audits).toHaveLength(0);
  });

  it('updates and audits the transition, then revalidates', async () => {
    const state = initialState();
    state.templates.set(TEMPLATE_ID, {
      id: TEMPLATE_ID,
      active: true,
      slug_prefix: 'weekly',
    });

    await expect(
      setTemplateActive({ templateId: TEMPLATE_ID, active: false }, atomicRunner(state)),
    ).resolves.toEqual({ ok: true });

    expect(state.templates.get(TEMPLATE_ID)?.active).toBe(false);
    expect(state.audits[0]).toMatchObject({
      action: 'tournament_template.set_active',
      before: { active: true },
      after: { active: false },
    });
    expect(cache.path).toHaveBeenCalledWith('/admin/tournaments');
    expect(cache.path).toHaveBeenCalledWith('/games');
  });

  it('rolls the template mutation back when its audit insert fails', async () => {
    const state = initialState();
    state.templates.set(TEMPLATE_ID, {
      id: TEMPLATE_ID,
      active: true,
      slug_prefix: 'weekly',
    });

    await expect(
      setTemplateActive(
        { templateId: TEMPLATE_ID, active: false },
        atomicRunner(state, { failAudit: true }),
      ),
    ).rejects.toThrow('audit insert failed');

    expect(state.templates.get(TEMPLATE_ID)?.active).toBe(true);
    expect(state.audits).toHaveLength(0);
    expect(cache.path).not.toHaveBeenCalled();
  });
});

describe('cancelTournament', () => {
  it('refuses missing, complete, and already-canceled rows without audit noise', async () => {
    const state = initialState();
    await expect(
      cancelTournament({ tournamentId: TOURNAMENT_ID }, atomicRunner(state)),
    ).rejects.toBeInstanceOf(BadRequest);

    state.tournaments.set(TOURNAMENT_ID, {
      id: TOURNAMENT_ID,
      status: 'complete',
      slug: 'weekly-1',
      source_template_id: TEMPLATE_ID,
    });
    await expect(
      cancelTournament({ tournamentId: TOURNAMENT_ID }, atomicRunner(state)),
    ).rejects.toBeInstanceOf(BadRequest);

    state.tournaments.get(TOURNAMENT_ID)!.status = 'canceled';
    await expect(
      cancelTournament({ tournamentId: TOURNAMENT_ID }, atomicRunner(state)),
    ).rejects.toBeInstanceOf(NoChange);
    expect(state.audits).toHaveLength(0);
  });

  it('cancels and audits the transition, then revalidates', async () => {
    const state = initialState();
    state.tournaments.set(TOURNAMENT_ID, {
      id: TOURNAMENT_ID,
      status: 'scheduled',
      slug: 'weekly-1',
      source_template_id: TEMPLATE_ID,
    });

    await expect(
      cancelTournament({ tournamentId: TOURNAMENT_ID }, atomicRunner(state)),
    ).resolves.toEqual({ ok: true });

    expect(state.tournaments.get(TOURNAMENT_ID)?.status).toBe('canceled');
    expect(state.audits[0]).toMatchObject({
      action: 'tournament.cancel',
      before: { status: 'scheduled', slug: 'weekly-1' },
      after: { status: 'canceled', slug: 'weekly-1' },
    });
    expect(cache.path).toHaveBeenCalledWith('/games/weekly-1');
  });

  it('writes no audit when the mutation fails', async () => {
    const state = initialState();
    state.tournaments.set(TOURNAMENT_ID, {
      id: TOURNAMENT_ID,
      status: 'scheduled',
      slug: 'weekly-1',
      source_template_id: TEMPLATE_ID,
    });

    await expect(
      cancelTournament(
        { tournamentId: TOURNAMENT_ID },
        atomicRunner(state, { failMutation: true }),
      ),
    ).rejects.toThrow('tournament update failed');
    expect(state.tournaments.get(TOURNAMENT_ID)?.status).toBe('scheduled');
    expect(state.audits).toHaveLength(0);
  });

  it('rolls cancellation back when its audit insert fails', async () => {
    const state = initialState();
    state.tournaments.set(TOURNAMENT_ID, {
      id: TOURNAMENT_ID,
      status: 'scheduled',
      slug: 'weekly-1',
      source_template_id: TEMPLATE_ID,
    });

    await expect(
      cancelTournament({ tournamentId: TOURNAMENT_ID }, atomicRunner(state, { failAudit: true })),
    ).rejects.toThrow('audit insert failed');
    expect(state.tournaments.get(TOURNAMENT_ID)?.status).toBe('scheduled');
    expect(state.audits).toHaveLength(0);
  });
});
