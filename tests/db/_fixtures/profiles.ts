/**
 * profiles fixture — column-permissive seeder for the ADR-0003 RLS test suite.
 *
 * Owns: `seedProfile` (single insert) + `seedMembers` (bulk-id helper for
 * cross-tenant denial tests). DO NOT add other helpers here — t4 owns the
 * test harness, t2 owns auth-stub, and per-cycle additions belong to the
 * ADR that introduces the column (see ProfileRow JSDoc).
 *
 * --------------------------------------------------------------------------
 * SERVICE-ROLE SEED PATH (load-bearing — see spec AC8 sub-cases)
 *
 * The t1 migration enables RLS on `profiles` and ships NO insert policy
 * (signup is service-role only — see ADR-0002 cycle 3). RLS therefore denies
 * any INSERT unless the bypass predicate `auth.uid() IS NULL` holds.
 *
 * CALLERS MUST clear test.uid before invoking `seedProfile` — either by
 * leaving `test.uid` unset (the default after `setupAuthStub`) or by calling
 * `setTestUid(pg, null)` explicitly. Any per-test identity set via
 * `setTestUid(pg, '<uuid>')` BEFORE the seed will cause the INSERT to be
 * denied silently by RLS (Postgres reports zero rows affected; the SELECT
 * read-back then returns nothing and this helper throws).
 *
 * Recommended pattern in t4's suite:
 *
 *   beforeEach(async () => {
 *     await resetAuthStub(pg);   // clears test.uid → bypass predicate holds
 *     await seedProfile(pg, ...) // seeds as service-role
 *     await setTestUid(pg, ...)  // THEN switch to the per-test identity
 *   });
 *
 * --------------------------------------------------------------------------
 * EMAIL UNIQUENESS (t4 premortem #15)
 *
 * The `email` column has a UNIQUE constraint at the DB layer (see migration
 * 0002, line 40). The default email here uses a random suffix derived from
 * the row's UUID prefix so multiple `seedProfile()` calls in the same test
 * do not collide on the unique index. Tests that assert on email values
 * MUST pass an explicit `email` override.
 * --------------------------------------------------------------------------
 */

import type { PGlite } from '@electric-sql/pglite';

/**
 * v1 profile columns owned by ADR-0003 cycle 1. Future ADRs add columns:
 *   - id_verified_at, id_doc_path, member_agreement_signed_at, member_number
 *     → ADR-0009 (cycle 4)
 *   - sms_opt_in_at → ADR-0025 (Slice 3)
 *   - deleted_at → ADR-0023 (cycle 6)
 *   - display_tz → ADR-0034 (slice 1) — additive type widening; the v1
 *     defaults below leave it unspecified (`undefined`) so cycle 1 / cycle 2
 *     sub-cases continue passing unchanged. ADR-0034's spec AC14 + the cycle
 *     1 spec t7 "column-permissive constraint" both rely on this property:
 *     the field is declared optional here, and the `buildInsert` helper
 *     below skips `undefined` keys so the INSERT does not reference the
 *     `display_tz` column unless the caller passes it explicitly.
 *
 * The `[extra: string]: unknown` index signature accepts additional columns
 * so future cycles can extend the seed without rewriting this fixture. DO
 * NOT add specific future-column fields here — that steals scope from the
 * owning ADR and forces this fixture to evolve in lockstep with every
 * downstream cycle. `display_tz` is the load-bearing exception because the
 * ADR-0034 cycle authors a test (`tests/db/clubs-and-display-tz.test.ts`)
 * that needs `seedProfile`'s read-back return type to surface the column
 * to callers without an explicit `as unknown as` cast.
 */
export interface ProfileRow {
  id: string; // uuid; defaults to crypto.randomUUID()
  full_name: string; // defaults: 'Test User <random suffix>'
  dob: string; // ISO date YYYY-MM-DD; defaults to '1990-01-01' (well over 21)
  phone: string | null; // defaults to null (column is nullable)
  email: string; // defaults to a randomized address
  role: 'member' | 'cashier' | 'manager' | 'owner'; // defaults to 'member'
  /**
   * ADR-0034 per-member display timezone override. Nullable at the DB
   * layer; the v1 default is `undefined` so the column is NOT referenced
   * in the INSERT unless the caller passes an explicit value (preserves
   * the cycle 1 / cycle 2 regression contract — see header).
   */
  display_tz?: string | null;
  // Future ADR-owned columns (e.g. deleted_at, id_verified_at) are forwarded
  // verbatim to the INSERT via this index signature. Do not promote them to
  // first-class fields here.
  [extra: string]: unknown;
}

/**
 * Columns the v1 seeder is responsible for defaulting. Used to drive both
 * default-fill and the parameterized INSERT column list. Order is stable so
 * the generated SQL is deterministic for snapshot-friendly debugging.
 */
const V1_COLUMNS = ['id', 'full_name', 'dob', 'phone', 'email', 'role'] as const;

/**
 * Build the INSERT statement for the columns actually present in `row`
 * (skipping `undefined`). `null` is a meaningful value (e.g. `phone`) and
 * MUST be passed through. Returns the SQL text and the matching binding
 * array for `pg.query(sql, bindings)`.
 *
 * Rationale for skipping `undefined` rather than always inserting all
 * columns: future ADR-added columns (forwarded via the `extra` index
 * signature) may not be present on every call. Forcing them in with
 * `undefined` would require this fixture to know the DB-level default for
 * every future column — that knowledge belongs to the owning ADR's
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
  const sql = `INSERT INTO profiles (${keys.join(', ')}) VALUES (${placeholders.join(', ')})`;
  return { sql, bindings };
}

/**
 * Seed one profile into the connected PGlite instance.
 *
 * Uses the service-role "bypass" path: CALLER MUST first call
 * `setTestUid(pg, null)` (or run before any per-test identity is set) so RLS
 * does not deny the INSERT — fixtures seed as superuser. See file header
 * "SERVICE-ROLE SEED PATH" for the full contract.
 *
 * Returns the inserted row as observed by a follow-up SELECT, so callers
 * receive any DB-level defaults (e.g. `created_at`, `updated_at` if the
 * caller did not override them) alongside the canonical id. The returned
 * object's shape is `ProfileRow`; extra DB columns are accessible via the
 * index signature.
 *
 * Caller is responsible for cleaning up between tests (recommended:
 * BEGIN/ROLLBACK savepoints in beforeEach/afterEach, configured by the
 * suite that uses this helper — see `tests/db/rls-profiles.test.ts` t4).
 *
 * Email defaults are unique-by-construction (random suffix derived from the
 * row UUID). DO NOT rely on email defaults across multiple seeds within the
 * same test — pass an explicit `email` override if the test asserts on
 * email values.
 */
export async function seedProfile(
  pg: PGlite,
  overrides: Partial<ProfileRow> = {},
): Promise<ProfileRow> {
  const id = overrides.id ?? crypto.randomUUID();
  // Suffix derived from the UUID prefix so the email default is unique by
  // construction (UNIQUE constraint at the DB layer; see migration 0002
  // line 40). Multiple seedProfile() calls in one test will not collide.
  const suffix = id.slice(0, 8);
  const defaults: Pick<ProfileRow, (typeof V1_COLUMNS)[number]> = {
    id,
    full_name: `Test User ${suffix}`,
    dob: '1990-01-01',
    phone: null,
    email: `seed.${suffix}@test.local`,
    role: 'member',
  };
  // Order matters: spread defaults first, then overrides, then re-pin id so
  // a caller passing only `{ full_name: 'X' }` cannot accidentally clobber
  // it via prototype trickery. (Belt-and-suspenders — TypeScript already
  // narrows `overrides` to Partial<ProfileRow>.)
  const row: ProfileRow = { ...defaults, ...overrides, id };

  const { sql, bindings } = buildInsert(row);
  await pg.query(sql, bindings);

  // Read back so callers see DB-level defaults (created_at, updated_at) and
  // any future-column defaults landed by downstream ADRs. If the INSERT was
  // silently denied by RLS (e.g. caller forgot to clear test.uid — see file
  // header), the SELECT returns zero rows and we throw with a pointed
  // message rather than letting the test fail downstream with a confusing
  // "row not found" error.
  const result = await pg.query<ProfileRow>('SELECT * FROM profiles WHERE id = $1', [id]);
  const inserted = result.rows[0];
  if (!inserted) {
    throw new Error(
      `seedProfile: INSERT did not produce a readable row for id=${id}. ` +
        'Most likely cause: RLS denied the INSERT because test.uid was set ' +
        'when the seed ran. Call setTestUid(pg, null) (or resetAuthStub(pg)) ' +
        'BEFORE seeding — the bypass predicate is auth.uid() IS NULL.',
    );
  }
  return inserted;
}

/**
 * Convenience: seed N members for cross-tenant denial tests. Returns the
 * inserted ids in order. Each profile uses default values (members only),
 * with unique-by-construction emails.
 *
 * Use this in t4's cross-tenant SELECT/UPDATE/DELETE denial sub-cases where
 * the test only needs distinct-but-otherwise-uninteresting member rows.
 */
export async function seedMembers(pg: PGlite, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const profile = await seedProfile(pg, {});
    ids.push(profile.id);
  }
  return ids;
}
