import { describe, expect, it, vi } from 'vitest';
import type { TransactionRunner } from '@/lib/db/transactions';

vi.mock('server-only', () => ({}));

import { materializeTournaments } from '@/app/api/cron/tournament-materialize/route';

const TEMPLATE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Weekly',
  slug_prefix: 'weekly',
  day_of_week: 5,
  time_of_day_local: '19:00:00',
  tz_name: 'America/Chicago',
  buy_in_cents: 5000,
  capacity: 40,
  game_type: 'nlhe',
  structure_md: null,
  active: true,
};

interface State {
  tournaments: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
}

function runner(
  state: State,
  options: { failMutation?: boolean; failAudit?: boolean },
  counters: { auditQueries: number },
): TransactionRunner {
  return {
    async transaction(work) {
      const draft = structuredClone(state);
      const result = await work({
        async query(sql, params = []) {
          const normalized = sql.replace(/\s+/g, ' ').trim();
          if (/^SELECT .* FROM tournament_templates/i.test(normalized)) {
            return { rows: [TEMPLATE] };
          }
          if (/^INSERT INTO tournaments/i.test(normalized)) {
            if (options.failMutation) throw new Error('tournament insert failed');
            draft.tournaments.push({ slug: params[0], source_template_id: params[9] });
            return { rows: [{ id: `new-${draft.tournaments.length}` }] };
          }
          if (/^INSERT INTO audit_log/i.test(normalized)) {
            counters.auditQueries += 1;
            if (options.failAudit) throw new Error('audit insert failed');
            draft.audits.push({ action: params[0], after: JSON.parse(params[3] as string) });
            return { rows: [] };
          }
          throw new Error(`unexpected SQL: ${normalized}`);
        },
      });
      Object.assign(state, draft);
      return result;
    },
  };
}

describe('tournament materializer transaction', () => {
  it('rolls every inserted tournament back when the run audit fails', async () => {
    const state: State = { tournaments: [], audits: [] };
    const counters = { auditQueries: 0 };

    await expect(
      materializeTournaments(
        new Date('2026-01-01T00:00:00.000Z'),
        runner(state, { failAudit: true }, counters),
      ),
    ).rejects.toThrow('audit insert failed');

    expect(counters.auditQueries).toBe(1);
    expect(state).toEqual({ tournaments: [], audits: [] });
  });

  it('writes no run audit when a tournament insert fails', async () => {
    const state: State = { tournaments: [], audits: [] };
    const counters = { auditQueries: 0 };

    await expect(
      materializeTournaments(
        new Date('2026-01-01T00:00:00.000Z'),
        runner(state, { failMutation: true }, counters),
      ),
    ).rejects.toThrow('tournament insert failed');

    expect(counters.auditQueries).toBe(0);
    expect(state).toEqual({ tournaments: [], audits: [] });
  });
});
