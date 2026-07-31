import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { nowUtc } from '@/lib/time';
import {
  runMaterialize,
  type MaterializeDb,
  type TemplateForMaterialize,
  type NewTournamentRow,
  type InsertOutcome,
  type RunSummary,
} from '@/lib/tournaments/materialize-run';

/**
 * Nightly tournament materializer (ADR-0037).
 *
 * Configured as a Vercel Cron job; auth via `Authorization: Bearer
 * ${CRON_SECRET}` (ADR-0007). Reads active templates, projects each onto
 * the next 60 days, idempotently inserts the resulting instances, skips
 * the DST spring-forward gap with a structured log, and writes a single
 * audit row per run.
 *
 * The loop body lives in `lib/tournaments/materialize-run.ts` —
 * integration tests exercise the same logic via a pglite-backed
 * `MaterializeDb` adapter without ever touching this route.
 */

export const dynamic = 'force-dynamic';

const MATERIALIZE_HORIZON_DAYS = 60;

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get('authorization') ?? '';
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    // Misconfig: refuse rather than allow. Vercel Cron requires the env var.
    return false;
  }
  return header === `Bearer ${secret}`;
}

interface SupabaseQueryError {
  code?: string | null;
  message?: string;
}

function makeSupabaseDb(supabase: ReturnType<typeof createAdminClient>): MaterializeDb {
  return {
    async listTemplates(): Promise<TemplateForMaterialize[]> {
      const { data, error } = await supabase
        .from('tournament_templates')
        .select(
          'id, name, slug_prefix, day_of_week, time_of_day_local, tz_name, buy_in_cents, capacity, game_type, structure_md, active',
        );
      if (error) throw new Error(`listTemplates: ${error.message}`);
      return (data ?? []) as unknown[] as TemplateForMaterialize[];
    },

    async insertTournament(row: NewTournamentRow): Promise<InsertOutcome> {
      const { error } = await supabase.from('tournaments').insert(row);
      if (!error) return { kind: 'created' };
      const e = error as SupabaseQueryError;
      if (e.code === '23505') return { kind: 'duplicate' };
      return { kind: 'error', code: e.code ?? null, message: e.message ?? 'unknown' };
    },

    async recordAuditRun(summary: RunSummary): Promise<void> {
      const { error } = await supabase.from('audit_log').insert({
        actor_id: null,
        action: 'tournament.materialize_run',
        target_type: 'system',
        target_id: 'tournament_materialize',
        before: null,
        after: summary,
      });
      if (error) throw new Error(`audit_log insert failed: ${error.message}`);
    },
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let summary: RunSummary;
  try {
    const supabase = createAdminClient();
    const db = makeSupabaseDb(supabase);
    summary = await runMaterialize(db, nowUtc(), { horizonDays: MATERIALIZE_HORIZON_DAYS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'materialize_failed', detail: message }, { status: 500 });
  }

  // Single structured "run completed" log line for observability.
  console.info(JSON.stringify({ event: 'tournament_materialize_run', ...summary }));

  return NextResponse.json({ ok: true, summary });
}
