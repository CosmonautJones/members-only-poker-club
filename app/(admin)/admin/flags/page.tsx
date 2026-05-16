/**
 * `/admin/flags` — manager+ feature-flag toggles page (ADR-0035 AC21, WC.T16).
 *
 * Server component. Reads from the `feature_flags` table via the
 * cookie-scoped supabase client (RLS evaluates against caller — post-AC2
 * the table is RLS-enabled with `feature_flags_select_authenticated` +
 * `feature_flags_write_manager` policies; manager+ may UPDATE rows).
 *
 * Columns (in order — pinned by AC21):
 *   1. key
 *   2. enabled (toggle)
 *   3. percent (slider 0-100)
 *   4. allowlist[] count
 *   5. role_gate (select)
 *   6. owner
 *   7. expires_at (UTC + Central; STALE pill when expires_at < now()-90d
 *      AND percent IN (0, 100))
 *   8. updated_at + updated_by (resolved email)
 *   9. Save button (per-row)
 *
 * Kill-switch typed-confirmation (AC21):
 *   - Toggling a flag whose `key LIKE 'kill-%'` opens a typed-confirmation
 *     dialog requiring `enable` / `disable` to match the action.
 *   - Non-kill flags save immediately on Save button click.
 *   - Implemented in `_components/flag-row.client.tsx`.
 *
 * AC5 defense-in-depth: FIRST body statement is
 * `await requireRole('manager');` — asserted by
 * `tests/auth/admin-routes-defense-in-depth.test.ts`.
 *
 * Premortem mitigations:
 *   - R1 (admin-client misuse): the queue uses cookie-scoped
 *     `createClient()` (RLS evaluates against the caller).
 *   - R6 (toggle race): per-row Save, not a page-level Save-all.
 */

import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

import { FlagRow, type FlagRowData } from './_components/flag-row.client';
import type { Role } from '@/lib/auth/types';

// Opt out of static prerender — the page reads the Supabase session via
// cookies, which Next.js cannot evaluate at build time.
export const dynamic = 'force-dynamic';

// ADR-0034: every operational timestamp renders BOTH UTC and the club's
// local zone (America/Chicago, abbreviated CDT or CST).
const CENTRAL_TZ = 'America/Chicago';

// Stale-flag review cadence anchor (per 0001_feature_flags.sql comment +
// ADR-0020).
const STALE_THRESHOLD_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type RawFlagRow = {
  key: string;
  enabled: boolean;
  percent: number;
  allowlist: string[];
  role_gate: Role | null;
  owner: string;
  expires_at: string | null;
  updated_at: string;
  updated_by: string | null;
};

function formatUtcAndCentral(iso: string): { utc: string; central: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { utc: iso, central: iso };

  const utcParts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).formatToParts(date);
  const utc = `${pick(utcParts, 'year')}-${pick(utcParts, 'month')}-${pick(utcParts, 'day')} ${pick(utcParts, 'hour')}:${pick(utcParts, 'minute')}:${pick(utcParts, 'second')} UTC`;

  const centralParts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: CENTRAL_TZ,
    timeZoneName: 'short',
  }).formatToParts(date);
  let h = pick(centralParts, 'hour');
  if (h === '24') h = '00';
  const central = `${pick(centralParts, 'year')}-${pick(centralParts, 'month')}-${pick(centralParts, 'day')} ${h}:${pick(centralParts, 'minute')}:${pick(centralParts, 'second')} ${pick(centralParts, 'timeZoneName')}`;

  return { utc, central };
}

function pick(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/**
 * STALE-pill predicate (AC21): `expires_at < now() - 90d` AND
 * `percent IN (0, 100)`. The percent gate is the load-bearing half — a
 * flag stuck at a partial rollout is "in progress," not stale. A flag
 * already fully rolled out (100%) or fully off (0%) for 90+ days is a
 * cleanup candidate.
 */
function isStale(expiresAt: string | null, percent: number, now: Date): boolean {
  if (expiresAt === null) return false;
  if (percent !== 0 && percent !== 100) return false;
  const expDate = new Date(expiresAt);
  if (Number.isNaN(expDate.getTime())) return false;
  const threshold = new Date(now.getTime() - STALE_THRESHOLD_DAYS * MS_PER_DAY);
  return expDate.getTime() < threshold.getTime();
}

export default async function AdminFlagsPage(): Promise<JSX.Element> {
  // AC5: first body statement.
  await requireRole('manager');

  const supabase = createClient();

  // Read all flags — the table is admin-curated and bounded; no
  // pagination needed in v1. Ordered alphabetically by `key` so the page
  // is stable across renders.
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, enabled, percent, allowlist, role_gate, owner, expires_at, updated_at, updated_by')
    .order('key', { ascending: true });

  if (error) {
    throw new Error(`Failed to load feature_flags: ${error.message}`);
  }

  const rawFlags = (data ?? []) as RawFlagRow[];

  // Resolve updated_by UUIDs to emails via a separate query. The set is
  // small (one row per distinct `updated_by`); we batch-resolve so the
  // page doesn't fan out N queries.
  const updaterIds = Array.from(
    new Set(rawFlags.map((f) => f.updated_by).filter((id): id is string => id !== null)),
  );
  let emailMap = new Map<string, string>();
  if (updaterIds.length > 0) {
    const { data: profileRows, error: profileErr } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', updaterIds);
    if (profileErr) {
      // Non-fatal — fall back to "system" for unresolved updaters.
      // The audit_log is the source-of-truth for "who did what"; this
      // resolution is a UX nicety only.
      emailMap = new Map();
    } else {
      emailMap = new Map(
        (profileRows ?? []).map((r) => [(r as { id: string }).id, (r as { email: string }).email]),
      );
    }
  }

  const now = new Date();
  const flags: FlagRowData[] = rawFlags.map((f) => ({
    key: f.key,
    enabled: f.enabled,
    percent: f.percent,
    allowlist: f.allowlist,
    role_gate: f.role_gate,
    owner: f.owner,
    expires_at: f.expires_at,
    updated_at: f.updated_at,
    updated_by_email: f.updated_by !== null ? emailMap.get(f.updated_by) ?? null : null,
    expires_at_formatted: f.expires_at !== null ? formatUtcAndCentral(f.expires_at) : null,
    updated_at_formatted: formatUtcAndCentral(f.updated_at),
    stale: isStale(f.expires_at, f.percent, now),
  }));

  return (
    <section
      aria-label="Feature flags"
      style={{ maxWidth: 1280, margin: '0 auto', color: 'var(--ivory-200)' }}
    >
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
          Feature flags
        </h1>
        <p style={{ color: 'var(--ivory-300)', fontSize: 14, lineHeight: 1.65, marginTop: 8 }}>
          {flags.length} {flags.length === 1 ? 'flag' : 'flags'}. Per-row Save. Kill-switch toggles
          require typed confirmation.
        </p>
      </header>

      {flags.length === 0 ? (
        <p
          role="status"
          style={{
            padding: '32px 24px',
            color: 'var(--ivory-400)',
            fontSize: 14,
            margin: 0,
            textAlign: 'center',
            background: 'var(--ink-850)',
            border: '1px solid var(--border-faint)',
            borderRadius: 8,
          }}
        >
          No feature flags defined.
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
            aria-label="Feature flags"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--ivory-300)',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', background: 'var(--ink-900)' }}>
                <Th>Key</Th>
                <Th>Enabled</Th>
                <Th>Percent</Th>
                <Th>Allowlist</Th>
                <Th>Role gate</Th>
                <Th>Owner</Th>
                <Th>Expires (UTC / Central)</Th>
                <Th>Updated (UTC / Central)</Th>
                <Th>&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <FlagRow key={flag.key} flag={flag} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      style={{
        padding: '12px 16px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        fontWeight: 500,
        borderBottom: '1px solid var(--border-faint)',
      }}
    >
      {children}
    </th>
  );
}
