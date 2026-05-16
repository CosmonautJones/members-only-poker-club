/**
 * `/admin/audit-log` — paginated, descending-by-`created_at` audit log
 * viewer (ADR-0035 AC19, WB.T11).
 *
 * Server component. Renders:
 *   - Filter form (action prefix, actor email, target_type, target_id,
 *     fromCentral, toCentral, page size).
 *   - DST fall-back banner (verbatim ADR-0034 §"Audit log presentation
 *     contract") when the active UTC range intersects an
 *     America/Chicago fall-back seam (`crossesFallbackSeam` from t8).
 *   - R8 anonymized-profile banner (premortem mitigation) when any
 *     row's actor_email OR target_email matches `/^del:/`.
 *   - Audit table (50 rows / page, max 200): created_at (UTC + Central
 *     with CDT/CST per ADR-0034), actor (email or literal "system"),
 *     action, target_type / target_id, before/after (expand-on-click),
 *     ip, user_agent.
 *   - Pagination links (Prev / Next + page indicator).
 *
 * AC5 defense-in-depth: FIRST `await` token in the exported function
 * body is `await requireRole('manager')`. The (admin) layout already
 * gated, the action gates again, and the page gates here — three
 * independent enforcement points.
 *
 * Premortem mitigations:
 *   - R1 (admin-client misuse): only `createClient()` cookie-scoped is
 *     used.
 *   - R8 (anonymized-profile rows): banner with role='note' when any
 *     rendered row has an actor or target email matching /^del:/.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC19
 * Task: .conductor/0035 t12 (WB.T11)
 */

import Link from 'next/link';

import { requireRole } from '@/lib/auth/requireRole';
import { crossesFallbackSeam } from '@/lib/timestamps/dst-seam';

import { queryAuditLog, type AuditLogRow } from './_actions/queryAuditLog';

export const dynamic = 'force-dynamic';

const CENTRAL_TZ = 'America/Chicago';

// Verbatim ADR-0034 §"Audit log presentation contract" copy.
const DST_FALLBACK_BANNER =
  'the next 1 hour of rows occurred during the DST repeat — sort is by UTC; Central times are not unique';

// R8 (premortem) banner copy — anonymized-profile rows.
const ANONYMIZED_PROFILE_BANNER =
  'This view includes audit rows for an anonymized profile. Per ADR-0023, the historical record is retained for compliance. Treat as confidential.';

const PAGE_SIZE_CHOICES = [25, 50, 100, 200] as const;

type SearchParams = {
  actionPrefix?: string;
  actorEmail?: string;
  targetType?: string;
  targetId?: string;
  fromCentral?: string;
  toCentral?: string;
  page?: string;
  pageSize?: string;
};

/**
 * Convert a `datetime-local` string (e.g. `2026-11-01T01:30`) in the
 * club zone (America/Chicago) to a UTC ISO string suitable for a
 * `timestamptz` comparison. Returns `undefined` for empty / invalid
 * inputs.
 */
export function centralLocalToUtc(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match;
  const yN = Number(y);
  const moN = Number(mo);
  const dN = Number(d);
  const hN = Number(h);
  const miN = Number(mi);
  const sN = s ? Number(s) : 0;
  if (
    Number.isNaN(yN) ||
    Number.isNaN(moN) ||
    Number.isNaN(dN) ||
    Number.isNaN(hN) ||
    Number.isNaN(miN)
  ) {
    return undefined;
  }
  const guess = Date.UTC(yN, moN - 1, dN, hN, miN, sN, 0);
  const offsetMinutes = centralOffsetMinutesAt(new Date(guess));
  const utcMs = guess - offsetMinutes * 60_000;
  return new Date(utcMs).toISOString();
}

function centralOffsetMinutesAt(when: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(when);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(tz);
  if (!m) return -300;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = Number(m[2] ?? '0');
  const minutes = Number(m[3] ?? '0');
  return sign * (hours * 60 + minutes);
}

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

function hasAnonymizedProfile(rows: AuditLogRow[]): boolean {
  return rows.some(
    (r) =>
      (r.actor_email !== null && r.actor_email !== undefined && r.actor_email.startsWith('del:')) ||
      (r.target_email !== null &&
        r.target_email !== undefined &&
        r.target_email.startsWith('del:')),
  );
}

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // JSON.stringify is the load-bearing path; this branch only fires
    // on circular structures (the audit_log JSONB columns are
    // already JSON-serialized when written, so a cycle is
    // theoretically impossible). Render `[unserializable]` rather
    // than risk `[object Object]` from a default toString.
    return '[unserializable]';
  }
}

function buildPageHref(searchParams: SearchParams, nextPage: number): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string' && v.length > 0 && k !== 'page') {
      usp.set(k, v);
    }
  }
  usp.set('page', String(nextPage));
  return `/admin/audit-log?${usp.toString()}`;
}

export default async function AuditLogPage({ searchParams }: { searchParams?: SearchParams }) {
  const { profile } = await requireRole('manager');

  const sp = searchParams ?? {};

  const fromUtc = centralLocalToUtc(sp.fromCentral);
  const toUtc = centralLocalToUtc(sp.toCentral);

  const page = sp.page ? Number(sp.page) : 1;
  const pageSize = sp.pageSize ? Number(sp.pageSize) : 50;

  // `exactOptionalPropertyTypes` is on — undefined-valued optional
  // fields must be omitted entirely rather than spread with `undefined`.
  // Build the params object dynamically.
  const queryParams: Parameters<typeof queryAuditLog>[0] = { page, pageSize };
  if (sp.actionPrefix) queryParams.actionPrefix = sp.actionPrefix;
  if (sp.actorEmail) queryParams.actorEmail = sp.actorEmail;
  if (sp.targetType) queryParams.targetType = sp.targetType;
  if (sp.targetId) queryParams.targetId = sp.targetId;
  if (fromUtc) queryParams.fromUtc = fromUtc;
  if (toUtc) queryParams.toUtc = toUtc;

  const result = await queryAuditLog(queryParams);

  let dstBannerVisible = false;
  if (fromUtc && toUtc) {
    dstBannerVisible = crossesFallbackSeam(new Date(fromUtc), new Date(toUtc));
  }

  const r8BannerVisible = hasAnonymizedProfile(result.rows);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <section
      aria-label="Audit log"
      style={{
        maxWidth: 1280,
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
            marginBottom: 8,
          }}
        >
          Audit log
        </h1>
        <p style={{ color: 'var(--ivory-300)', fontSize: 14, lineHeight: 1.6 }}>
          Signed in as {profile.role}. Sorted by UTC, newest first. {result.total} matching{' '}
          {result.total === 1 ? 'row' : 'rows'}.
        </p>
      </header>

      <form
        method="get"
        action="/admin/audit-log"
        aria-label="Audit log filters"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          padding: 16,
          background: 'var(--ink-850)',
          border: '1px solid var(--border-faint)',
          borderRadius: 8,
          marginBottom: 24,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Action prefix</span>
          <input
            type="text"
            name="actionPrefix"
            defaultValue={sp.actionPrefix ?? ''}
            placeholder="admin.member."
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Actor email</span>
          <input
            type="email"
            name="actorEmail"
            defaultValue={sp.actorEmail ?? ''}
            placeholder="manager@example.com"
            list="actor-email-suggestions"
            style={inputStyle}
          />
          <datalist id="actor-email-suggestions" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Target type</span>
          <input
            type="text"
            name="targetType"
            defaultValue={sp.targetType ?? ''}
            placeholder="profile"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Target id</span>
          <input
            type="text"
            name="targetId"
            defaultValue={sp.targetId ?? ''}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginBottom: 4 }}>From (Central)</span>
          <input
            type="datetime-local"
            name="fromCentral"
            defaultValue={sp.fromCentral ?? ''}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginBottom: 4 }}>To (Central)</span>
          <input
            type="datetime-local"
            name="toCentral"
            defaultValue={sp.toCentral ?? ''}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Page size</span>
          <select name="pageSize" defaultValue={String(result.pageSize)} style={inputStyle}>
            {PAGE_SIZE_CHOICES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button
            type="submit"
            style={{
              padding: '8px 16px',
              background: 'var(--accent, #c9a24a)',
              color: 'var(--ink-900)',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
          <Link
            href="/admin/audit-log"
            style={{
              padding: '8px 16px',
              border: '1px solid var(--border-faint)',
              borderRadius: 4,
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ivory-300)',
              textDecoration: 'none',
            }}
          >
            Reset
          </Link>
        </div>
      </form>

      {dstBannerVisible && (
        <div
          role="status"
          aria-live="polite"
          data-testid="dst-fallback-banner"
          style={{
            padding: '12px 16px',
            background: 'rgba(201, 162, 74, 0.12)',
            border: '1px solid rgba(201, 162, 74, 0.4)',
            borderRadius: 6,
            color: 'var(--ivory-100, var(--ivory-200))',
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          {DST_FALLBACK_BANNER}
        </div>
      )}

      {r8BannerVisible && (
        <div
          role="note"
          data-testid="anonymized-profile-banner"
          style={{
            padding: '12px 16px',
            background: 'rgba(180, 90, 90, 0.12)',
            border: '1px solid rgba(180, 90, 90, 0.45)',
            borderRadius: 6,
            color: 'var(--ivory-100, var(--ivory-200))',
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          {ANONYMIZED_PROFILE_BANNER}
        </div>
      )}

      {result.rows.length === 0 ? (
        <p
          style={{
            padding: 24,
            background: 'var(--ink-850)',
            border: '1px solid var(--border-faint)',
            borderRadius: 8,
            color: 'var(--ivory-400)',
            fontSize: 14,
          }}
        >
          No audit rows match the current filters.
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
            aria-label="Audit log entries"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              color: 'var(--ivory-300)',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th scope="col" style={thStyle}>
                  When (UTC / Central)
                </th>
                <th scope="col" style={thStyle}>
                  Actor
                </th>
                <th scope="col" style={thStyle}>
                  Action
                </th>
                <th scope="col" style={thStyle}>
                  Target
                </th>
                <th scope="col" style={thStyle}>
                  Before / After
                </th>
                <th scope="col" style={thStyle}>
                  IP
                </th>
                <th scope="col" style={thStyle}>
                  User agent
                </th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const { utc, central } = formatUtcAndCentral(row.created_at);
                const actorDisplay = row.actor_email ?? 'system';
                return (
                  <tr key={row.id} style={{ borderTop: '1px solid var(--border-faint)' }}>
                    <td style={tdStyle}>
                      <div>{utc}</div>
                      <div style={{ color: 'var(--ivory-400)', fontSize: 11 }}>{central}</div>
                    </td>
                    <td style={tdStyle} data-testid={`audit-row-${row.id}-actor`}>
                      {actorDisplay}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{row.action}</td>
                    <td style={tdStyle}>
                      <span style={{ color: 'var(--ivory-400)' }}>{row.target_type}</span>
                      <span style={{ color: 'var(--text-muted)' }}> / </span>
                      <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {row.target_id}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <details>
                        <summary style={{ cursor: 'pointer', color: 'var(--ivory-400)' }}>
                          Expand
                        </summary>
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>before</div>
                          <pre data-testid={`audit-row-${row.id}-before`} style={preStyle}>
                            {safeStringify(row.before)}
                          </pre>
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--text-muted)',
                              marginTop: 6,
                            }}
                          >
                            after
                          </div>
                          <pre data-testid={`audit-row-${row.id}-after`} style={preStyle}>
                            {safeStringify(row.after)}
                          </pre>
                        </div>
                      </details>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>
                      {row.ip ?? ''}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontSize: 11,
                        maxWidth: 240,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={row.user_agent ?? ''}
                    >
                      {row.user_agent ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.total > 0 && (
        <nav
          aria-label="Audit log pagination"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            fontSize: 12,
            color: 'var(--ivory-400)',
          }}
        >
          <div>
            Page {result.page} of {totalPages}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {result.page > 1 ? (
              <Link href={buildPageHref(sp, result.page - 1)} style={pageLinkStyle}>
                ← Previous
              </Link>
            ) : (
              <span style={{ ...pageLinkStyle, opacity: 0.4 }} aria-disabled="true">
                ← Previous
              </span>
            )}
            {result.page < totalPages ? (
              <Link href={buildPageHref(sp, result.page + 1)} style={pageLinkStyle}>
                Next →
              </Link>
            ) : (
              <span style={{ ...pageLinkStyle, opacity: 0.4 }} aria-disabled="true">
                Next →
              </span>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: 'var(--ink-900)',
  border: '1px solid var(--border-faint)',
  borderRadius: 4,
  color: 'var(--ivory-200)',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 16px',
  verticalAlign: 'top',
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  background: 'var(--ink-900)',
  border: '1px solid var(--border-faint)',
  borderRadius: 4,
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const pageLinkStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-faint)',
  borderRadius: 4,
  color: 'var(--ivory-300)',
  textDecoration: 'none',
  letterSpacing: '0.06em',
};
