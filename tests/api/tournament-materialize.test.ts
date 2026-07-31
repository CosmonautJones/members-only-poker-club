/**
 * Integration tests for `runMaterialize` (ADR-0037).
 *
 * Wires a pglite-backed `MaterializeDb` shim into the same `runMaterialize`
 * loop the production route uses. This exercises:
 *   - Idempotency via the partial unique index `tournaments_template_date_idx`.
 *   - `active = false` template suppression.
 *   - DST spring-forward gap skipping (2026-03-08 in America/Chicago).
 *   - One audit row per run.
 *
 * Substrate: @electric-sql/pglite — real Postgres. The pglite-gotchas KB
 * notes apply: `exec` for multi-statement migrations, `query` for everything
 * else. The pglite default user has BYPASSRLS — service-role-like for our
 * purposes (the materializer in production uses the service-role key with
 * BYPASSRLS too).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAuthStub } from '../db/_fixtures/auth-stub';
import {
  runMaterialize,
  type MaterializeDb,
  type TemplateForMaterialize,
  type NewTournamentRow,
  type InsertOutcome,
  type RunSummary,
} from '@/lib/tournaments/materialize-run';

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

function makePgliteDb(): MaterializeDb {
  return {
    async listTemplates(): Promise<TemplateForMaterialize[]> {
      const r = await pg.query<TemplateForMaterialize>(
        `SELECT id, name, slug_prefix, day_of_week, time_of_day_local,
                tz_name, buy_in_cents, capacity, game_type, structure_md, active
           FROM tournament_templates`,
      );
      return r.rows;
    },

    async insertTournament(row: NewTournamentRow): Promise<InsertOutcome> {
      try {
        await pg.query(
          `INSERT INTO tournaments
             (slug, name, starts_at, tz_name, buy_in_cents, capacity,
              game_type, structure_md, status, source_template_id)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            row.slug,
            row.name,
            row.starts_at,
            row.tz_name,
            row.buy_in_cents,
            row.capacity,
            row.game_type,
            row.structure_md,
            row.status,
            row.source_template_id,
          ],
        );
        return { kind: 'created' };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err.code === '23505') return { kind: 'duplicate' };
        return { kind: 'error', code: err.code ?? null, message: err.message ?? 'unknown' };
      }
    },

    async recordAuditRun(summary: RunSummary): Promise<void> {
      // In tests there's no auth.users seed for actor_id — set NULL (allowed).
      // We also need auth.users to exist as a referenced table (it's created
      // in the test setup below).
      await pg.query(
        `INSERT INTO audit_log
           (actor_id, action, target_type, target_id, before, after)
         VALUES (NULL, $1, $2, $3, NULL, $4::jsonb)`,
        ['tournament.materialize_run', 'system', 'tournament_materialize', JSON.stringify(summary)],
      );
    },
  };
}

beforeAll(async () => {
  pg = new PGlite();

  await setupAuthStub(pg);
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  await runSqlBlock(readFileSync(M('0001_feature_flags.sql'), 'utf8'));
  await runSqlBlock(readFileSync(M('0002_profiles_and_roles.sql'), 'utf8'));
  await runSqlBlock(readFileSync(M('0003_audit_log.sql'), 'utf8'));
  await runSqlBlock(readFileSync(M('0017_tournament_schedule.sql'), 'utf8'));
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  // Reset tournament rows between tests (templates stay — seeded by migration).
  // Also reset audit_log so each test counts cleanly.
  await pg.query('DELETE FROM tournaments');
  await pg.query(`DELETE FROM audit_log WHERE action = 'tournament.materialize_run'`);
});

describe('runMaterialize — idempotency + scope', () => {
  it('first run creates one row per (template, matching-date) pair in the window', async () => {
    const db = makePgliteDb();
    // Anchor `now` to a known Monday so the math is reproducible. Two-week
    // window → 2 Tuesdays, 2 Thursdays, 2 Fridays, 2 Saturdays = 8 rows.
    const now = new Date('2026-06-08T12:00:00Z'); // Monday
    const summary = await runMaterialize(db, now, { horizonDays: 14 });

    expect(summary.errors).toBe(0);
    expect(summary.templates_processed).toBe(4);
    expect(summary.created).toBe(8);
    expect(summary.skipped_existing).toBe(0);
    expect(summary.skipped_dst_gap).toBe(0);
  });

  it('second identical run produces zero new rows (every INSERT is a duplicate)', async () => {
    const db = makePgliteDb();
    const now = new Date('2026-06-08T12:00:00Z');
    await runMaterialize(db, now, { horizonDays: 14 });

    const second = await runMaterialize(db, now, { horizonDays: 14 });
    expect(second.errors).toBe(0);
    expect(second.created).toBe(0);
    expect(second.skipped_existing).toBe(8);

    const r = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM tournaments`);
    expect(r.rows[0]!.n).toBe(8);
  });

  it('inactive templates are skipped (templates_skipped_inactive counts them)', async () => {
    await pg.query(
      `UPDATE tournament_templates SET active = false WHERE slug_prefix = 'tuesday-bounty'`,
    );
    const db = makePgliteDb();
    const now = new Date('2026-06-08T12:00:00Z');
    const summary = await runMaterialize(db, now, { horizonDays: 14 });

    expect(summary.templates_processed).toBe(3);
    expect(summary.templates_skipped_inactive).toBe(1);
    // 6 rows (2 each for Thursday/Friday/Saturday in 14 days starting Mon)
    expect(summary.created).toBe(6);

    // Reactivate so subsequent tests get clean state.
    await pg.query(
      `UPDATE tournament_templates SET active = true WHERE slug_prefix = 'tuesday-bounty'`,
    );
  });

  it('writes one audit_log row per run', async () => {
    const db = makePgliteDb();
    const now = new Date('2026-06-08T12:00:00Z');
    await runMaterialize(db, now, { horizonDays: 14 });
    await runMaterialize(db, now, { horizonDays: 14 });

    const r = await pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
         WHERE action = 'tournament.materialize_run'`,
    );
    expect(r.rows[0]!.n).toBe(2);
  });

  it('partial unique index enforces idempotency even when slug collision would otherwise let two rows in', async () => {
    const db = makePgliteDb();
    const now = new Date('2026-06-08T12:00:00Z');
    await runMaterialize(db, now, { horizonDays: 14 });

    // Manually attempt a second INSERT for the same (template, date) with a
    // DIFFERENT slug. Should be rejected by the partial unique index, not by
    // the slug unique index. This pins that the idempotency anchor is the
    // (template_id, club-local date) tuple, not the slug.
    const tplRes = await pg.query<{ id: string }>(
      `SELECT id FROM tournament_templates WHERE slug_prefix = 'tuesday-bounty'`,
    );
    const tplId = tplRes.rows[0]!.id;
    // Pick a date we know we materialized: 2026-06-09 (Tuesday) at 19:00 CDT
    // = 2026-06-10T00:00Z.
    await expect(
      pg.query(
        `INSERT INTO tournaments
           (slug, name, starts_at, tz_name, buy_in_cents, capacity,
            game_type, status, source_template_id)
         VALUES ('manual-different-slug-same-date', 'X',
                 '2026-06-10T00:00:00Z', 'America/Chicago',
                 0, 1, 'nlhe', 'scheduled', $1)`,
        [tplId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('runMaterialize — DST', () => {
  it('skips the 2026-03-08 spring-forward gap for a 02:30 template', async () => {
    // Insert a synthetic template scheduled for 02:30 local on Sundays.
    // The 2026 US spring-forward is 2026-03-08; 02:30 never existed locally.
    await pg.query(
      `INSERT INTO tournament_templates
         (name, slug_prefix, day_of_week, time_of_day_local, tz_name,
          buy_in_cents, capacity, game_type, active)
       VALUES ('Insomniacs', 'insomniacs', 0, '02:30:00', 'America/Chicago',
               1000, 10, 'nlhe', true)`,
    );

    const db = makePgliteDb();
    // Window covering the Mar 8 Sunday: start from 2026-03-01 (Sun) → 14 days
    // → two Sundays: 2026-03-01 (normal), 2026-03-08 (DST gap).
    const now = new Date('2026-03-01T12:00:00Z');
    const summary = await runMaterialize(db, now, { horizonDays: 14 });

    expect(summary.skipped_dst_gap).toBeGreaterThanOrEqual(1);

    const r = await pg.query<{ n: number; slug: string }>(
      `SELECT slug FROM tournaments
         WHERE slug LIKE 'insomniacs-%' ORDER BY slug`,
    );
    const slugs = r.rows.map((row) => row.slug);
    expect(slugs).toContain('insomniacs-2026-03-01');
    expect(slugs).not.toContain('insomniacs-2026-03-08');

    // Cleanup so subsequent tests get clean state.
    await pg.query(`DELETE FROM tournament_templates WHERE slug_prefix = 'insomniacs'`);
  });
});
