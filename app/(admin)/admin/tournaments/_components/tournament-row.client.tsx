'use client';

import { useState, useTransition } from 'react';
import { cancelTournament } from '../_actions';

export interface TournamentRowData {
  id: string;
  slug: string;
  name: string;
  starts_at: string;
  tz_name: string;
  buy_in_cents: number;
  capacity: number;
  status: 'scheduled' | 'registering' | 'live' | 'complete' | 'canceled';
  source_template_id: string | null;
}

const TD: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 13,
  color: 'var(--ivory-300)',
  borderBottom: '1px solid var(--border-faint)',
  verticalAlign: 'middle',
};

const BTN: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid var(--border-faint)',
  background: 'transparent',
  color: 'var(--ivory-200)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 4,
};

const startsAtFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function TournamentRow({ tournament }: { tournament: TournamentRowData }) {
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onCancel() {
    if (!window.confirm(`Cancel "${tournament.name}"? This sets its status to canceled.`)) return;
    setErr(null);
    startTransition(async () => {
      try {
        await cancelTournament({ tournamentId: tournament.id });
        window.location.reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Cancel failed');
      }
    });
  }

  const formattedStart = startsAtFormatter.format(new Date(tournament.starts_at));

  const isCanceled = tournament.status === 'canceled';
  const isComplete = tournament.status === 'complete';
  const canCancel = !isCanceled && !isComplete;

  return (
    <tr>
      <td style={TD}>{formattedStart}</td>
      <td style={TD}>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16 }}>
          {tournament.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {tournament.slug}
          {tournament.source_template_id === null ? ' · one-off' : ''}
        </div>
      </td>
      <td style={TD}>${(tournament.buy_in_cents / 100).toFixed(0)}</td>
      <td style={TD}>{tournament.capacity}</td>
      <td style={TD}>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            background: isCanceled
              ? 'rgba(160,80,80,0.15)'
              : isComplete
                ? 'rgba(120,120,120,0.15)'
                : 'rgba(180,140,80,0.15)',
            color: isCanceled
              ? 'var(--accent-red, #d97070)'
              : isComplete
                ? 'var(--ivory-400)'
                : 'var(--gold-300)',
          }}
        >
          {tournament.status}
        </span>
      </td>
      <td style={TD}>
        {canCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            style={{ ...BTN, opacity: isPending ? 0.6 : 1 }}
            aria-label={`Cancel tournament ${tournament.name}`}
          >
            {isPending ? '…' : 'Cancel'}
          </button>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
        )}
        {err && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--accent-red, #d97070)' }}>
            {err}
          </div>
        )}
      </td>
    </tr>
  );
}
