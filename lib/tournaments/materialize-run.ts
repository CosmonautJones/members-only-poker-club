/**
 * Tournament materializer — the loop, decoupled from the DB driver.
 *
 * The Vercel-cron route in `app/api/cron/tournament-materialize/route.ts`
 * wires a supabase-js admin client into the `MaterializeDb` interface
 * below; integration tests wire a pglite-backed shim with the same
 * interface and exercise the same loop. This split keeps the DST-gap
 * detection + idempotency contract testable without spinning up a
 * fake supabase-js.
 */

import { candidateDates, instanceSlug, parseTimeOfDayLocal, resolveWallTime } from './materialize';

/** Active-template row shape consumed by the loop. */
export interface TemplateForMaterialize {
  id: string;
  name: string;
  slug_prefix: string;
  day_of_week: number;
  time_of_day_local: string;
  tz_name: string;
  buy_in_cents: number;
  capacity: number;
  game_type: 'nlhe' | 'plo' | 'mixed' | 'other';
  structure_md: string | null;
  active: boolean;
}

export interface NewTournamentRow {
  slug: string;
  name: string;
  starts_at: string;
  tz_name: string;
  buy_in_cents: number;
  capacity: number;
  game_type: 'nlhe' | 'plo' | 'mixed' | 'other';
  structure_md: string | null;
  status: 'scheduled';
  source_template_id: string;
}

/**
 * Result of attempting one INSERT.
 *
 *  - `created` — row was inserted.
 *  - `duplicate` — row already existed (SQLSTATE 23505 on the partial unique
 *    index, expected on re-runs).
 *  - `error` — anything else; the adapter passes the DB code + message.
 */
export type InsertOutcome =
  | { kind: 'created' }
  | { kind: 'duplicate' }
  | { kind: 'error'; code: string | null; message: string };

/** Adapter interface — the route + tests both implement this. */
export interface MaterializeDb {
  listTemplates(): Promise<TemplateForMaterialize[]>;
  insertTournament(row: NewTournamentRow): Promise<InsertOutcome>;
  recordAuditRun(summary: RunSummary): Promise<void>;
}

export interface RunSummary {
  created: number;
  skipped_existing: number;
  skipped_dst_gap: number;
  errors: number;
  templates_processed: number;
  templates_skipped_inactive: number;
}

export interface RunOptions {
  /** Window (days) to materialize from `now`. Defaults to 60 per ADR-0037. */
  horizonDays?: number;
  /** Optional structured logger; defaults to `console.warn` / `console.error`. */
  logger?: {
    warn: (payload: object) => void;
    error: (payload: object) => void;
  };
}

const DEFAULT_LOGGER: NonNullable<RunOptions['logger']> = {
  warn: (p) => console.warn(JSON.stringify(p)),
  error: (p) => console.error(JSON.stringify(p)),
};

export async function runMaterialize(
  db: MaterializeDb,
  now: Date,
  options: RunOptions = {},
): Promise<RunSummary> {
  const horizonDays = options.horizonDays ?? 60;
  const log = options.logger ?? DEFAULT_LOGGER;

  const summary: RunSummary = {
    created: 0,
    skipped_existing: 0,
    skipped_dst_gap: 0,
    errors: 0,
    templates_processed: 0,
    templates_skipped_inactive: 0,
  };

  const templates = await db.listTemplates();

  for (const t of templates) {
    if (!t.active) {
      summary.templates_skipped_inactive += 1;
      continue;
    }
    summary.templates_processed += 1;

    const { hour, minute, second } = parseTimeOfDayLocal(t.time_of_day_local);

    for (const date of candidateDates(now, horizonDays, t.day_of_week, t.tz_name)) {
      const resolved = resolveWallTime(
        date.year,
        date.month,
        date.day,
        hour,
        minute,
        t.tz_name,
        second,
      );

      if (resolved.kind === 'dst_gap') {
        summary.skipped_dst_gap += 1;
        log.warn({
          event: 'tournament_materialize_skip',
          reason: 'dst_spring_forward',
          template_id: t.id,
          template_slug_prefix: t.slug_prefix,
          attempted: resolved.attempted,
          tz_name: t.tz_name,
        });
        continue;
      }

      const slug = instanceSlug(t.slug_prefix, date.year, date.month, date.day);

      const outcome = await db.insertTournament({
        slug,
        name: t.name,
        starts_at: resolved.utc.toISOString(),
        tz_name: t.tz_name,
        buy_in_cents: t.buy_in_cents,
        capacity: t.capacity,
        game_type: t.game_type,
        structure_md: t.structure_md,
        status: 'scheduled',
        source_template_id: t.id,
      });

      switch (outcome.kind) {
        case 'created':
          summary.created += 1;
          break;
        case 'duplicate':
          summary.skipped_existing += 1;
          break;
        case 'error':
          summary.errors += 1;
          log.error({
            event: 'tournament_materialize_error',
            template_id: t.id,
            slug,
            starts_at: resolved.utc.toISOString(),
            db_code: outcome.code,
            db_message: outcome.message,
          });
          break;
      }
    }
  }

  await db.recordAuditRun(summary);
  return summary;
}
