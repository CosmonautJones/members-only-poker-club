'use client';

import { useState, useTransition } from 'react';
import { setTemplateActive } from '../_actions';

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface TemplateRowData {
  id: string;
  name: string;
  slug_prefix: string;
  day_of_week: number;
  time_of_day_local: string;
  tz_name: string;
  buy_in_cents: number;
  capacity: number;
  game_type: string;
  active: boolean;
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

export function TemplateRow({ template }: { template: TemplateRowData }) {
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onToggle() {
    setErr(null);
    startTransition(async () => {
      try {
        await setTemplateActive({ templateId: template.id, active: !template.active });
        // Server action invokes revalidatePath; force a navigation refresh.
        window.location.reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Update failed');
      }
    });
  }

  return (
    <tr>
      <td style={TD}>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16 }}>{template.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {template.slug_prefix}
        </div>
      </td>
      <td style={TD}>{DOW_NAMES[template.day_of_week]}</td>
      <td style={TD}>{template.time_of_day_local}</td>
      <td style={TD}>{template.tz_name}</td>
      <td style={TD}>${(template.buy_in_cents / 100).toFixed(0)}</td>
      <td style={TD}>{template.capacity}</td>
      <td style={TD}>{template.game_type.toUpperCase()}</td>
      <td style={TD}>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            background: template.active ? 'rgba(180,140,80,0.15)' : 'rgba(160,80,80,0.15)',
            color: template.active ? 'var(--gold-300)' : 'var(--accent-red, #d97070)',
          }}
        >
          {template.active ? 'Active' : 'Paused'}
        </span>
      </td>
      <td style={TD}>
        <button
          type="button"
          onClick={onToggle}
          disabled={isPending}
          style={{ ...BTN, opacity: isPending ? 0.6 : 1 }}
          aria-label={
            template.active
              ? `Deactivate template ${template.name}`
              : `Activate template ${template.name}`
          }
        >
          {isPending ? '…' : template.active ? 'Pause' : 'Resume'}
        </button>
        {err && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--accent-red, #d97070)' }}>
            {err}
          </div>
        )}
      </td>
    </tr>
  );
}
