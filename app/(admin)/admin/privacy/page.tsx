/**
 * `/admin/privacy` — manager+ privacy-request queue (ADR-0035 AC23, WC.T17).
 *
 * Server component. Renders the `privacy_requests` queue filtered by
 * `status` (default `'pending'`; URL toggle switches to
 * `'in_progress' | 'completed' | 'rejected'`). Three columns:
 *
 *   1. Requester — `profiles.full_name` + `profiles.email` joined from
 *      the request's `profile_id`. **When `status='completed'` AND
 *      `kind='delete'`**, the profile row is anonymized (`del:<hash>`
 *      tokens) so the column falls back to the row's captured
 *      `requester_email` (pre-anonymization). The fallback is THE
 *      reason `privacy_requests.requester_email` exists per the
 *      column-level COMMENT in migration 0005.
 *   2. Kind — `export` / `delete`.
 *   3. Submitted (UTC + Central per ADR-0034).
 *
 * Each `status='pending'` row carries action buttons routed through the
 * shipped `TypedConfirmationDialog` primitive (`components/admin/typed-confirmation-dialog.tsx`):
 *   - `kind='export'`: **Approve export** — type `approve` →
 *     `approveExportAction`.
 *   - `kind='delete'`: **Approve deletion** — type the row's
 *     `requester_email` → `approveDeletionAction`.
 *   - any pending row: **Reject** — type `reject` + reason 1..500 →
 *     `rejectRequestAction`.
 *
 * Defense-in-depth (AC5): FIRST body statement is
 * `await requireRole('manager');` — asserted by
 * `tests/auth/admin-routes-defense-in-depth.test.ts`.
 *
 * Source-grep contracts:
 *   - Imports `createClient` from `@/lib/supabase/server` (cookie-scoped,
 *     NOT the service-role admin client).
 *
 * Empty state copy: "No pending privacy requests." (verbatim per AC23).
 */

import { Suspense } from 'react';

import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

import { PrivacyQueueActions } from './_components/privacy-queue-actions.client';

export const dynamic = 'force-dynamic';

const CENTRAL_TZ = 'America/Chicago';

// Status options for the queue filter. The default is 'pending'. The
// other values map to the privacy_request_status_t enum from migration
// 0005.
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];

const VALID_STATUSES = new Set<StatusFilter>(
  STATUS_OPTIONS.map((o) => o.value),
);

// ---- Row shapes -----------------------------------------------------------

type PrivacyRequestRow = {
  id: string;
  profile_id: string;
  requester_email: string;
  kind: 'export' | 'delete';
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  submitted_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
};

type ResolvedRow = PrivacyRequestRow & {
  // Resolved name + email — falls back to `requester_email` when the
  // joined profile is anonymized (status='completed' AND kind='delete').
  display_name: string;
  display_email: string;
};

// ---- Timestamp formatter (ADR-0034) ---------------------------------------

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
  const y = pick(centralParts, 'year');
  const m = pick(centralParts, 'month');
  const d = pick(centralParts, 'day');
  let h = pick(centralParts, 'hour');
  if (h === '24') h = '00';
  const mi = pick(centralParts, 'minute');
  const s = pick(centralParts, 'second');
  const tzName = pick(centralParts, 'timeZoneName');
  const central = `${y}-${m}-${d} ${h}:${mi}:${s} ${tzName}`;

  return { utc, central };
}

function pick(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

// ---- searchParams parsing -------------------------------------------------

function readStatus(
  searchParams: Record<string, string | string[] | undefined>,
): StatusFilter {
  const v = searchParams['status'];
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw && VALID_STATUSES.has(raw as StatusFilter)) {
    return raw as StatusFilter;
  }
  return 'pending';
}

// ---- Async queue body ------------------------------------------------------
//
// `PrivacyQueueBody` is declared BELOW the default-exported `PrivacyPage`
// (at end of file) so the first `await` token in source order is the
// `await requireRole('manager')` inside the page. AC5's regex-tier
// defense-in-depth walker (`tests/auth/admin-routes-defense-in-depth.test.ts`)
// scans for the first `\bawait\b` in source order; placing the queue
// body (which contains internal `await` calls against supabase) above
// the page would silently fail the gate. Function declarations are
// hoisted, so the JSX reference resolves correctly despite the textual
// ordering.

// ---- Page ------------------------------------------------------------------

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<JSX.Element> {
  // AC5 defense-in-depth: FIRST body statement is requireRole('manager').
  await requireRole('manager');

  const status = readStatus(searchParams);

  return (
    <section
      aria-label="Privacy request queue"
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        color: 'var(--ivory-200)',
      }}
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
            marginBottom: 12,
          }}
        >
          Privacy requests
        </h1>
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 14,
            lineHeight: 1.65,
            maxWidth: 760,
          }}
        >
          Members&apos; export and deletion requests. Each pending row can
          be approved (data export or anonymization) or rejected with a
          reason. Approval is irreversible — read the typed-confirmation
          contract on each dialog.
        </p>
      </header>

      <form
        method="GET"
        action=""
        aria-label="Filter privacy requests"
        data-testid="privacy-filter-form"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
          marginBottom: 16,
        }}
      >
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          Status
          <select
            name="status"
            defaultValue={status}
            data-testid="privacy-status-select"
            style={{
              padding: '6px 10px',
              fontSize: 13,
              background: 'var(--ink-900, #111)',
              color: 'var(--ivory-200)',
              border: '1px solid var(--border-faint)',
              borderRadius: 4,
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          data-testid="privacy-filter-submit"
          style={{
            padding: '8px 14px',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            background: 'transparent',
            color: 'var(--ivory-300)',
            border: '1px solid var(--border-faint)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </form>

      <Suspense fallback={<TableSkeleton />}>
        <PrivacyQueueBody status={status} />
      </Suspense>
    </section>
  );
}

// ---- Presentational primitives --------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      style={{
        padding: '12px 24px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function KindPill({ kind }: { kind: 'export' | 'delete' }) {
  const bg =
    kind === 'export' ? 'rgba(74, 138, 207, 0.18)' : 'rgba(207, 34, 46, 0.18)';
  const fg = kind === 'export' ? 'var(--blue-400, #79b8ff)' : 'var(--red-400, #ff7b72)';
  const border =
    kind === 'export'
      ? '1px solid rgba(74, 138, 207, 0.45)'
      : '1px solid rgba(207, 34, 46, 0.45)';
  return (
    <span
      data-kind={kind}
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: fg,
        background: bg,
        border,
        borderRadius: 999,
      }}
    >
      {kind}
    </span>
  );
}

function TableSkeleton() {
  const rows = Array.from({ length: 5 });
  return (
    <div
      aria-hidden="true"
      data-testid="privacy-skeleton"
      style={{
        border: '1px solid var(--border-faint)',
        borderRadius: 8,
        background: 'var(--ink-850)',
        overflow: 'hidden',
      }}
    >
      {rows.map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '14px 24px',
            borderTop: i === 0 ? 'none' : '1px solid var(--border-faint)',
          }}
        >
          <div
            style={{
              flex: 1,
              height: 12,
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 4,
            }}
          />
          <div
            style={{
              width: 80,
              height: 12,
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 4,
            }}
          />
          <div
            style={{
              width: 200,
              height: 12,
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 4,
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ---- Async queue body (declared AFTER PrivacyPage per AC5 first-await contract) ----
//
// See the header comment above PrivacyPage for the source-order
// rationale. JSX reference resolves via function-declaration hoisting.

async function PrivacyQueueBody({
  status,
}: {
  status: StatusFilter;
}): Promise<JSX.Element> {
  const supabase = createClient();

  const { data: requestRows, error } = await supabase
    .from('privacy_requests')
    .select('id, profile_id, requester_email, kind, status, submitted_at')
    .eq('status', status)
    .order('submitted_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load privacy queue: ${error.message}`);
  }

  const rows = (requestRows ?? []) as PrivacyRequestRow[];

  // Resolve each request's display name + email by joining to profiles.
  // When the profile is anonymized (status='completed' AND kind='delete'),
  // we fall back to the row's captured requester_email. We issue ONE
  // batched profiles lookup so the queue doesn't N+1.
  const profileIds = Array.from(new Set(rows.map((r) => r.profile_id)));
  let profilesById = new Map<string, ProfileRow>();
  if (profileIds.length > 0) {
    const { data: profileRows, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', profileIds);
    if (!profileErr && profileRows) {
      profilesById = new Map(
        (profileRows as ProfileRow[]).map((p) => [p.id, p]),
      );
    }
  }

  const resolved: ResolvedRow[] = rows.map((r) => {
    const profile = profilesById.get(r.profile_id);
    const isAnonymizedDeletion =
      r.status === 'completed' && r.kind === 'delete';
    const displayName =
      profile && !isAnonymizedDeletion ? profile.full_name : '(anonymized)';
    const displayEmail =
      profile && !isAnonymizedDeletion ? profile.email : r.requester_email;
    return { ...r, display_name: displayName, display_email: displayEmail };
  });

  if (resolved.length === 0) {
    return (
      <div
        role="status"
        data-testid="privacy-empty-state"
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--ivory-400)',
          fontSize: 14,
          border: '1px solid var(--border-faint)',
          borderRadius: 8,
          background: 'var(--ink-850)',
        }}
      >
        No pending privacy requests.
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-faint)',
        borderRadius: 8,
        background: 'var(--ink-850)',
        overflow: 'hidden',
      }}
    >
      <table
        role="table"
        aria-label="Privacy request queue"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          color: 'var(--ivory-300)',
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <Th>Requester</Th>
            <Th>Kind</Th>
            <Th>Submitted (UTC / Central)</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {resolved.map((row) => {
            const { utc, central } = formatUtcAndCentral(row.submitted_at);
            return (
              <tr
                key={row.id}
                data-testid={`privacy-row-${row.id}`}
                data-status={row.status}
                data-kind={row.kind}
                style={{ borderTop: '1px solid var(--border-faint)' }}
              >
                <td style={{ padding: '14px 24px' }}>
                  <div style={{ color: 'var(--ivory-200)', fontWeight: 500 }}>
                    {row.display_name}
                  </div>
                  <div style={{ color: 'var(--ivory-400)', fontSize: 12 }}>
                    {row.display_email}
                  </div>
                </td>
                <td style={{ padding: '14px 24px' }}>
                  <KindPill kind={row.kind} />
                </td>
                <td style={{ padding: '14px 24px' }}>
                  <div>{utc}</div>
                  <div style={{ color: 'var(--ivory-400)', fontSize: 12 }}>
                    {central}
                  </div>
                </td>
                <td style={{ padding: '14px 24px' }}>
                  {row.status === 'pending' ? (
                    <PrivacyQueueActions
                      requestId={row.id}
                      kind={row.kind}
                      requesterEmail={row.requester_email}
                    />
                  ) : (
                    <span
                      data-testid={`privacy-no-actions-${row.id}`}
                      style={{ color: 'var(--ivory-400)', fontSize: 12 }}
                    >
                      —
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
