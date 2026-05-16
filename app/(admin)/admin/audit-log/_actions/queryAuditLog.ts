import 'server-only';

/**
 * `queryAuditLog` — read-only audit_log query for `/admin/audit-log`
 * (ADR-0035 AC20, WB.T11).
 *
 * Contract per AC20:
 *   - `await requireRole('manager');` as the FIRST `await` token in the
 *     exported function body. The (admin) layout already gates entry,
 *     and `audit_log_select_manager` RLS gates the row read — this
 *     action is the third line of defense (AC5 defense-in-depth).
 *   - Reads via the cookie-scoped `createClient()` so RLS evaluates
 *     against the caller's session. A `cashier`-roled session that
 *     somehow reaches this code path returns an empty array, not an
 *     error — RLS quietly elides the rows it cannot see.
 *   - **NO audit event** — ADR-0006 §"What does NOT get logged: Read
 *     access". Reading the audit log is not audited; auditing the audit
 *     log is auditing the auditor. Mutations of audit_log are
 *     structurally impossible (no UPDATE / DELETE policies on the table).
 *   - Sort: `created_at DESC`. Pagination via parallel `count(*)` on
 *     the same filter. Default page size 50, max 200 (AC19).
 *
 * Filters (all optional, free-text):
 *   - `actionPrefix` — applied as `WHERE action LIKE $prefix || '%'`.
 *   - `actorEmail` — sub-query resolves email → profile UUID via
 *     `SELECT id FROM profiles WHERE email = $1`; the resulting UUID
 *     becomes the `actor_id` filter. If the email does not resolve
 *     (typo, deleted profile), the action short-circuits to `{rows:
 *     [], total: 0}` — there are no rows to find.
 *   - `targetType`, `targetId` — literal equality.
 *   - `fromUtc`, `toUtc` — already-converted-to-UTC ISO strings. The
 *     page is responsible for converting datetime-local Central
 *     inputs to UTC before calling.
 *
 * Joined `actor_email`: a LEFT JOIN to `profiles` via PostgREST's
 * embedded-resource syntax (`profile:profiles!actor_id(email)`). When
 * the join misses (NULL actor_id, or actor_id references an
 * already-anonymized row whose profile row has been replaced), the
 * embedded object is null and the caller (the page) renders the
 * literal "system" for the column.
 *
 * Premortem R1 mitigation: the action MUST NOT reach for the
 * service-role admin client. RLS is the row-scope authority; service
 * role is reserved for the privacy-export pipeline (ADR-0023) and a
 * handful of fail-loud orphan-recovery paths (ADR-0009).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC20
 * Task: .conductor/0035 t12 (WB.T11)
 */

import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

/**
 * Shape returned to the page. Mirrors the audit_log column list (AC19
 * columns) plus the LEFT-JOIN-resolved `actor_email`. The page falls
 * back to the literal "system" when this field is null or missing.
 *
 * Targets that may resolve to a profile email get a `target_email`
 * companion — populated when target_type === 'profile' AND target_id
 * resolves to a known profile. The page uses this for the R8 banner
 * scan (anonymized profile detection via the `del:` prefix).
 */
export type AuditLogRow = {
  id: number;
  action: string;
  target_type: string;
  target_id: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  target_email: string | null;
};

export type QueryAuditLogParams = {
  actionPrefix?: string;
  actorEmail?: string;
  targetType?: string;
  targetId?: string;
  fromUtc?: string;
  toUtc?: string;
  page?: number;
  pageSize?: number;
};

export type QueryAuditLogResult = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Embedded-resource selector. PostgREST resolves
 *   `actor:profiles!actor_id(email)`
 * to a LEFT JOIN on `profiles` keyed by `audit_log.actor_id`. When the
 * join misses, the embedded object is `null` — never throws.
 *
 * The selector includes the explicit audit_log columns first; the
 * embedded `actor` resource is appended. We also embed a `target_profile`
 * lookup keyed by `target_id` so the R8 anonymized-profile banner has
 * the resolved email available without a second round-trip. The join
 * is loose (target_id is TEXT, not a FK to profiles) — PostgREST emits
 * a LEFT JOIN with `target_id::uuid = profiles.id` only when the cast
 * succeeds; otherwise the resource resolves to null and we render the
 * raw target_id verbatim.
 */
const SELECT_COLUMNS =
  'id, action, target_type, target_id, before, after, ip, user_agent, created_at, actor_id, ' +
  'actor:profiles!actor_id(email)';

type RawAuditRow = {
  id: number;
  action: string;
  target_type: string;
  target_id: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  actor_id: string | null;
  actor?: { email: string | null } | { email: string | null }[] | null;
};

/**
 * Normalize the page-size input: undefined → default, NaN/negative →
 * default, > max → max. Page numbers below 1 clamp to 1.
 */
function normalizePagination(page: number | undefined, pageSize: number | undefined) {
  const safePage = !page || page < 1 || Number.isNaN(page) ? 1 : Math.floor(page);
  const requested =
    !pageSize || pageSize < 1 || Number.isNaN(pageSize) ? DEFAULT_PAGE_SIZE : Math.floor(pageSize);
  const safePageSize = Math.min(requested, MAX_PAGE_SIZE);
  return { safePage, safePageSize };
}

/**
 * Extract the embedded actor email from a PostgREST embedded-resource
 * shape. Supabase returns an object when the FK relationship is
 * one-to-one (which `audit_log.actor_id → profiles.id` is); some
 * deployments serialize as a single-element array. Handle both.
 */
function extractActorEmail(row: RawAuditRow): string | null {
  const actor = row.actor;
  if (!actor) return null;
  if (Array.isArray(actor)) return actor[0]?.email ?? null;
  return actor.email ?? null;
}

export async function queryAuditLog(params: QueryAuditLogParams): Promise<QueryAuditLogResult> {
  // AC5 defense-in-depth: FIRST await is the role gate. The (admin)
  // layout already enforced this for the surrounding page render, but
  // the action asserts independently — a future refactor that calls
  // this action from outside (admin) must not silently bypass.
  await requireRole('manager');

  const { safePage, safePageSize } = normalizePagination(params.page, params.pageSize);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  const supabase = createClient();

  // actorEmail filter: resolve email → UUID via profiles sub-query.
  // If the email does not resolve, short-circuit. RLS allows manager+
  // to read all profile rows, so the lookup succeeds when the email
  // exists and the caller is at least manager.
  let actorIdFilter: string | undefined;
  if (params.actorEmail && params.actorEmail.trim()) {
    const { data: profileMatch } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', params.actorEmail.trim())
      .maybeSingle<{ id: string }>();
    if (!profileMatch?.id) {
      // No matching profile → empty result. Do NOT fall through to the
      // unfiltered query (would leak unrelated rows when the user typoed
      // an email).
      return { rows: [], total: 0, page: safePage, pageSize: safePageSize };
    }
    actorIdFilter = profileMatch.id;
  }

  // Build the data query. Each filter is layered on the fluent chain;
  // the final `.range(from, to)` applies pagination. The parallel
  // `count(*)` query runs the same filters with `head: true` so
  // Postgres doesn't ship rows back twice.
  let dataQuery = supabase.from('audit_log').select(SELECT_COLUMNS);
  let countQuery = supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true });

  if (params.actionPrefix && params.actionPrefix.trim()) {
    // PostgREST `like` operator: `%` wildcard, case-sensitive. We
    // anchor at the start (prefix match per AC19) so 'admin.member.'
    // matches 'admin.member.role_changed' but not 'profile.role_change'.
    const pattern = `${params.actionPrefix.trim()}%`;
    dataQuery = dataQuery.like('action', pattern);
    countQuery = countQuery.like('action', pattern);
  }
  if (actorIdFilter) {
    dataQuery = dataQuery.eq('actor_id', actorIdFilter);
    countQuery = countQuery.eq('actor_id', actorIdFilter);
  }
  if (params.targetType && params.targetType.trim()) {
    dataQuery = dataQuery.eq('target_type', params.targetType.trim());
    countQuery = countQuery.eq('target_type', params.targetType.trim());
  }
  if (params.targetId && params.targetId.trim()) {
    dataQuery = dataQuery.eq('target_id', params.targetId.trim());
    countQuery = countQuery.eq('target_id', params.targetId.trim());
  }
  if (params.fromUtc) {
    dataQuery = dataQuery.gte('created_at', params.fromUtc);
    countQuery = countQuery.gte('created_at', params.fromUtc);
  }
  if (params.toUtc) {
    dataQuery = dataQuery.lte('created_at', params.toUtc);
    countQuery = countQuery.lte('created_at', params.toUtc);
  }

  dataQuery = dataQuery.order('created_at', { ascending: false }).range(from, to);

  // Run data + count in parallel. RLS-elided rows (cashier session,
  // etc.) come back as empty data + total 0 — never an error.
  const [{ data, error: dataError }, { count, error: countError }] = await Promise.all([
    dataQuery,
    countQuery,
  ]);

  if (dataError || countError) {
    // Surface the error to the caller so the page can render an
    // error state. Do NOT silently swallow — a query that fails for
    // a non-RLS reason (typo in selector, network) is operational
    // signal the staff need to see. Wrap the supabase error (which is
    // a plain object, not an Error instance) in a real `Error` so
    // upstream `instanceof Error` checks behave and the
    // `@typescript-eslint/only-throw-error` rule is satisfied.
    const cause = dataError ?? countError;
    throw new Error(`audit_log query failed: ${cause?.message ?? 'unknown error'}`, {
      cause,
    });
  }

  // Supabase types the result of a custom-selector .select() as a union
  // that includes a `GenericStringError[]` parse-failure branch — the
  // embedded-resource grammar is too dynamic to narrow statically. Cast
  // through `unknown` so the assertion is explicit rather than silently
  // wrong. Runtime safety comes from the proxy/RLS substrate.
  const rawRows = (data ?? []) as unknown as RawAuditRow[];

  // Best-effort target_email resolution. We do this in a second
  // round-trip rather than via embedded resource because target_id is
  // TEXT (not a FK), so PostgREST cannot embed the join. Collect the
  // unique target_ids where target_type === 'profile' and look them
  // up in one shot. If the lookup fails (RLS, transient error), the
  // rows still render — only the R8 banner detection may miss.
  const targetProfileIds = Array.from(
    new Set(
      rawRows
        .filter((r) => r.target_type === 'profile' && r.target_id)
        .map((r) => r.target_id),
    ),
  );

  let targetEmailById = new Map<string, string | null>();
  if (targetProfileIds.length > 0) {
    const { data: targetProfiles } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', targetProfileIds);
    if (targetProfiles) {
      targetEmailById = new Map(
        (targetProfiles as Array<{ id: string; email: string | null }>).map((p) => [p.id, p.email]),
      );
    }
  }

  const rows: AuditLogRow[] = rawRows.map((row) => ({
    id: row.id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    before: row.before,
    after: row.after,
    ip: row.ip,
    user_agent: row.user_agent,
    created_at: row.created_at,
    actor_id: row.actor_id,
    actor_email: extractActorEmail(row),
    target_email:
      row.target_type === 'profile' ? (targetEmailById.get(row.target_id) ?? null) : null,
  }));

  return {
    rows,
    total: count ?? 0,
    page: safePage,
    pageSize: safePageSize,
  };
}
