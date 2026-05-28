/**
 * `/admin/tournaments` — manager+ tournament schedule editor (ADR-0037 Slice 1).
 *
 * Server component. AC5 defense-in-depth: FIRST body statement is
 * `await requireRole('manager');`. Reads templates (admin-only, RLS-gated)
 * and the next 30 days of tournaments (public-select, anyone can read).
 *
 * **Scope** — this slice ships the operational MVP:
 *   - List active + inactive tournament_templates with a Pause/Resume
 *     action per row.
 *   - List the next 30 days of tournaments with a Cancel action per row.
 *
 * **Deferred to a follow-up sub-slice** (documented in the spec):
 *   - Create-new-template form
 *   - Edit-template fields (buy-in, capacity, time-of-day) — admins can
 *     today pause the template, edit the seed values via SQL, and resume.
 *   - Create-one-off tournament form
 *   - Edit-tournament fields (buy-in/capacity/status overrides)
 *   - Hard-delete one-off tournament
 *
 * **Audit posture**: every action wraps the mutation + audit_log INSERT
 * with the codebase's existing best-effort pattern (mutation first, then
 * audit; throw loudly on audit failure). Production atomicity is gated
 * on the pg-driver work tracked separately from this slice.
 */

import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';
import { nowUtc } from '@/lib/time';
import { TemplateRow, type TemplateRowData } from './_components/template-row.client';
import { TournamentRow, type TournamentRowData } from './_components/tournament-row.client';

export const dynamic = 'force-dynamic';

const TH: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontWeight: 500,
  borderBottom: '1px solid var(--border-faint)',
  textAlign: 'left',
};

export default async function AdminTournamentsPage(): Promise<JSX.Element> {
  // AC5: first body statement.
  await requireRole('manager');

  const supabase = createClient();

  const { data: templatesData, error: tplErr } = await supabase
    .from('tournament_templates')
    .select(
      'id, name, slug_prefix, day_of_week, time_of_day_local, tz_name, buy_in_cents, capacity, game_type, active',
    )
    .order('day_of_week', { ascending: true })
    .order('time_of_day_local', { ascending: true });
  if (tplErr) throw new Error(`Failed to load templates: ${tplErr.message}`);

  const now = nowUtc();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  const { data: tournamentsData, error: tnErr } = await supabase
    .from('tournaments')
    .select(
      'id, slug, name, starts_at, tz_name, buy_in_cents, capacity, status, source_template_id',
    )
    .gte('starts_at', nowIso)
    .lte('starts_at', horizon)
    .order('starts_at', { ascending: true });
  if (tnErr) throw new Error(`Failed to load tournaments: ${tnErr.message}`);

  const templates = (templatesData ?? []) as TemplateRowData[];
  const tournaments = (tournamentsData ?? []) as TournamentRowData[];

  return (
    <section style={{ maxWidth: 1280, margin: '0 auto', color: 'var(--ivory-200)' }}>
      <header style={{ marginBottom: 24 }}>
        <div
          className="eyebrow"
          style={{
            fontSize: 11,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 12,
          }}
        >
          Admin Console
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 40,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: '-0.015em',
            margin: 0,
          }}
        >
          Tournament schedule
        </h1>
        <p style={{ color: 'var(--ivory-300)', fontSize: 14, lineHeight: 1.65, marginTop: 8 }}>
          Templates govern the nightly materializer; instances are what shows on /games. Pause a
          template to stop emitting new instances; cancel an individual instance to remove it from
          the public schedule.
        </p>
      </header>

      <h2
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 24,
          fontWeight: 500,
          margin: '32px 0 16px',
        }}
      >
        Templates ({templates.length})
      </h2>
      {templates.length === 0 ? (
        <p role="status" style={{ padding: '24px 16px', color: 'var(--ivory-400)' }}>
          No templates configured.
        </p>
      ) : (
        <div
          style={{
            border: '1px solid var(--border-faint)',
            borderRadius: 8,
            background: 'var(--ink-850)',
            overflow: 'auto',
          }}
        >
          <table
            role="table"
            aria-label="Tournament templates"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--ivory-300)',
            }}
          >
            <thead>
              <tr style={{ background: 'var(--ink-900)' }}>
                <th style={TH}>Name / slug prefix</th>
                <th style={TH}>Day</th>
                <th style={TH}>Time (local)</th>
                <th style={TH}>Zone</th>
                <th style={TH}>Buy-in</th>
                <th style={TH}>Capacity</th>
                <th style={TH}>Game</th>
                <th style={TH}>Status</th>
                <th style={TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <TemplateRow key={t.id} template={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 24,
          fontWeight: 500,
          margin: '48px 0 16px',
        }}
      >
        Next 30 days ({tournaments.length})
      </h2>
      {tournaments.length === 0 ? (
        <p role="status" style={{ padding: '24px 16px', color: 'var(--ivory-400)' }}>
          No tournaments in the next 30 days. Run the materializer cron (
          <code>/api/cron/tournament-materialize</code>) to seed the table.
        </p>
      ) : (
        <div
          style={{
            border: '1px solid var(--border-faint)',
            borderRadius: 8,
            background: 'var(--ink-850)',
            overflow: 'auto',
          }}
        >
          <table
            role="table"
            aria-label="Upcoming tournaments"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--ivory-300)',
            }}
          >
            <thead>
              <tr style={{ background: 'var(--ink-900)' }}>
                <th style={TH}>Starts</th>
                <th style={TH}>Name / slug</th>
                <th style={TH}>Buy-in</th>
                <th style={TH}>Capacity</th>
                <th style={TH}>Status</th>
                <th style={TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <TournamentRow key={t.id} tournament={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
