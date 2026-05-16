/**
 * `/admin/members` — manager+ paginated member list (ADR-0035 AC8, WA.T5).
 *
 * Server component. Renders an 8-column table backed by the
 * `searchMembers` server action, three URL-driven filter controls
 * (status, role, free-text q), and pagination.
 *
 * Columns (in order — pinned by AC8):
 *   1. full_name
 *   2. email
 *   3. member_number       — `—` when not yet issued
 *   4. role
 *   5. id_verified_at      — UTC + Central pair; `Not verified` when null
 *   6. created_at          — UTC + Central pair
 *   7. status              — joined from memberships; `—` when no row
 *   8. deleted_at indicator — "deleted" pill when non-null
 *
 * Filter controls:
 *   - `status` <select> — pending_verification | active | past_due |
 *     canceled | deleted | any
 *   - `role` <select> — member | cashier | manager | owner | any
 *   - `q` <input type="search"> — free-text ILIKE prefix-substring
 *     against full_name AND email. **Min 2 chars** (premortem R11
 *     mitigation — see `_actions/searchMembers.ts` docs).
 *
 * Filters are URL-driven via searchParams. The page is a plain
 * `<form method="GET">` that submits to itself — no client JS state,
 * no React Hook Form, no fetch. The browser handles submission;
 * Next.js's RSC re-renders this page with the new searchParams. This
 * is the simplest spec-compliant surface and the easiest to test.
 *
 * Pagination:
 *   - Page size 25 (max 100 — enforced in `searchMembers`).
 *   - "Previous" and "Next" anchors with `?page=N` updates.
 *   - Sort `created_at DESC` (newest first — owned by the action).
 *
 * Empty state: literal "No rows match these filters." (verbatim per
 * ADR-0035 §UI Conventions).
 *
 * Defense-in-depth (AC5): FIRST body statement is
 * `await requireRole('manager');` — asserted by
 * `tests/auth/admin-routes-defense-in-depth.test.ts`.
 *
 * Premortem mitigations:
 *   - R1 (admin-client misuse): `searchMembers` uses cookie-scoped
 *     `createClient()` (RLS evaluates against caller). This page
 *     does not touch Supabase directly.
 *   - R11 (search-as-enumeration): single-char `q` queries are
 *     ignored at the action layer.
 */

import Link from 'next/link';

import { requireRole } from '@/lib/auth/requireRole';

import { searchMembers, type MemberRow, type MembershipStatus } from './_actions/searchMembers';
import type { Role } from '@/lib/auth/types';

// Opt out of static prerender — already cascaded from the (admin)
// layout, but pinning it on the page keeps the contract local.
export const dynamic = 'force-dynamic';

// ADR-0034: every operational timestamp renders BOTH UTC and the
// club's local zone (America/Chicago, abbreviated CDT or CST).
const CENTRAL_TZ = 'America/Chicago';

// Status options for the <select>. Sentinel "any" maps to "no filter".
const STATUS_OPTIONS: ReadonlyArray<{ value: MembershipStatus | 'any'; label: string }> = [
  { value: 'any', label: 'Any status' },
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Past due' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'deleted', label: 'Deleted' },
];

const ROLE_OPTIONS: ReadonlyArray<{ value: Role | 'any'; label: string }> = [
  { value: 'any', label: 'Any role' },
  { value: 'member', label: 'Member' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'manager', label: 'Manager' },
  { value: 'owner', label: 'Owner' },
];

// ---- searchParams parsing -------------------------------------------------
//
// Next.js passes searchParams as `Record<string, string | string[] |
// undefined>`. We coerce each known param to a typed value with a
// fallback. Unknown values fall through to the action's clamp/normalize
// layer (which is defensive by design — see `searchMembers` docs).

function readString(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = searchParams[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

function readInt(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): number | undefined {
  const raw = readString(searchParams, key);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return undefined;
  return n;
}

function readStatus(
  searchParams: Record<string, string | string[] | undefined>,
): MembershipStatus | undefined {
  const raw = readString(searchParams, 'status');
  const allowed: ReadonlySet<MembershipStatus> = new Set([
    'pending_verification',
    'active',
    'past_due',
    'canceled',
    'deleted',
  ]);
  if (raw && allowed.has(raw as MembershipStatus)) return raw as MembershipStatus;
  return undefined;
}

function readRole(searchParams: Record<string, string | string[] | undefined>): Role | undefined {
  const raw = readString(searchParams, 'role');
  const allowed: ReadonlySet<Role> = new Set(['member', 'cashier', 'manager', 'owner']);
  if (raw && allowed.has(raw as Role)) return raw as Role;
  return undefined;
}

// ---- Timestamp formatter (UTC + Central per ADR-0034) ---------------------

function formatUtcAndCentral(iso: string | null): { utc: string; central: string } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  // UTC: derive from toISOString() (ECMAScript-standard, locale-stable).
  // Avoids the Intl 'en-CA' midnight-hour='24' quirk on some Node ICU
  // builds (Linux CI) that rotated 00:00 displays to 24:00 of the prior day.
  const isoStr = date.toISOString();
  const utc = `${isoStr.slice(0, 10)} ${isoStr.slice(11, 19)} UTC`;

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

// ---- Pagination helper ----------------------------------------------------

/**
 * Build a `?…` query string from the current filter state plus an
 * overridden `page`. Empty / "any" values are omitted to keep the URL
 * tidy and to keep the search-input control un-prefilled with garbage
 * on re-render.
 */
function buildHref(opts: {
  q?: string | undefined;
  status?: MembershipStatus | undefined;
  role?: Role | undefined;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.status) params.set('status', opts.status);
  if (opts.role) params.set('role', opts.role);
  if (opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return qs ? `/admin/members?${qs}` : '/admin/members';
}

// ---- Page -----------------------------------------------------------------

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminMembersPage({ searchParams = {} }: PageProps) {
  // AC5: first body statement is requireRole('manager').
  await requireRole('manager');

  const q = readString(searchParams, 'q');
  const status = readStatus(searchParams);
  const role = readRole(searchParams);
  const page = readInt(searchParams, 'page');
  const pageSize = readInt(searchParams, 'pageSize');

  // Build the params object conditionally so we don't pass `undefined`
  // explicit fields — `exactOptionalPropertyTypes` rejects that.
  const params: Parameters<typeof searchMembers>[0] = {};
  if (q !== undefined) params.q = q;
  if (status !== undefined) params.status = status;
  if (role !== undefined) params.role = role;
  if (page !== undefined) params.page = page;
  if (pageSize !== undefined) params.pageSize = pageSize;
  const result = await searchMembers(params);
  const { rows, total, page: currentPage, pageSize: currentPageSize } = result;

  const totalPages = Math.max(1, Math.ceil(total / currentPageSize));
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <section
      aria-label="Members"
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
          Members
        </h1>
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 14,
            lineHeight: 1.65,
            marginTop: 8,
          }}
        >
          {total} {total === 1 ? 'member' : 'members'} match{total === 1 ? 'es' : ''} the current
          filters.
        </p>
      </header>

      {/* Filter form — GET-submits back to /admin/members with new
          searchParams. No client JS. */}
      <form
        method="GET"
        action="/admin/members"
        aria-label="Member filters"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 2fr auto',
          gap: 12,
          padding: 16,
          marginBottom: 16,
          border: '1px solid var(--border-faint)',
          borderRadius: 8,
          background: 'var(--ink-850)',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Status
          </span>
          <select
            name="status"
            defaultValue={status ?? 'any'}
            aria-label="Filter by status"
            style={{
              fontSize: 13,
              padding: '8px 10px',
              background: 'var(--ink-900)',
              color: 'var(--ivory-200)',
              border: '1px solid var(--border-faint)',
              borderRadius: 4,
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value === 'any' ? '' : opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Role
          </span>
          <select
            name="role"
            defaultValue={role ?? 'any'}
            aria-label="Filter by role"
            style={{
              fontSize: 13,
              padding: '8px 10px',
              background: 'var(--ink-900)',
              color: 'var(--ivory-200)',
              border: '1px solid var(--border-faint)',
              borderRadius: 4,
            }}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value === 'any' ? '' : opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Search (min 2 chars)
          </span>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name or email…"
            aria-label="Search by name or email"
            maxLength={64}
            style={{
              fontSize: 13,
              padding: '8px 10px',
              background: 'var(--ink-900)',
              color: 'var(--ivory-200)',
              border: '1px solid var(--border-faint)',
              borderRadius: 4,
            }}
          />
        </label>

        <button
          type="submit"
          style={{
            fontSize: 12,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            padding: '10px 18px',
            background: 'var(--ink-900)',
            color: 'var(--ivory-100, var(--ivory-200))',
            border: '1px solid var(--border-faint)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </form>

      {/* Table */}
      <div
        style={{
          border: '1px solid var(--border-faint)',
          borderRadius: 8,
          background: 'var(--ink-850)',
          overflow: 'hidden',
        }}
      >
        {rows.length === 0 ? (
          <p
            role="status"
            style={{
              padding: '32px 24px',
              color: 'var(--ivory-400)',
              fontSize: 14,
              margin: 0,
              textAlign: 'center',
            }}
          >
            No rows match these filters.
          </p>
        ) : (
          <table
            role="table"
            aria-label="Members list"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--ivory-300)',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', background: 'var(--ink-900)' }}>
                <Th>Full name</Th>
                <Th>Email</Th>
                <Th>Member #</Th>
                <Th>Role</Th>
                <Th>ID verified</Th>
                <Th>Created</Th>
                <Th>Status</Th>
                <Th>&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <MemberTableRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            fontSize: 13,
            color: 'var(--ivory-400)',
          }}
        >
          <div>
            Page {currentPage} of {totalPages}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasPrev ? (
              <Link
                href={buildHref({ q, status, role, page: currentPage - 1 })}
                aria-label="Previous page"
                style={paginationLinkStyle}
              >
                ← Previous
              </Link>
            ) : (
              <span aria-disabled="true" style={{ ...paginationLinkStyle, opacity: 0.4 }}>
                ← Previous
              </span>
            )}
            {hasNext ? (
              <Link
                href={buildHref({ q, status, role, page: currentPage + 1 })}
                aria-label="Next page"
                style={paginationLinkStyle}
              >
                Next →
              </Link>
            ) : (
              <span aria-disabled="true" style={{ ...paginationLinkStyle, opacity: 0.4 }}>
                Next →
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </section>
  );
}

// ---- Cell helpers ---------------------------------------------------------

const paginationLinkStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-faint)',
  borderRadius: 4,
  color: 'var(--ivory-200)',
  textDecoration: 'none',
};

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

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      style={{
        padding: '12px 16px',
        verticalAlign: 'top',
        fontFamily: mono ? 'monospace' : undefined,
      }}
    >
      {children}
    </td>
  );
}

function MemberTableRow({ row }: { row: MemberRow }) {
  const idVerified = formatUtcAndCentral(row.id_verified_at);
  const created = formatUtcAndCentral(row.created_at);
  const isDeleted = row.deleted_at !== null;

  return (
    <tr
      data-row-id={row.id}
      data-deleted={isDeleted ? 'true' : undefined}
      style={{ borderTop: '1px solid var(--border-faint)' }}
    >
      <Td>
        <Link
          href={`/admin/members/${row.id}`}
          style={{ color: 'var(--ivory-100, var(--ivory-200))', textDecoration: 'none' }}
        >
          {row.full_name}
        </Link>
      </Td>
      <Td mono>{row.email}</Td>
      <Td mono>{row.member_number !== null ? row.member_number : '—'}</Td>
      <Td>
        <span
          style={{
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid var(--border-faint)',
            color: 'var(--ivory-300)',
          }}
        >
          {row.role}
        </span>
      </Td>
      <Td>
        {idVerified ? (
          <>
            <div>{idVerified.utc}</div>
            <div style={{ color: 'var(--ivory-400)', fontSize: 12 }}>{idVerified.central}</div>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>Not verified</span>
        )}
      </Td>
      <Td>
        {created ? (
          <>
            <div>{created.utc}</div>
            <div style={{ color: 'var(--ivory-400)', fontSize: 12 }}>{created.central}</div>
          </>
        ) : (
          '—'
        )}
      </Td>
      <Td>
        {row.status ? (
          <span style={{ textTransform: 'capitalize' }}>{row.status.replace(/_/g, ' ')}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </Td>
      <Td>
        {isDeleted ? (
          <span
            aria-label="Member is deleted"
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(220, 60, 60, 0.12)',
              border: '1px solid rgba(220, 60, 60, 0.4)',
              color: 'rgb(240, 140, 140)',
            }}
          >
            deleted
          </span>
        ) : null}
      </Td>
    </tr>
  );
}
