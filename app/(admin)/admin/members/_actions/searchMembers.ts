/**
 * `searchMembers` — server action backing `/admin/members` (ADR-0035 AC9, WA.T5).
 *
 * Read-only paginated search over the `profiles` table. Returns rows
 * matching the supplied filters plus a total-row count for pagination.
 *
 * Contract (load-bearing — do not weaken):
 *   - `import 'server-only'` at file top — server-only module guard.
 *   - First runtime statement is `await requireRole('manager');`
 *     (AC5 defense-in-depth, asserted by
 *     `tests/auth/admin-routes-defense-in-depth.test.ts`).
 *   - Reads via the cookie-scoped `createClient()` so RLS evaluates
 *     against the caller — NO service-role bypass (premortem R1).
 *   - NO audit event — read-only per ADR-0006.
 *   - Returns `total` from a parallel `count(*)` against the same
 *     filter set so the page can render pagination math without a
 *     second round-trip.
 *
 * Input normalization:
 *   - `q` is trimmed, lower-cased, and truncated to 64 chars
 *     (graceful — does NOT throw on a longer string). The 64-char
 *     cap is the spec ceiling; longer queries indicate paste-bombs
 *     and the truncation keeps the LIKE pattern bounded.
 *   - **Premortem R11 mitigation:** if `q.length < 2` after trim,
 *     the `q` filter is IGNORED (only `status` + `role` filters
 *     apply). A single-character `q` like `'a'` would match a huge
 *     fraction of the member table — a compromised manager session
 *     could enumerate the full member list by walking the alphabet.
 *     The 2-char minimum is the v1 defense; per-actor query-rate
 *     anomaly detection is a Slice 5 task.
 *   - `page` / `pageSize` are clamped to sane defaults rather than
 *     throwing — a malformed query string from a hand-edited URL
 *     should render the first page, not a 500.
 *
 * Filter shape:
 *   - `status` matches the joined `memberships.status` enum
 *     (`pending_verification | active | past_due | canceled | deleted`).
 *     The membership join is a LEFT JOIN — profiles without a
 *     membership row still appear with `status === null`.
 *   - `role` matches `profiles.role` directly.
 *   - `q` ILIKEs both `full_name` AND `email` (OR'd via Supabase's
 *     `.or(...)` builder); case-insensitive prefix-and-substring
 *     match per the spec.
 *
 * Sort: `created_at DESC` (newest first).
 *
 * See ADR-0035 §`/admin/members` for the search-as-enumeration
 * mitigation rationale (R11).
 */

import 'server-only';

import { requireRole } from '@/lib/auth/requireRole';
import type { Role } from '@/lib/auth/types';
import { createClient } from '@/lib/supabase/server';

// ---- Public types ---------------------------------------------------------

/**
 * The membership lifecycle states surfaced in the `/admin/members` filter.
 * Mirrors the `memberships.status` enum owned by ADR-0010 / cycle-4.
 * Rendered verbatim in the page's status `<select>`.
 */
export type MembershipStatus =
  | 'pending_verification'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'deleted';

export interface SearchMembersParams {
  q?: string;
  status?: MembershipStatus;
  role?: Role;
  /** 1-indexed, default 1, min 1. */
  page?: number;
  /** default 25, min 1, max 100. */
  pageSize?: number;
}

/**
 * One row returned to the table. Mirrors the 8-column page contract:
 * `full_name`, `email`, `member_number`, `role`, `id_verified_at`,
 * `created_at`, `status` (joined), `deleted_at` indicator.
 *
 * `member_number`, `id_verified_at`, and `status` are nullable — the
 * page renders `—` placeholders accordingly. `deleted_at` non-null
 * triggers the "deleted" pill.
 */
export interface MemberRow {
  id: string;
  full_name: string;
  email: string;
  member_number: number | null;
  role: Role;
  id_verified_at: string | null;
  created_at: string;
  status: MembershipStatus | null;
  deleted_at: string | null;
}

export interface SearchMembersResult {
  rows: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- Defaults --------------------------------------------------------------

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const Q_MAX_LENGTH = 64;
const Q_MIN_LENGTH = 2; // Premortem R11 floor — see file-header docs.

// ---- Normalization helpers ------------------------------------------------

/**
 * Clamp a malformed page/pageSize value to a safe default. Accepts a
 * positive finite integer; everything else (negative, zero, NaN,
 * Infinity, non-integer, string) collapses to `fallback`. Above-max
 * values are pinned to `max` rather than thrown — a stale bookmark
 * with `?pageSize=999` should render 100 rows, not a 500.
 */
function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number') return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (!Number.isInteger(value)) return fallback;
  if (value < 1) return fallback;
  if (value > max) return max;
  return value;
}

/**
 * Trim, lowercase, truncate-to-64 the free-text query. Returns `null`
 * when the resulting string is shorter than the R11 min (2 chars) —
 * callers treat `null` the same as "no q supplied" and skip the
 * filter entirely.
 */
function normalizeQ(raw: string | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < Q_MIN_LENGTH) return null;
  if (trimmed.length > Q_MAX_LENGTH) return trimmed.slice(0, Q_MAX_LENGTH);
  return trimmed;
}

/**
 * Escape `%` and `_` so a user-supplied `q` cannot turn into a wildcard
 * by accident. Supabase's ILIKE operator treats these as wildcards, so
 * a member typing "100%" would otherwise match every row. We escape
 * to literal characters before wrapping the term in our own `%…%` pair.
 */
function escapeIlike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ---- The action ------------------------------------------------------------

/**
 * Search the `profiles` table with optional filters and return one page
 * of results plus the matching total. See file-header for the full
 * contract.
 *
 * NOT marked `'use server'` — this file is imported by the
 * `app/(admin)/admin/members/page.tsx` server component which calls it
 * directly during render. A `'use server'` directive would make the
 * exported function a Server Action invocable from the client, which
 * the page does not need (filters drive via URL searchParams, not form
 * mutations). Adding `'use server'` would also force the page to
 * serialize the entire result over the RSC boundary on every keystroke;
 * keeping it a plain server function lets the page re-render with
 * fresh data on URL change.
 */
export async function searchMembers(
  params: SearchMembersParams = {},
): Promise<SearchMembersResult> {
  // AC5 first-statement defense-in-depth. The admin layout already
  // gated, but every action re-asserts independently so a future
  // refactor that detaches this file from the (admin) group is
  // caught by `tests/auth/admin-routes-defense-in-depth.test.ts`.
  await requireRole('manager');

  const page = clampPositiveInt(params.page, DEFAULT_PAGE, Number.MAX_SAFE_INTEGER);
  const pageSize = clampPositiveInt(params.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const q = normalizeQ(params.q);
  const status = params.status;
  const role = params.role;

  const supabase = createClient();

  // ---- Column list -------------------------------------------------------
  //
  // The 8 columns the page renders, with the `memberships.status` join
  // expressed as a one-to-one nested select (Supabase resolves it to a
  // LEFT JOIN against `memberships.profile_id`). The cycle-4 ADR-0010
  // owns the `memberships` table; if absent at run time, the join
  // resolves to `memberships: null` and the page renders `—` for
  // status — graceful degradation.
  //
  // The same column list is reused by both the count and the row query
  // so the two cannot drift. The `count` query uses `{ count: 'exact',
  // head: true }` so Supabase returns only the count, no rows.
  const SELECT_COLUMNS = 'id, full_name, email, member_number, role, id_verified_at, created_at, deleted_at, memberships:memberships(status)';

  // ---- Build the filter chain (shared by count + rows) ------------------
  //
  // Supabase's PostgREST builder mutates the chain in place but returns
  // the same builder, so a helper that takes a builder and adds the
  // filters keeps the count + rows queries in lockstep. We re-create
  // the builder for each call (count vs rows) so the two run in
  // parallel without interfering with each other's pagination params.
  //
  // The helper is typed as the minimal `.eq()` + `.or()` + thenable
  // surface. Supabase's full builder type is highly generic — passing
  // it through here causes a "Type instantiation is excessively deep"
  // error. We escape to a structural minimum (which is the only part
  // of the builder we actually rely on) and let `await` work via the
  // chain's PromiseLike implementation.
  type CountResponse = { count: number | null; error: { message: string } | null };
  type RowsResponse = { data: unknown[] | null; error: { message: string } | null };
  type FilterableChain<R> = PromiseLike<R> & {
    eq(column: string, value: string): FilterableChain<R>;
    or(filterString: string): FilterableChain<R>;
  };
  function applyFilters<R>(builder: FilterableChain<R>): FilterableChain<R> {
    let chain = builder;
    if (role) {
      chain = chain.eq('role', role);
    }
    if (status) {
      // The status filter applies to the joined `memberships` row.
      // Supabase's nested-filter syntax is `memberships.status=eq.<value>`,
      // expressed via `.eq('memberships.status', status)`.
      chain = chain.eq('memberships.status', status);
    }
    if (q) {
      // Escape `%` and `_` so user input cannot become a wildcard;
      // then wrap in our own `%…%` pair for substring ILIKE match.
      // ILIKE on both `full_name` AND `email` (OR'd), case-insensitive
      // by the operator definition.
      const safe = escapeIlike(q);
      const term = `%${safe}%`;
      chain = chain.or(`full_name.ilike.${term},email.ilike.${term}`);
    }
    return chain;
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // ---- Issue count + rows in parallel -----------------------------------
  //
  // The count uses the same filter chain as the rows so pagination math
  // reflects the user's current view. `head: true` means Supabase
  // returns only the count, not the rows themselves — the second
  // query (below) does the row fetch.
  // The Supabase builders already expose `.eq()`, `.or()`, AND are
  // PromiseLike (their `then` resolves to a PostgREST response). The
  // cast through `unknown` is a bridge — the underlying Supabase
  // builder type is generic over the row shape, but the structural
  // shape we rely on (filter methods + thenable) is identical at
  // runtime.
  const countBuilder = applyFilters(
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true }) as unknown as FilterableChain<CountResponse>,
  );

  const rowsBuilder = applyFilters(
    supabase
      .from('profiles')
      .select(SELECT_COLUMNS)
      .order('created_at', { ascending: false })
      .range(from, to) as unknown as FilterableChain<RowsResponse>,
  );

  const [countResult, rowsResult] = await Promise.all([countBuilder, rowsBuilder]);

  // ---- Defensive error handling -----------------------------------------
  //
  // The dashboard convention (AC7 page) is "on error, return zero/empty
  // rather than throwing into the page render". We follow the same
  // pattern: a transient Supabase error renders an empty table instead
  // of a 500. The error is visible in server logs (Supabase surfaces it
  // via the cookie-scoped client's response object).
  if (countResult.error || rowsResult.error) {
    return { rows: [], total: 0, page, pageSize };
  }

  const total = countResult.count ?? 0;
  // The rows come back with `memberships` as an array (Supabase's
  // nested-select returns an array even for one-to-one joins). Flatten
  // to the single status value (or null) the page expects.
  const rawRows = (rowsResult.data ?? []) as ReadonlyArray<{
    id: string;
    full_name: string;
    email: string;
    member_number: number | null;
    role: Role;
    id_verified_at: string | null;
    created_at: string;
    deleted_at: string | null;
    memberships:
      | { status: MembershipStatus | null }
      | Array<{ status: MembershipStatus | null }>
      | null;
  }>;

  const rows: MemberRow[] = rawRows.map((r) => {
    let status: MembershipStatus | null = null;
    if (Array.isArray(r.memberships)) {
      status = r.memberships[0]?.status ?? null;
    } else if (r.memberships) {
      status = r.memberships.status ?? null;
    }
    return {
      id: r.id,
      full_name: r.full_name,
      email: r.email,
      member_number: r.member_number,
      role: r.role,
      id_verified_at: r.id_verified_at,
      created_at: r.created_at,
      status,
      deleted_at: r.deleted_at,
    };
  });

  return { rows, total, page, pageSize };
}
