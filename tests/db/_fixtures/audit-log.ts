/**
 * audit_log fixture — column-permissive seeder for the ADR-0006 RLS test
 * suite.
 *
 * Owns: `seedAuditLog` (single insert). DO NOT add other helpers here —
 * t4 owns the test harness, t0 owns the lifted rls-helpers, and per-cycle
 * additions belong to the ADR that introduces the column (see AuditLogRow
 * JSDoc).
 *
 * --------------------------------------------------------------------------
 * SERVICE-ROLE / AUTHENTICATED SEED PATH (load-bearing — see spec AC7 sub-cases)
 *
 * The t1 migration enables RLS on `audit_log` with FORCE and ships exactly
 * two policies:
 *   - audit_log_select_manager  : FOR SELECT USING (auth.role_at_least('manager'))
 *   - audit_log_insert_authenticated : FOR INSERT WITH CHECK (auth.uid() IS NOT NULL)
 *
 * There is NO bypass predicate on the INSERT policy (unlike profiles, which
 * gates on `auth.uid() IS NULL` for the service-role / signup path). The
 * audit-log INSERT path admits two callers:
 *
 *   (a) service-role / superuser (BYPASSRLS) — policy never evaluates;
 *       NULL actor_id inserts succeed regardless of WITH CHECK. This is
 *       the documented system-action / webhook-handler path per ADR-0006
 *       and the AC4 INSERT-policy contract invariant.
 *
 *   (b) `app_authenticated` NOBYPASSRLS with a non-NULL `auth.uid()` set
 *       via `setTestUid(pg, '<uuid>')` — the WITH CHECK clause passes
 *       because auth.uid() IS NOT NULL.
 *
 * CALLERS MUST be in one of those two contexts before invoking
 * `seedAuditLog`. An anon caller (NOBYPASSRLS role + cleared test.uid)
 * will be denied with SQLSTATE 42501; the SELECT read-back below then
 * returns nothing and this helper throws with a pointed message.
 *
 * Recommended pattern in t4's suite for service-role seeding:
 *
 *   beforeEach(async () => {
 *     await resetAuthStub(pg);   // clears test.uid → auth.uid() returns NULL
 *     await asServiceRole(pg);   // RESET ROLE → BYPASSRLS path
 *     await seedAuditLog(pg, ...) // inserts as superuser, NULL actor_id ok
 *   });
 *
 * --------------------------------------------------------------------------
 * UNIQUE-BY-CONSTRUCTION DEFAULTS
 *
 * `audit_log` has no UNIQUE constraint on the v1 columns (the `id` is
 * `bigserial` and is server-assigned), but tests that filter on `target_id`
 * / `action` (e.g. AC7.11's negative-integration count assertion) need
 * defaults that don't collide across multiple seeds in one test. The
 * defaults below derive a random suffix from `crypto.randomUUID()` so
 * back-to-back `seedAuditLog()` calls produce distinct rows even with no
 * overrides. Tests that assert on specific values MUST pass explicit
 * overrides for any field they read back.
 * --------------------------------------------------------------------------
 */

import type { PGlite } from '@electric-sql/pglite';

/**
 * v1 audit_log columns owned by ADR-0006 cycle 2. Future ADRs may add
 * columns; the `[extra: string]: unknown` index signature accepts those
 * without fixture rewrites.
 *
 * The `id` is `bigserial` — server-assigned by the sequence; callers do
 * NOT pass it on insert. `seedAuditLog` reads back the row via
 * `RETURNING *` so the returned object reflects the assigned id and the
 * default-filled `created_at`.
 *
 * DO NOT add specific future-column fields here — that steals scope from
 * the owning ADR and forces this fixture to evolve in lockstep with every
 * downstream cycle. Forward additions via the index signature.
 */
export interface AuditLogRow {
  id: number; // bigserial; server-assigned. seedAuditLog reads it back via RETURNING *.
  actor_id: string | null; // uuid FK to auth.users; nullable for system / service-role actions
  action: string;
  target_type: string;
  target_id: string;
  before: unknown; // jsonb; nullable (INSERT events have no before snapshot)
  after: unknown; // jsonb; nullable (DELETE events have no after snapshot)
  ip: string | null; // inet; nullable (trigger-level events can't see HTTP context)
  user_agent: string | null;
  created_at: string; // ISO timestamptz; DB default is now() if omitted
  // Future ADR-owned columns are forwarded verbatim to the INSERT via this
  // index signature. Do not promote them to first-class fields here.
  [extra: string]: unknown;
}

/**
 * Columns the v1 seeder is responsible for defaulting. `id` is excluded —
 * it is `bigserial` and server-assigned. `created_at` is also excluded
 * from the defaults so the DB-level `default now()` lands; callers that
 * need a specific timestamp pass it via overrides. Order is stable so the
 * generated SQL is deterministic for snapshot-friendly debugging.
 */
const V1_DEFAULTED_COLUMNS = [
  'actor_id',
  'action',
  'target_type',
  'target_id',
  'before',
  'after',
  'ip',
  'user_agent',
] as const;

/**
 * Build the INSERT statement for the columns actually present in `row`
 * (skipping `undefined`). `null` is a meaningful value (e.g. `actor_id`,
 * `before`, `after`, `ip`) and MUST be passed through. Returns the SQL
 * text and the matching binding array for `pg.query(sql, bindings)`.
 *
 * Rationale for skipping `undefined` rather than always inserting all
 * columns: future ADR-added columns (forwarded via the `extra` index
 * signature) may not be present on every call. Forcing them in with
 * `undefined` would require this fixture to know the DB-level default
 * for every future column — that knowledge belongs to the owning ADR's
 * migration, not here.
 */
function buildInsert(row: Record<string, unknown>): {
  sql: string;
  bindings: unknown[];
} {
  const keys: string[] = [];
  const placeholders: string[] = [];
  const bindings: unknown[] = [];
  let idx = 1;
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    keys.push(`"${key}"`);
    placeholders.push(`$${idx}`);
    bindings.push(value);
    idx += 1;
  }
  const sql = `INSERT INTO audit_log (${keys.join(
    ', ',
  )}) VALUES (${placeholders.join(', ')}) RETURNING *`;
  return { sql, bindings };
}

/**
 * Seed one audit_log row into the connected PGlite instance.
 *
 * CALLER MUST be in service-role / superuser context (BYPASSRLS — RLS does
 * not evaluate, NULL actor_id is fine), OR running as `app_authenticated`
 * with `auth.uid()` set to a non-NULL uuid via `setTestUid(pg, '<uuid>')`
 * so the `audit_log_insert_authenticated` WITH CHECK clause passes. See
 * file header "SERVICE-ROLE / AUTHENTICATED SEED PATH" for the full
 * contract. An anon caller (NOBYPASSRLS + cleared test.uid) is denied
 * with SQLSTATE 42501 and this helper throws.
 *
 * jsonb columns (`before`, `after`) are passed as-is through the binding;
 * pglite serializes JS objects/arrays/primitives to jsonb. `null` is
 * forwarded verbatim. Callers that need specific JSON shapes for assertion
 * round-trips pass them via overrides.
 *
 * Returns the inserted row via `RETURNING *`, so callers receive the
 * server-assigned `id` and the DB-defaulted `created_at` alongside the
 * fields they passed. The returned object's shape is `AuditLogRow`; extra
 * DB columns added by future ADRs are accessible via the index signature.
 *
 * Caller is responsible for cleaning up between tests (recommended:
 * BEGIN/ROLLBACK savepoints in beforeEach/afterEach, configured by the
 * suite that uses this helper — see `tests/db/audit-log.test.ts` t4).
 *
 * Defaults are unique-by-construction (random suffix per call) so two
 * back-to-back `seedAuditLog()` calls in one test do not collide on
 * `target_id` / `action` filters. Tests that assert on specific values
 * MUST pass explicit overrides for any field they read back.
 */
export async function seedAuditLog(
  pg: PGlite,
  overrides: Partial<AuditLogRow> = {},
): Promise<AuditLogRow> {
  // Suffix derived from a fresh UUID so back-to-back seeds in one test
  // produce distinct rows on indexed columns (`target_id`, `action`) even
  // when the caller passes no overrides. AC7.11 in particular asserts a
  // count under a `target_id = ... AND action = ...` filter; colliding
  // defaults from a sibling seed would silently flip that assertion.
  const suffix = crypto.randomUUID().slice(0, 8);
  const defaults: Pick<
    AuditLogRow,
    (typeof V1_DEFAULTED_COLUMNS)[number]
  > = {
    actor_id: null,
    action: `test.action.${suffix}`,
    target_type: 'test',
    target_id: `target-${suffix}`,
    before: null,
    after: null,
    ip: null,
    user_agent: null,
  };
  // Spread defaults first, then overrides. We do NOT re-pin a server-
  // assigned key (unlike profiles.ts which re-pins `id`) because the
  // bigserial `id` is never present in the INSERT column list — the
  // sequence assigns it. A caller passing `{ id: 42 }` would have it
  // included via the index signature, which is intentional: tests that
  // need a deterministic id pass it explicitly and the DB will honor it
  // (advancing the sequence is the caller's problem in that edge case).
  const row: AuditLogRow & Record<string, unknown> = {
    ...defaults,
    ...overrides,
  } as AuditLogRow & Record<string, unknown>;

  const { sql, bindings } = buildInsert(row);
  const result = await pg.query<AuditLogRow>(sql, bindings);

  // RETURNING * gives us the inserted row directly — no follow-up SELECT
  // needed (and no risk of an RLS-filtered read-back, since RETURNING
  // runs in the same statement context as the INSERT). If the INSERT was
  // silently denied (e.g. caller forgot to clear test.uid AND was running
  // under app_authenticated NOBYPASSRLS — see file header), pglite
  // raises rather than returning zero rows for a policy denial; this
  // throw is the defense-in-depth path for any future driver behavior
  // change where a denied INSERT returns empty.
  const inserted = result.rows[0];
  if (!inserted) {
    throw new Error(
      'seedAuditLog: INSERT did not produce a readable row. Most likely ' +
        'cause: RLS denied the INSERT because the caller is running under ' +
        'app_authenticated NOBYPASSRLS with auth.uid() = NULL (anon). Either ' +
        'switch to service-role (asServiceRole(pg)) OR set a non-NULL ' +
        'auth.uid() via setTestUid(pg, "<uuid>") BEFORE seeding — the ' +
        'audit_log_insert_authenticated WITH CHECK clause requires ' +
        'auth.uid() IS NOT NULL.',
    );
  }
  return inserted;
}
