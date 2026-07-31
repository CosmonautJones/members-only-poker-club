/**
 * RLS unit tests for the `tournaments` + `tournament_templates` tables
 * (ADR-0037 Slice 1, spec §RLS policies).
 *
 * Run locally:    pnpm test tests/db/tournaments-rls.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 *
 * Spec: docs/specs/0037-tournament-schedule-implementation.md (RLS section).
 * Migrations under test:
 *   - supabase/migrations/0001_feature_flags.sql       (cycle 1 substrate)
 *   - supabase/migrations/0002_profiles_and_roles.sql  (role ladder + helper)
 *   - supabase/migrations/0017_tournament_schedule.sql (the ADR-0037 RLS posture)
 *
 * Substrate: @electric-sql/pglite — real Postgres (RLS, policies, SQLSTATE
 * codes all behave as in production). pglite-gotchas: the default postgres
 * user has BYPASSRLS, so every per-test query SETs ROLE app_authenticated
 * (NOBYPASSRLS) to mirror Supabase's `authenticated` role.
 *
 * Sub-cases:
 *   tournaments (public SELECT, admin write):
 *     1. anon SELECT — succeeds, returns zero rows (no seeded instances).
 *     2. member SELECT — succeeds, returns instances.
 *     3. cashier SELECT — succeeds.
 *     4. manager SELECT — succeeds.
 *     5. member INSERT — denied (42501).
 *     6. member UPDATE — silent filter (rowCount = 0).
 *     7. member DELETE — silent filter (rowCount = 0).
 *     8. cashier writes denied identically (sub-case-5/6/7 shape).
 *     9. manager INSERT/UPDATE/DELETE — succeed with post-state verified.
 *    10. service-role bypass — superuser can SELECT/INSERT regardless.
 *   tournament_templates (admin-only on read AND write):
 *    11. anon SELECT — returns zero rows (USING filter is FALSE for anon).
 *    12. member SELECT — returns zero rows.
 *    13. cashier SELECT — returns zero rows.
 *    14. manager SELECT — returns the 4 seeded templates.
 *    15. member INSERT — denied (42501).
 *    16. manager INSERT — succeeds.
 *    17. structural — RLS enabled+forced on both tables, expected policies present.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite, type Results } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAuthStub, setTestUid, resetAuthStub } from './_fixtures/auth-stub';
import { seedProfile } from './_fixtures/profiles';
import {
  setupAppAuthenticatedRole,
  asAuthenticated,
  asServiceRole,
  withRollback,
} from './_fixtures/rls-helpers';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;

const M = (n: string): string => resolve(TEST_DIR, '..', '..', 'supabase', 'migrations', n);

let pg: PGlite;

async function runSqlBlock(sql: string): Promise<void> {
  await (pg as unknown as { exec: (s: string) => Promise<unknown> }).exec(sql);
}

let memberA = '';
let cashier = '';
let manager = '';
let owner = '';
let seededTournamentId = '';

beforeAll(async () => {
  pg = new PGlite();

  await setupAuthStub(pg);
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  // Apply the three migrations in order. 0001 isn't strictly required here
  // but matches the rls-feature-flags pattern (cycle-1 substrate).
  await runSqlBlock(readFileSync(M('0001_feature_flags.sql'), 'utf8'));
  await runSqlBlock(readFileSync(M('0002_profiles_and_roles.sql'), 'utf8'));
  await runSqlBlock(readFileSync(M('0017_tournament_schedule.sql'), 'utf8'));

  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@tournaments-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // Seed one tournament instance under service-role so the public-SELECT
  // sub-cases have something to count. starts_at one week out, in UTC.
  const inserted = await pg.query<{ id: string }>(
    `INSERT INTO tournaments
       (slug, name, starts_at, tz_name, buy_in_cents, capacity, game_type, status)
     VALUES
       ('test-seeded-tournament', 'Test Seeded Tournament',
        now() + interval '7 days', 'America/Chicago',
        10000, 60, 'nlhe', 'scheduled')
     RETURNING id`,
  );
  seededTournamentId = inserted.rows[0]!.id;

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'tournaments', 'tournament_templates'],
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
// Structural — RLS enabled+forced; expected policies present.
// =============================================================================
describe('structural — RLS posture', () => {
  it('tournaments: RLS enabled AND forced', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'public.tournaments'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('tournament_templates: RLS enabled AND forced', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'public.tournament_templates'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('tournaments has the expected two policy names', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid = 'public.tournaments'::regclass
        ORDER BY polname`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual([
      'tournaments_select_public',
      'tournaments_write_admin',
    ]);
  });

  it('tournament_templates has exactly one policy', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid = 'public.tournament_templates'::regclass`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual(['tournament_templates_admin_only']);
  });

  it('seeded templates are present (sanity)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournament_templates');
    expect(r.rows[0]!.n).toBe(4);
  });
});

// =============================================================================
// tournaments — public SELECT semantics.
// =============================================================================
describe('tournaments — SELECT is public', () => {
  it('anon (no auth.uid) CAN SELECT seeded tournament', async () => {
    // No setTestUid → auth.uid() returns null, but USING(true) admits anyway.
    const r = await pg.query<{ slug: string }>('SELECT slug FROM tournaments WHERE id = $1', [
      seededTournamentId,
    ]);
    expect(r.rows[0]?.slug).toBe('test-seeded-tournament');
  });

  it('member CAN SELECT', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournaments');
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it('cashier CAN SELECT', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournaments');
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it('manager CAN SELECT', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournaments');
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// tournaments — non-admin writes denied.
// =============================================================================
describe('tournaments — member writes denied', () => {
  it('member INSERT raises SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(
          `INSERT INTO tournaments
             (slug, name, starts_at, buy_in_cents, capacity, game_type)
           VALUES ($1, $2, now() + interval '5 days', 0, 1, 'nlhe')`,
          ['member-tried-insert', 'X'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('member UPDATE affects zero rows (silent filter)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const upd = (await pg.query(`UPDATE tournaments SET name = 'tampered' WHERE id = $1`, [
        seededTournamentId,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      await asServiceRole(pg);
      const after = await pg.query<{ name: string }>('SELECT name FROM tournaments WHERE id = $1', [
        seededTournamentId,
      ]);
      expect(after.rows[0]?.name).toBe('Test Seeded Tournament');
    });
  });

  it('member DELETE affects zero rows', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const del = (await pg.query(`DELETE FROM tournaments WHERE id = $1`, [
        seededTournamentId,
      ])) as Results;
      expect(del.affectedRows ?? 0).toBe(0);
    });
  });
});

describe('tournaments — cashier writes denied (same shape as member)', () => {
  it('cashier INSERT raises 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      await expect(
        pg.query(
          `INSERT INTO tournaments
             (slug, name, starts_at, buy_in_cents, capacity, game_type)
           VALUES ($1, $2, now() + interval '5 days', 0, 1, 'nlhe')`,
          ['cashier-tried-insert', 'X'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('cashier UPDATE affects zero rows', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      const upd = (await pg.query(`UPDATE tournaments SET name = 'tampered' WHERE id = $1`, [
        seededTournamentId,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);
    });
  });
});

describe('tournaments — manager+ writes succeed', () => {
  it('manager INSERT succeeds; row visible under SELECT', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      await pg.query(
        `INSERT INTO tournaments
           (slug, name, starts_at, buy_in_cents, capacity, game_type)
         VALUES ($1, $2, now() + interval '12 days', 1000, 10, 'plo')`,
        ['manager-inserted-tournament', 'Manager Insert'],
      );
      const r = await pg.query<{ name: string }>('SELECT name FROM tournaments WHERE slug = $1', [
        'manager-inserted-tournament',
      ]);
      expect(r.rows[0]?.name).toBe('Manager Insert');
    });
  });

  it('manager UPDATE changes the row; verified under service-role read-back', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(`UPDATE tournaments SET status = 'canceled' WHERE id = $1`, [
        seededTournamentId,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      await asServiceRole(pg);
      const after = await pg.query<{ status: string }>(
        'SELECT status FROM tournaments WHERE id = $1',
        [seededTournamentId],
      );
      expect(after.rows[0]?.status).toBe('canceled');
    });
  });

  it('owner DELETE removes the row', async () => {
    await withRollback(pg, async () => {
      // Create a doomed row first under manager so the test is self-contained.
      await asServiceRole(pg);
      const ins = await pg.query<{ id: string }>(
        `INSERT INTO tournaments
           (slug, name, starts_at, buy_in_cents, capacity, game_type)
         VALUES ('owner-delete-target', 'Will be deleted',
                 now() + interval '20 days', 0, 1, 'nlhe')
         RETURNING id`,
      );
      const id = ins.rows[0]!.id;

      await asAuthenticated(pg);
      await setTestUid(pg, owner);
      const del = (await pg.query(`DELETE FROM tournaments WHERE id = $1`, [id])) as Results;
      expect(del.affectedRows ?? 0).toBe(1);
    });
  });
});

// =============================================================================
// service-role bypass
// =============================================================================
describe('tournaments — service-role bypass', () => {
  it('service-role (superuser) can INSERT and SELECT regardless of policies', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      await pg.query(
        `INSERT INTO tournaments
           (slug, name, starts_at, buy_in_cents, capacity, game_type)
         VALUES ('service-role-insert', 'svc',
                 now() + interval '30 days', 0, 1, 'nlhe')`,
      );
      const r = await pg.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM tournaments WHERE slug = 'service-role-insert'`,
      );
      expect(r.rows[0]!.n).toBe(1);
    });
  });
});

// =============================================================================
// tournament_templates — admin-only on read AND write.
// =============================================================================
describe('tournament_templates — non-admin SELECT is silently filtered', () => {
  it('anon SELECT returns zero rows', async () => {
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournament_templates');
    expect(r.rows[0]!.n).toBe(0);
  });

  it('member SELECT returns zero rows', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournament_templates');
    expect(r.rows[0]!.n).toBe(0);
  });

  it('cashier SELECT returns zero rows', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournament_templates');
    expect(r.rows[0]!.n).toBe(0);
  });
});

describe('tournament_templates — manager+ has full access', () => {
  it('manager SELECT returns the seeded templates', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournament_templates');
    expect(r.rows[0]!.n).toBe(4);
  });

  it('owner SELECT returns the seeded templates', async () => {
    await setTestUid(pg, owner);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM tournament_templates');
    expect(r.rows[0]!.n).toBe(4);
  });

  it('manager INSERT succeeds', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      await pg.query(
        `INSERT INTO tournament_templates
           (name, slug_prefix, day_of_week, time_of_day_local, buy_in_cents,
            capacity, game_type)
         VALUES ($1, $2, 3, '18:00:00', 0, 1, 'nlhe')`,
        ['Manager Template', 'manager-template'],
      );
      const r = await pg.query<{ name: string }>(
        `SELECT name FROM tournament_templates WHERE slug_prefix = 'manager-template'`,
      );
      expect(r.rows[0]?.name).toBe('Manager Template');
    });
  });
});

describe('tournament_templates — non-admin writes denied with 42501', () => {
  it('member INSERT raises 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(
          `INSERT INTO tournament_templates
             (name, slug_prefix, day_of_week, time_of_day_local, buy_in_cents,
              capacity, game_type)
           VALUES ($1, $2, 1, '18:00:00', 0, 1, 'nlhe')`,
          ['Member Template', 'member-template'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('cashier INSERT raises 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      await expect(
        pg.query(
          `INSERT INTO tournament_templates
             (name, slug_prefix, day_of_week, time_of_day_local, buy_in_cents,
              capacity, game_type)
           VALUES ($1, $2, 1, '18:00:00', 0, 1, 'nlhe')`,
          ['Cashier Template', 'cashier-template'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
