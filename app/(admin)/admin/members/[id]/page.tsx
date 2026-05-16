/**
 * `/admin/members/[id]` — manager+ member detail (ADR-0035 AC10, WA.T6).
 *
 * Server component. Five sections per AC10:
 *   1. Profile — read-only `<dl>` (full_name, email, member_number, role,
 *      dob, phone, created_at). All timestamps render BOTH UTC and Central
 *      (CDT/CST) per ADR-0034.
 *   2. Membership — joined from `memberships`. Renders "No membership"
 *      when absent OR — per Open Q 3 — the placeholder
 *      "Membership status pending — see ADR-0010." when the table itself
 *      does not exist yet (caught via `try/catch` on the supabase response).
 *   3. Time bank — joined from `time_wallets`. Balance is rendered via
 *      `formatMoney(balance_cents)` per ADR-0004 (NEVER raw `${cents}`).
 *      Renders "No wallet" when absent (or the schema-absent placeholder
 *      mirroring Open Q 3).
 *   4. Recent activity — last 20 `audit_log` rows filtered to
 *      `target_id = profile.id`, ordered `created_at DESC`. Per
 *      ADR-0034, both UTC + Central render on every timestamp.
 *   5. Recent payments — per Open Q 2, this section renders the
 *      placeholder "Payment integration pending — see ADR-0010 / 0036."
 *      when the `payments` table is absent (the v1 ship). If a
 *      `payments`-like table exists at implementation time, the worker
 *      surfaces the rows (also wrapped in try/catch to survive schema
 *      drift).
 *
 * Actions panel (AC10 + AC18):
 *   - As of t14 (Slice 4C) the four action buttons render as ACTIVE
 *     typed-confirmation dialogs via the `ActionsPanel` client
 *     component. Each dialog mirrors ADR-0023's Radix `AlertDialog`
 *     a11y pattern (focus on Cancel, Esc closes, `aria-modal="true"`).
 *     The typed-phrase gates per AC18:
 *       - Change role: type `approve`
 *       - Request re-verification: type `approve`
 *       - Open refund flow: NO typed confirmation (redirect, not mutation)
 *       - Initiate deletion: type the member's email address
 *   - Self-edit guard (UI layer): if `profile.id === session.user.id`,
 *     the entire Actions panel is replaced by a banner —
 *     "You cannot perform admin actions against your own profile" — and
 *     the `ActionsPanel` is NOT rendered at all. Server-side defense
 *     duplicates this guard inside the action handlers (AC15-17, AC34).
 *
 * Defense-in-depth (AC5): FIRST body statement of the exported function
 * is `await requireRole('manager')`, independently of the layout's gate.
 * Enforced by `tests/auth/admin-routes-defense-in-depth.test.ts`.
 *
 * R1 mitigation: every query uses the cookie-scoped `createClient()`
 * (`@/lib/supabase/server`). The service-role client is intentionally
 * absent — RLS evaluates against the caller's session.
 *
 * Source-grep contracts the tests enforce:
 *   - The file imports `requireRole` from `@/lib/auth/requireRole`.
 *   - The file imports `createClient` from `@/lib/supabase/server`
 *     (NOT `@/lib/supabase/admin`).
 *   - The file imports `formatMoney` from `@/lib/money/types`.
 *   - The file is a server component (no client-component directive).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/requireRole';
import { formatMoney, type Cents } from '@/lib/money/types';
import { createClient } from '@/lib/supabase/server';

import { ActionsPanel } from './_components/actions-panel.client';

export const dynamic = 'force-dynamic';

// ADR-0034: render every operational timestamp in BOTH UTC and the
// club's local zone (America/Chicago, abbreviated CDT or CST).
const CENTRAL_TZ = 'America/Chicago';

// Postgres SQLSTATE for "relation does not exist". When a downstream
// table (memberships, time_wallets, payments) is not present in the
// schema yet (Open Q 2 + Q 3), the supabase response returns this code.
// We treat 42P01 as a soft signal and render the placeholder copy
// rather than crashing the whole page.
const SQLSTATE_UNDEFINED_TABLE = '42P01';

// Self-edit banner copy. Centralized so the test can grep the literal
// string and the server-side error handler can assert against the
// same canonical phrase. The four action-button labels live in the
// `ActionsPanel` client component now (t14) — they are no longer
// declared at the page level because the dialogs encode their own
// label state.
const SELF_EDIT_BANNER =
  'You cannot perform admin actions against your own profile';

// ---- Row shapes (only the columns we render) -------------------------------

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  // ADR-0009 forward-compat: member_number lands when verification ships.
  // Treat as optional so the read works against pre-AC9 schemas too.
  member_number: number | null;
  role: string;
  dob: string;
  phone: string | null;
  created_at: string;
  id_verified_at: string | null;
};

type MembershipRow = {
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
};

type WalletRow = {
  balance_cents: number | null;
};

type AuditRow = {
  id: number;
  action: string;
  target_type: string;
  target_id: string;
  created_at: string;
};

type PaymentRow = {
  id: string;
  amount_cents: number;
  status: string;
  created_at: string;
};

// Section-result shape lets each fetcher communicate three states to
// the renderer: ok + data, ok + null (no row), or schema-absent (the
// placeholder string the section header should render in its place).
type SectionResult<T> =
  | { kind: 'ok'; data: T | null }
  | { kind: 'schema-absent'; placeholder: string };

// ---- Timestamp formatter ---------------------------------------------------
//
// Mirrors `app/(admin)/admin/page.tsx`'s `formatUtcAndCentral`. Kept
// inline (small, self-contained, no shared seam yet) so this page can
// be read in isolation. The audit-log surface (t12) consolidates the
// helper when it ships its richer DST-banner UX.

function formatUtcAndCentral(iso: string | null): { utc: string; central: string } {
  if (!iso) return { utc: '—', central: '—' };
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
  const utc = `${pick(utcParts, 'year')}-${pick(utcParts, 'month')}-${pick(
    utcParts,
    'day',
  )} ${pick(utcParts, 'hour')}:${pick(utcParts, 'minute')}:${pick(
    utcParts,
    'second',
  )} UTC`;

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

/**
 * Inspect a supabase error to decide whether it indicates the queried
 * table simply does not exist in the schema (Open Q 2 / Q 3 placeholder
 * path). Returns `true` for SQLSTATE 42P01 OR a postgrest "schema cache"
 * miss (PGRST205) OR the error message containing "does not exist"
 * (defensive; pglite + hosted both surface the SQLSTATE, but the
 * message is the last-ditch detector for older error envelopes).
 */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === SQLSTATE_UNDEFINED_TABLE) return true;
  // PostgREST returns its own code (PGRST205 or PGRST106) when a
  // schema cache miss occurs — same operational signal.
  if (error.code === 'PGRST205' || error.code === 'PGRST106') return true;
  if (typeof error.message === 'string' && /does not exist/i.test(error.message)) return true;
  return false;
}

// ---- Page ------------------------------------------------------------------

export default async function MemberDetailPage(props: { params: { id: string } }) {
  // AC5 defense-in-depth: FIRST body statement is requireRole('manager').
  // The layout already gated, but the page asserts independently so a
  // future refactor that detaches this page from the (admin) group is
  // caught by `tests/auth/admin-routes-defense-in-depth.test.ts`.
  const { profile: actor } = await requireRole('manager');

  const memberId = props.params.id;
  const supabase = createClient();

  // ---- Section 1: Profile -------------------------------------------------
  //
  // Fetched without a wrapping try/catch — the page CANNOT render
  // without a profile row, so a missing profile triggers `notFound()`
  // (which renders the (admin) segment's `not-found.tsx`, or Next's
  // default 404 fallback if the segment has none).
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email, member_number, role, dob, phone, created_at, id_verified_at')
    .eq('id', memberId)
    .maybeSingle();

  if (profileError || !profileData) {
    notFound();
  }
  // Supabase returns `any`-shaped data when no generic schema type is
  // wired into createClient(); `profileData` is therefore assignable
  // to ProfileRow without a cast (linter rejects an unnecessary one).
  const profile: ProfileRow = profileData;

  // ---- Self-edit guard ----------------------------------------------------
  //
  // Compare against the actor returned by requireRole(). When the
  // detail page is the actor's own profile, the Actions panel renders
  // the banner instead of buttons. The server actions (AC15-17, AC34)
  // duplicate this guard so a directly-POSTed action cannot bypass.
  const isSelfEdit = profile.id === actor.id;

  // ---- Section 2: Membership ---------------------------------------------
  const membership = await fetchMembership(supabase, profile.id);

  // ---- Section 3: Time bank ----------------------------------------------
  const wallet = await fetchWallet(supabase, profile.id);

  // ---- Section 4: Recent activity ----------------------------------------
  const auditRows = await fetchRecentActivity(supabase, profile.id);

  // ---- Section 5: Recent payments ----------------------------------------
  const payments = await fetchRecentPayments(supabase, profile.id);

  const profileCreated = formatUtcAndCentral(profile.created_at);
  const profileVerified = formatUtcAndCentral(profile.id_verified_at);

  return (
    <section
      aria-label="Member detail"
      style={{
        maxWidth: 1040,
        margin: '0 auto',
        color: 'var(--ivory-200)',
      }}
    >
      <header style={{ marginBottom: 32 }}>
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
          <Link
            href="/admin/members"
            style={{ color: 'var(--ivory-400)', textDecoration: 'none' }}
          >
            ← Members
          </Link>
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 44,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: '-0.015em',
            marginBottom: 8,
          }}
        >
          {profile.full_name}
        </h1>
        <p style={{ color: 'var(--ivory-400)', fontSize: 14 }}>{profile.email}</p>
      </header>

      {/* Section 1: Profile */}
      <Section heading="Profile">
        <dl style={dlStyle}>
          <DRow label="Full name" value={profile.full_name} />
          <DRow label="Email" value={profile.email} />
          <DRow
            label="Member number"
            value={
              profile.member_number !== null && profile.member_number !== undefined
                ? `#${profile.member_number}`
                : '—'
            }
          />
          <DRow label="Role" value={profile.role} />
          <DRow label="Date of birth" value={profile.dob} />
          <DRow label="Phone" value={profile.phone ?? '—'} />
          <DRow
            label="Created (UTC / Central)"
            value={
              <span>
                <span>{profileCreated.utc}</span>
                <span style={{ color: 'var(--ivory-400)', fontSize: 12, marginLeft: 8 }}>
                  {profileCreated.central}
                </span>
              </span>
            }
          />
          <DRow
            label="ID verified (UTC / Central)"
            value={
              profile.id_verified_at ? (
                <span>
                  <span>{profileVerified.utc}</span>
                  <span style={{ color: 'var(--ivory-400)', fontSize: 12, marginLeft: 8 }}>
                    {profileVerified.central}
                  </span>
                </span>
              ) : (
                '—'
              )
            }
          />
        </dl>
      </Section>

      {/* Section 2: Membership */}
      <Section heading="Membership">
        {membership.kind === 'schema-absent' ? (
          <p style={placeholderStyle}>{membership.placeholder}</p>
        ) : membership.data === null ? (
          <p style={placeholderStyle}>No membership</p>
        ) : (
          <dl style={dlStyle}>
            <DRow label="Status" value={membership.data.status ?? '—'} />
            <DRow
              label="Period start"
              value={formatPeriodCell(membership.data.current_period_start)}
            />
            <DRow
              label="Period end"
              value={formatPeriodCell(membership.data.current_period_end)}
            />
          </dl>
        )}
      </Section>

      {/* Section 3: Time bank */}
      <Section heading="Time bank">
        {wallet.kind === 'schema-absent' ? (
          <p style={placeholderStyle}>{wallet.placeholder}</p>
        ) : wallet.data === null || wallet.data.balance_cents === null ? (
          <p style={placeholderStyle}>No wallet</p>
        ) : (
          <p
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 36,
              fontWeight: 500,
              color: 'var(--ivory-100, var(--ivory-200))',
              margin: 0,
            }}
            data-testid="time-bank-balance"
          >
            {/* ADR-0004: NEVER render raw cents. Always pass through
                formatMoney() so the integer-cents → USD conversion is
                centralized and unit-safe. */}
            {formatMoney(wallet.data.balance_cents as Cents)}
          </p>
        )}
      </Section>

      {/* Section 4: Recent activity */}
      <Section heading="Recent activity">
        {auditRows.length === 0 ? (
          <p style={placeholderStyle}>No recent activity for this member.</p>
        ) : (
          <table
            role="table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--ivory-300)',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th scope="col" style={thStyle}>
                  Action
                </th>
                <th scope="col" style={thStyle}>
                  When (UTC / Central)
                </th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((row) => {
                const { utc, central } = formatUtcAndCentral(row.created_at);
                return (
                  <tr key={row.id} style={{ borderTop: '1px solid var(--border-faint)' }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>
                      {row.action}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div>{utc}</div>
                      <div style={{ color: 'var(--ivory-400)', fontSize: 12 }}>{central}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* Section 5: Recent payments */}
      <Section heading="Recent payments">
        {payments.kind === 'schema-absent' ? (
          <p style={placeholderStyle}>{payments.placeholder}</p>
        ) : payments.data === null || payments.data.length === 0 ? (
          <p style={placeholderStyle}>No recent payments.</p>
        ) : (
          <table
            role="table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--ivory-300)',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th scope="col" style={thStyle}>
                  Amount
                </th>
                <th scope="col" style={thStyle}>
                  Status
                </th>
                <th scope="col" style={thStyle}>
                  When (UTC / Central)
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.data.map((row) => {
                const { utc, central } = formatUtcAndCentral(row.created_at);
                return (
                  <tr key={row.id} style={{ borderTop: '1px solid var(--border-faint)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      {formatMoney(row.amount_cents as Cents)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>{row.status}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div>{utc}</div>
                      <div style={{ color: 'var(--ivory-400)', fontSize: 12 }}>{central}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* Actions panel */}
      <Section heading="Actions">
        {isSelfEdit ? (
          <p
            role="alert"
            data-testid="self-edit-banner"
            style={{
              padding: '14px 18px',
              border: '1px solid var(--border-faint)',
              borderLeft: '3px solid var(--amber-700, #c9a24a)',
              background: 'rgba(201, 162, 74, 0.08)',
              color: 'var(--ivory-200)',
              fontSize: 14,
              borderRadius: 4,
            }}
          >
            {SELF_EDIT_BANNER}
          </p>
        ) : (
          // Slice 4C (t14): active typed-confirmation dialogs. The
          // panel is a client component because the dialogs own
          // typed-phrase state and call server actions via the
          // `'use server'` re-export shim at `./_actions/index.ts`.
          <ActionsPanel profileId={profile.id} memberEmail={profile.email} />
        )}
      </Section>
    </section>
  );
}

// ---- Fetchers --------------------------------------------------------------
//
// Each downstream fetcher is wrapped to convert a "missing table"
// supabase error into the section-specific placeholder per Open
// Q 2 / Q 3. Any OTHER error returns the empty/no-row shape — the
// page intentionally never blows up on missing data; the manager
// can still take action from the Profile + audit_log sections.

async function fetchMembership(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
): Promise<SectionResult<MembershipRow>> {
  try {
    const { data, error } = await supabase
      .from('memberships')
      .select('status, current_period_start, current_period_end')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) {
        return {
          kind: 'schema-absent',
          placeholder: 'Membership status pending — see ADR-0010.',
        };
      }
      return { kind: 'ok', data: null };
    }
    // Supabase typings widen `data` to `any` without a Database generic;
    // the receiver `SectionResult<MembershipRow>['data']` accepts it.
    const membership: MembershipRow | null = data ?? null;
    return { kind: 'ok', data: membership };
  } catch (err: unknown) {
    if (isMissingTableError(err as { code?: string; message?: string } | null)) {
      return {
        kind: 'schema-absent',
        placeholder: 'Membership status pending — see ADR-0010.',
      };
    }
    return { kind: 'ok', data: null };
  }
}

async function fetchWallet(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
): Promise<SectionResult<WalletRow>> {
  try {
    const { data, error } = await supabase
      .from('time_wallets')
      .select('balance_cents')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) {
        return {
          kind: 'schema-absent',
          placeholder: 'Time bank pending — see ADR-0010.',
        };
      }
      return { kind: 'ok', data: null };
    }
    const wallet: WalletRow | null = data ?? null;
    return { kind: 'ok', data: wallet };
  } catch (err: unknown) {
    if (isMissingTableError(err as { code?: string; message?: string } | null)) {
      return {
        kind: 'schema-absent',
        placeholder: 'Time bank pending — see ADR-0010.',
      };
    }
    return { kind: 'ok', data: null };
  }
}

async function fetchRecentActivity(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
): Promise<AuditRow[]> {
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, action, target_type, target_id, created_at')
      .eq('target_id', profileId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error || !data) return [];
    const rows: AuditRow[] = data;
    return rows;
  } catch {
    return [];
  }
}

async function fetchRecentPayments(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
): Promise<SectionResult<PaymentRow[]>> {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('id, amount_cents, status, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) {
      if (isMissingTableError(error)) {
        return {
          kind: 'schema-absent',
          placeholder: 'Payment integration pending — see ADR-0010 / 0036.',
        };
      }
      return { kind: 'ok', data: null };
    }
    const payments: PaymentRow[] = data ?? [];
    return { kind: 'ok', data: payments };
  } catch (err: unknown) {
    if (isMissingTableError(err as { code?: string; message?: string } | null)) {
      return {
        kind: 'schema-absent',
        placeholder: 'Payment integration pending — see ADR-0010 / 0036.',
      };
    }
    return { kind: 'ok', data: null };
  }
}

// ---- Section + DRow primitives ---------------------------------------------

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={heading}
      style={{
        marginBottom: 24,
        border: '1px solid var(--border-faint)',
        borderRadius: 8,
        background: 'var(--ink-850)',
      }}
    >
      <header
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-faint)',
        }}
      >
        <h2
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 22,
            fontWeight: 500,
            margin: 0,
          }}
        >
          {heading}
        </h2>
      </header>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </section>
  );
}

function DRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 16,
        padding: '8px 0',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
      }}
    >
      <dt
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, color: 'var(--ivory-200)' }}>{value}</dd>
    </div>
  );
}

function formatPeriodCell(iso: string | null): React.ReactNode {
  if (!iso) return '—';
  const { utc, central } = formatUtcAndCentral(iso);
  return (
    <span>
      <span>{utc}</span>
      <span style={{ color: 'var(--ivory-400)', fontSize: 12, marginLeft: 8 }}>{central}</span>
    </span>
  );
}

// ---- Shared styles ---------------------------------------------------------

const dlStyle: React.CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
};

const thStyle: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontWeight: 500,
};

const placeholderStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--ivory-400)',
  fontSize: 14,
};
