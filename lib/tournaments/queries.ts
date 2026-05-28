import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { NAP } from '@/lib/content/nap';
import { nowUtc } from '@/lib/time';
import type { Tournament } from './types';

/**
 * Read layer for the `tournaments` table.
 *
 * Per ADR-0037, `/games` and `/games/[slug]` read live data through this
 * module. The tournaments table is RLS-protected with
 * `tournaments_select_public USING(true)` — anonymous traffic from the
 * marketing surface succeeds without an authenticated session.
 *
 * Throws are bubbled to the caller. Pages handle the error case by
 * rendering an explicit fallback message + Sentry capture per the spec
 * (no silent fallback to stale data).
 */

const venueAddress = `${NAP.address.streetAddress}, ${NAP.address.addressLocality}, ${NAP.address.addressRegion} ${NAP.address.postalCode}`;

interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  starts_at: string;
  tz_name: string;
  buy_in_cents: number;
  capacity: number;
  game_type: Tournament['gameType'];
  structure_md: string | null;
  status: Tournament['status'];
  source_template_id: string | null;
}

function rowToTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    startsAt: row.starts_at,
    tzName: row.tz_name,
    buyInCents: row.buy_in_cents,
    capacity: row.capacity,
    gameType: row.game_type,
    structureMd: row.structure_md,
    status: row.status,
    sourceTemplateId: row.source_template_id,
    venueName: NAP.name,
    venueAddress,
  };
}

const SELECT_COLUMNS =
  'id, slug, name, starts_at, tz_name, buy_in_cents, capacity, game_type, structure_md, status, source_template_id';

export interface FetchUpcomingTournamentsOptions {
  /** How many days ahead to include. Defaults to 30 per the spec. */
  days?: number;
}

/**
 * Return all `scheduled` tournaments with `starts_at` between now and
 * now + `days` (default 30), ordered by `starts_at` ascending. Canceled
 * and complete instances are excluded.
 *
 * Throws on query error — caller wraps in `.catch(captureException)` and
 * renders the explicit "schedule loading" fallback per ADR-0037.
 */
export async function fetchUpcomingTournaments(
  options: FetchUpcomingTournamentsOptions = {},
): Promise<Tournament[]> {
  const days = options.days ?? 30;
  const supabase = createClient();

  const now = nowUtc();
  const nowIso = now.toISOString();
  // Compute the upper bound by milliseconds — explicit because pages must be
  // deterministic and we want the calculation visible (not buried in Postgres
  // interval syntax that needs the DB to be reachable just for now()+30d).
  const horizonIso = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('tournaments')
    .select(SELECT_COLUMNS)
    .eq('status', 'scheduled')
    .gte('starts_at', nowIso)
    .lte('starts_at', horizonIso)
    .order('starts_at', { ascending: true });

  if (error) {
    throw new Error(`fetchUpcomingTournaments: ${error.message}`);
  }

  const rows = (data ?? []) as unknown[] as TournamentRow[];
  return rows.map(rowToTournament);
}

/**
 * Look up a single tournament by `slug`. Returns `null` if no row matches
 * or if the row's status is `'canceled'` — canceled tournaments should not
 * appear in SEO surfaces or detail routes (the page calls `notFound()`).
 *
 * Throws on query error (distinct from "not found") so the caller can
 * differentiate the not-found 404 from an infrastructure 500.
 */
export async function fetchTournamentBySlug(slug: string): Promise<Tournament | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('tournaments')
    .select(SELECT_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    throw new Error(`fetchTournamentBySlug: ${error.message}`);
  }
  if (!data) return null;
  const row: TournamentRow = data;
  if (row.status === 'canceled') return null;
  return rowToTournament(row);
}
