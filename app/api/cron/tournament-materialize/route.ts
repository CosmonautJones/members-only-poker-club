import { NextResponse, type NextRequest } from 'next/server';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionClient, TransactionRunner } from '@/lib/db/transactions';
import { nowUtc } from '@/lib/time';
import {
  runMaterialize,
  type MaterializeDb,
  type TemplateForMaterialize,
  type NewTournamentRow,
  type InsertOutcome,
  type RunSummary,
} from '@/lib/tournaments/materialize-run';

export const dynamic = 'force-dynamic';

const MATERIALIZE_HORIZON_DAYS = 60;

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get('authorization') ?? '';
  const secret = process.env['CRON_SECRET'];
  return Boolean(secret) && header === `Bearer ${secret}`;
}

export function makeTransactionDb(tx: TransactionClient): MaterializeDb {
  return {
    async listTemplates(): Promise<TemplateForMaterialize[]> {
      const result = await tx.query(
        `SELECT id, name, slug_prefix, day_of_week, time_of_day_local, tz_name,
                buy_in_cents, capacity, game_type, structure_md, active
           FROM tournament_templates`,
      );
      return result.rows as TemplateForMaterialize[];
    },

    async insertTournament(row: NewTournamentRow): Promise<InsertOutcome> {
      const result = await tx.query(
        `INSERT INTO tournaments
          (slug, name, starts_at, tz_name, buy_in_cents, capacity, game_type,
           structure_md, status, source_template_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING
         RETURNING id`,
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
      return result.rows.length === 0 ? { kind: 'duplicate' } : { kind: 'created' };
    },

    async recordAuditRun(summary: RunSummary): Promise<void> {
      await tx.query(
        `INSERT INTO audit_log
          (actor_id, action, target_type, target_id, before, after)
         VALUES (NULL, $1, $2, $3, NULL, $4::jsonb)`,
        ['tournament.materialize_run', 'system', 'tournament_materialize', JSON.stringify(summary)],
      );
    },
  };
}

export async function materializeTournaments(
  now: Date,
  db: TransactionRunner = postgresTransactionRunner,
): Promise<RunSummary> {
  return db.transaction((tx) =>
    runMaterialize(makeTransactionDb(tx), now, { horizonDays: MATERIALIZE_HORIZON_DAYS }),
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let summary: RunSummary;
  try {
    summary = await materializeTournaments(nowUtc());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'materialize_failed', detail: message }, { status: 500 });
  }

  console.info(JSON.stringify({ event: 'tournament_materialize_run', ...summary }));
  return NextResponse.json({ ok: true, summary });
}
