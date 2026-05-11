---
adr: 0034
slice: 1
risk: medium
acceptance_commands:
  - 'pnpm typecheck'
  - 'pnpm lint'
  - 'pnpm migrate:check'
  - 'pnpm test tests/migrations/'
  - 'pnpm test tests/time/'
  - 'pnpm test tests/lint/'
  - 'pnpm test tests/db/clubs-and-display-tz.test.ts'
  - 'pnpm test tests/db/rls-profiles.test.ts'
  - 'pnpm test tests/db/audit-log.test.ts'
  - 'pnpm test tests/audit/with-audit.test.ts'
  - 'pnpm test scripts/conductor/'
---

# Spec: Timestamp storage in UTC; presentation in club-local time — substrate (ADR-0034 slice 1)

- **ADR:** [0034](../adr/0034-timestamp-and-timezone-policy.md)
- **Status:** Draft
- **Date:** 2026-05-11

## Goal

Land the timestamp-policy substrate every future ADR consumes: a
`lib/time/` helper module that owns every `new Date()` / `Date.now()` call
site, two schema columns that anchor the v1 display zone
(`clubs.display_tz`, `profiles.display_tz`), a single-tier conversion
convention via a Postgres day-bucket SQL lint (`scripts/lint/sql-day-bucket.ts`),
an ESLint `no-restricted-syntax` rule that forbids raw `new Date()` /
`Date.now()` outside `lib/time/`, and the audit-log presentation contract
helper (UTC + America/Chicago side-by-side with offset annotation and
DST-seam banner detection) that the cycle owning the admin viewer will
consume verbatim. **No member-facing UI ships in this slice** — this is
the policy + helper + schema substrate; the audit viewer (ADR-0006 Slice
4), the admin tournament write path with `tz_name` (ADR-0012 Slice 3),
the in-app member-override surface (deferred — see Out of scope), and the
ADR-0008 deployment-hygiene checklist amendment all consume the
substrate this slice ships.

**Test substrate:** vitest. Time-helper unit tests are pure
TypeScript — they exercise the `lib/time/` helpers against
`America/Chicago` DST transition instants and assert that
`Intl.DateTimeFormat`'s zone arithmetic produces the right wall-clock
strings on the spring-forward (2026-03-08 02:00→03:00 CST→CDT) and
fall-back (2026-11-01 02:00→01:00 CDT→CST) seams. The migration that
adds `clubs` + `clubs.display_tz` + `profiles.display_tz` is exercised
under the cycle 1 / cycle 2 pglite scaffolding already in place
(`tests/db/_fixtures/auth-stub.ts`, `tests/db/_fixtures/profiles.ts`,
`tests/db/_fixtures/rls-helpers.ts`) — the new migration `0007_clubs_and_display_tz.sql`
is applied after `0002_profiles_and_roles.sql` and `0003_audit_log.sql`,
the `clubs` single row is seeded, and `profiles.display_tz` is exercised
through an extension of the cycle 1 `seedProfile` fixture (column-permissive
per the cycle 1 KB lesson — adding the optional column does not break
any prior sub-case).

## Acceptance criteria

Numbered, testable. Each is verified by one of the acceptance commands
above.

1. **`lib/time/` module exists with a stable v1 API.** File layout:

   - `lib/time/index.ts` — re-exports the v1 surface (see below).
   - `lib/time/now.ts` — exports `nowUtc(): Date` (the **only** sanctioned
     call site for `new Date()` / `Date.now()` in the repo; see AC4).
   - `lib/time/zones.ts` — exports the `IanaZone` branded-string type, the
     `CLUB_TZ_DEFAULT = 'America/Chicago' as IanaZone` constant, and a
     pure `isValidIanaZone(zone: string): zone is IanaZone` predicate
     (uses `Intl.DateTimeFormat`'s constructor with the candidate zone —
     throws ⇒ false).
   - `lib/time/display.ts` — exports `formatInZone(d: Date, zone: IanaZone,
     opts?: Intl.DateTimeFormatOptions): string`. **This is the only
     `Intl.DateTimeFormat({ timeZone })` call site in application code
     for stored timestamps** outside of the audit-render helper (AC3);
     all member-facing render call sites import from here. (Note: this
     does not contradict ADR-0034's "conversion happens in exactly one
     tier — the database" rule: `lib/time/display.ts` is the **render**
     surface for already-fetched instants, not a substitute for the
     pre-formatted SQL columns the audit viewer receives — see AC3
     audit-render contract.)
   - `lib/time/categories.ts` — exports four category-tagged constructors:
     - `momentUtc(d: Date): Moment` — wraps a Date as a category-1 brand.
     - `wallClockIntent(utc: Date, tz: IanaZone): WallClockIntent` —
       wraps a (utc, tz_name) pair as a category-2 brand. **No write
       path consumes this yet** in slice 1 (the `tournaments.starts_at`
       column ships with ADR-0012 Slice 3); shipping the brand now means
       the type contract is in place when the admin schedule UI lands.
     - `vendorMoment(d: Date, vendorTz?: IanaZone): VendorMoment` — wraps
       a vendor-supplied instant as a category-3 brand. `vendorTz`
       defaults to `'UTC' as IanaZone` (the ADR-0034 deployment
       requirement for Stripe accounts) and exists only for the
       documentation/audit surface, NOT for arithmetic.
     - `jurisdictionalDate(d: string, jurisdiction: string): JurisdictionalDate`
       — wraps an ISO `YYYY-MM-DD` plus a jurisdiction string (`'US-TX'`,
       `'US-FED'`, etc.) as a category-4 brand. The wrapped value is a
       string, not a Date, intentionally — calendar dates have no instant.
   - `lib/time/audit-render.ts` — exports `formatAuditRowDualZone(utc:
     Date, clubZone: IanaZone): { utc: string; club: string; offset:
     'CDT' | 'CST' | string; dstSeam: 'spring-forward' | 'fall-back' |
     null }`. See AC3 for the full contract.

   The `index.ts` re-export surface is **exactly** the symbols above —
   adding new exports requires either a new AC in a later slice or a
   spec amendment in this slice. Workers MUST NOT export `new Date()` /
   `Date.now()` from `lib/time/` directly; the sole sanctioned wrapper
   is `nowUtc()`. Verified by `pnpm typecheck` and
   `pnpm test tests/time/index.test.ts` (snapshot of the export shape).

2. **`lib/time/` helpers behave correctly across DST transitions.** Unit
   tests at `tests/time/now.test.ts`, `tests/time/display.test.ts`,
   `tests/time/zones.test.ts`, `tests/time/audit-render.test.ts`, and
   `tests/time/categories.test.ts` exercise the helpers against fixed
   instants (no use of real wall-clock time — every test
   `vi.useFakeTimers()` and `vi.setSystemTime(new Date('2026-...'))`
   first; the test code itself is the only place `new Date(<literal>)`
   is permitted outside `lib/time/`, with an inline ESLint disable
   comment per AC4's lint-exception clause).

   - **`nowUtc()` sub-cases:**
     1. Returns a `Date` instance whose internal value equals
        `vi.setSystemTime`'s set instant — i.e. the helper is the literal
        wrapper, not an offset-applier.
     2. Returns a new instance on every call (no memoization that would
        freeze across an event loop tick).
     3. Calling `nowUtc()` is invariant under the calling code's
        `process.env.TZ` — the test sets `process.env.TZ = 'America/Los_Angeles'`
        and re-runs to confirm.
   - **`formatInZone()` sub-cases:**
     1. **Spring-forward seam:** instants `2026-03-08T07:30Z` (01:30 CST
        before the jump) and `2026-03-08T08:00Z` (03:00 CDT after the
        jump) format to wall-clock `01:30` and `03:00` respectively. The
        02:00–03:00 wall-clock hour does not exist in America/Chicago on
        this date; assert that a request to format
        `2026-03-08T07:59Z` produces `01:59` (still CST) and
        `2026-03-08T08:00Z` produces `03:00` (now CDT) — the seam is
        skipped, not interpolated.
     2. **Fall-back seam:** instants `2026-11-01T06:30Z` (01:30 CDT
        repeat 1) and `2026-11-01T07:30Z` (01:30 CST repeat 2) both
        format to wall-clock `01:30`. Assert the strings are equal AND
        the underlying instants differ by one hour — this is the
        "ambiguous wall-clock" property the audit-render banner exists
        to disambiguate.
     3. **Offset annotation:** when called with
        `{ timeZoneName: 'short' }`, the spring-forward seam case
        produces `CST` before the jump and `CDT` after.
     4. **Invariance to `process.env.TZ`:** same as `nowUtc()` — set
        `process.env.TZ = 'UTC'`, repeat the formats, assert identical
        output. The conversion is timezone-database-driven, not host-TZ.
   - **`isValidIanaZone()` sub-cases:**
     1. Returns `true` for `'America/Chicago'`, `'America/New_York'`,
        `'UTC'`, `'Etc/UTC'`, `'Europe/London'`.
     2. Returns `false` for `''`, `'CST'` (abbreviation, not IANA),
        `'America/Houston'` (not a real IANA zone),
        `'America/chicago'` (case-sensitive in Node — assert), and
        `'a; DROP TABLE clubs; --'` (sanity / no-throw on adversarial
        input).
   - **`formatAuditRowDualZone()` sub-cases:** see AC3.
   - **`momentUtc()` / `wallClockIntent()` / `vendorMoment()` /
     `jurisdictionalDate()` sub-cases:** each constructor produces a
     branded value that does not unify with the others under
     `tsc --noEmit` (verified by `pnpm typecheck` over a
     deliberately-failing fixture in
     `tests/time/categories.type-fixture.ts.skip` — the file is named
     `.ts.skip` and is NOT compiled by tsc on every run; a separate
     vitest sub-case `npx tsc --noEmit tests/time/categories.type-fixture.ts.skip`
     runs the file through tsc in-band and asserts it fails with the
     expected error codes. **If this in-band tsc invocation proves
     fragile, the worker MAY drop the type-level test and instead assert
     the brand at runtime via a discriminator field — load-bearing
     property is "the four categories are not interchangeable," not the
     specific mechanism**).

   Verified by `pnpm test tests/time/`.

3. **Audit-log presentation contract helper exists and matches the
   ADR-0034 §"Audit log presentation contract" rules.**
   `lib/time/audit-render.ts` exports `formatAuditRowDualZone(utc: Date,
   clubZone: IanaZone)` returning `{ utc: string; club: string; offset:
   'CDT' | 'CST' | string; dstSeam: 'spring-forward' | 'fall-back' |
   null }`. Properties:

   - `utc` is formatted as `YYYY-MM-DDTHH:mm:ssZ` (ISO 8601, UTC, second
     precision — milliseconds are NOT rendered in v1 because the audit
     viewer's primary sort axis is UTC and millisecond resolution adds
     visual noise without operational value).
   - `club` is formatted as `YYYY-MM-DD HH:mm:ss` in `clubZone` (no `T`
     separator, no trailing zone designator — the offset is in a
     separate column).
   - `offset` is the in-effect short-zone abbreviation in `clubZone` at
     `utc`. For America/Chicago this is `'CDT'` (UTC-05:00) or `'CST'`
     (UTC-06:00). Non-CT zones return whatever `Intl.DateTimeFormat`
     with `{ timeZoneName: 'short' }` produces.
   - `dstSeam` is `'spring-forward'` if `utc` falls within the 1-hour
     UTC window centered on the spring-forward instant for `clubZone`
     in the year of `utc`; `'fall-back'` analogously for the fall-back
     window; `null` otherwise. The seam-detection algorithm: compute
     `formatInZone(utc, clubZone, { timeZoneName: 'short' })` and
     `formatInZone(utc - 1h, clubZone, { timeZoneName: 'short' })`; if
     they differ, `utc` is on a seam; the direction is inferred from
     which abbreviation gained (CDT → spring-forward) or lost (CST →
     fall-back). The 1-hour window catches the case where the viewer
     is rendering a row that occurred within the repeated/skipped hour.
   - **No DOM, no React, no rendering** in this helper — it returns a
     plain object the (deferred) audit viewer consumes. Pinning this
     contract now means the viewer cycle (ADR-0006 Slice 4) writes
     pure JSX over the result; no future cycle re-derives the
     DST-banner logic.

   Sub-cases (in `tests/time/audit-render.test.ts`):
   1. Mid-summer instant `2026-07-15T18:00Z` → `{ utc: '2026-07-15T18:00:00Z',
      club: '2026-07-15 13:00:00', offset: 'CDT', dstSeam: null }`.
   2. Mid-winter instant `2026-01-15T18:00Z` → `{ utc:
      '2026-01-15T18:00:00Z', club: '2026-01-15 12:00:00', offset: 'CST',
      dstSeam: null }`.
   3. Spring-forward seam, just before: `2026-03-08T07:59:59Z` →
      `dstSeam: 'spring-forward'` (within the 1h window).
   4. Spring-forward seam, just after: `2026-03-08T08:00:01Z` →
      `dstSeam: 'spring-forward'` (within the 1h window, post-jump side).
   5. Spring-forward, outside the window: `2026-03-08T05:00:00Z` →
      `dstSeam: null` (before the window).
   6. Fall-back seam, repeat 1: `2026-11-01T06:30:00Z` →
      `dstSeam: 'fall-back'`, `club: '2026-11-01 01:30:00'`, `offset:
      'CDT'`.
   7. Fall-back seam, repeat 2: `2026-11-01T07:30:00Z` →
      `dstSeam: 'fall-back'`, `club: '2026-11-01 01:30:00'`, `offset:
      'CST'`. (Identical `club` string — the load-bearing ambiguous-hour
      property.)
   8. Non-CT zone: `formatAuditRowDualZone(new Date('2026-07-15T18:00Z'),
      'Europe/London' as IanaZone)` produces `offset: 'BST'`, `club:
      '2026-07-15 19:00:00'`. Exists so a future multi-club expansion
      (ADR-0034 Negative Consequences premortem-risk-1) doesn't have to
      re-derive the helper.

4. **ESLint rule forbids raw `new Date()` / `Date.now()` outside
   `lib/time/`.** Extend `.eslintrc.json`'s `rules` with a
   `no-restricted-syntax` configuration matching the two AST patterns:

   ```json
   {
     "selector": "NewExpression[callee.name='Date'][arguments.length=0]",
     "message": "Use nowUtc() from lib/time/ instead of new Date() — ADR-0034 single-source-of-truth."
   },
   {
     "selector": "CallExpression[callee.object.name='Date'][callee.property.name='now']",
     "message": "Use nowUtc() from lib/time/ instead of Date.now() — ADR-0034 single-source-of-truth."
   }
   ```

   **Both patterns apply repo-wide, with `overrides` excluding three
   path globs** so the helpers can implement themselves and so tests
   that need literal instants can construct them:

   - `lib/time/**/*.ts` (the helper module itself);
   - `tests/**/*.ts` (test code constructs literals via
     `vi.setSystemTime(new Date(<iso-literal>))` and similar);
   - `scripts/**/*.{ts,mjs,js}` (build/migration/conductor scripts run
     outside the application runtime and have no presentation
     surface).

   `new Date(<iso-string-literal>)` and `new Date(<utc-milliseconds>)`
   call signatures with ≥1 argument are **permitted** anywhere — those
   are deterministic constructors that parse a known instant, not a
   reference to wall-clock "now." The AST selector
   `NewExpression[callee.name='Date'][arguments.length=0]` only matches
   the zero-argument form (i.e. "now"). This is deliberate: the
   load-bearing invariant is "wall-clock-now is funneled through
   `nowUtc()`," not "no application code ever instantiates a Date."

   Sub-cases (in `tests/lint/no-naked-date.test.ts`):
   1. Lint passes against a fixture file
      `tests/lint/_fixtures/uses-now-utc.ts` that imports `nowUtc` and
      calls it.
   2. Lint **fails** against `tests/lint/_fixtures/uses-naked-new-date.ts`
      that contains `const d = new Date();` — reports
      `no-restricted-syntax` for that line with the configured message.
   3. Lint **fails** against `tests/lint/_fixtures/uses-naked-date-now.ts`
      that contains `const t = Date.now();` — reports
      `no-restricted-syntax` for that line.
   4. Lint **passes** against `tests/lint/_fixtures/uses-date-with-arg.ts`
      that contains `const d = new Date('2026-01-15T00:00:00Z');` — the
      arg-bearing constructor is permitted.
   5. Lint **passes** against the same naked-`new Date()` fixture if
      it is moved (in-test, by reading the file and rewriting the AST
      override-path) under `lib/time/_fixtures/naked-allowed.ts.skip`
      — proves the override glob works. (Implementation detail: the
      test invokes ESLint programmatically via `new ESLint().lintFiles`,
      not via `pnpm lint` — that lets the test target individual fixture
      files without scanning the whole repo. The acceptance command
      `pnpm lint` separately confirms the rule integrates cleanly with
      the existing `next/core-web-vitals` extends list and that the rest
      of the repo has no naked-Date violations.)

   The rule MUST be added under `rules` (not `overrides`) so it applies
   to every file by default; the path exclusions go under a new
   `overrides` entry that **disables** the rule (sets
   `no-restricted-syntax: 'off'` or returns an empty array of selectors)
   for those globs. The simpler `ignorePatterns` is **wrong** here —
   it would also disable the existing rules from `next/core-web-vitals`
   for those paths.

   Verified by `pnpm lint` (passes — entire repo, including newly-added
   `lib/time/` helpers, is clean) and
   `pnpm test tests/lint/no-naked-date.test.ts` (the fixture-driven
   sub-cases above).

5. **Migration `supabase/migrations/0007_clubs_and_display_tz.sql` exists
   and follows the four-digit `NNNN_<snake_case>.sql` convention.** The
   migration ships exactly these statements, in order, with no others:

   1. `CREATE TABLE clubs (...)` with columns:
      - `id            uuid primary key default gen_random_uuid()` —
        single-row v1 table; multi-club expansion (ADR-0002 Slice-4
        trigger) adds rows, not columns.
      - `slug          text not null unique` — stable URL/config handle.
        v1 default row uses `'default'`.
      - `display_tz    text not null default 'America/Chicago'` — the
        ADR-0034 §"Schema additions" column.
      - `created_at    timestamptz not null default now()`
      - `updated_at    timestamptz not null default now()`
   2. A `CHECK` constraint on `clubs.display_tz` that asserts the value
      is a non-empty string. **No CHECK against an IANA zone allowlist
      at the DB layer** — the IANA tzdata is the Postgres image's
      concern (ADR-0034 deployment dependency); the validation moves
      to the application via `isValidIanaZone()` (AC1). DB CHECKs for
      this would re-introduce the multi-runtime tzdata-divergence
      problem ADR-0034 explicitly rejects.
   3. `ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;` plus
      `ALTER TABLE clubs FORCE ROW LEVEL SECURITY;` — same defense-in-
      depth posture as cycle 1's profiles and cycle 2's audit_log.
   4. Exactly **two** policies:
      - `clubs_select_anyone` — `FOR SELECT USING (true)`. The display
        zone is not secret; every authenticated client reads it on every
        render call.
      - `clubs_update_manager` — `FOR UPDATE USING (auth.role_at_least('manager'))
        WITH CHECK (auth.role_at_least('manager'))`. Owners-and-managers
        can change the display zone (e.g., new location). NO INSERT
        POLICY (service-role seeds the single v1 row; future-cycle multi-
        club INSERT goes through a server-action behind manager+
        anyway). NO DELETE POLICY (the v1 club row is never deleted;
        deletion of a club is a destructive operation that requires its
        own ADR).
   5. Single-row seed: `INSERT INTO clubs (slug, display_tz) VALUES
      ('default', 'America/Chicago');`. Seeding inside the migration is
      acceptable here because (a) the data is configuration, not
      tenant-state, and (b) ADR-0008's environment promotion runs the
      same migrations against every environment, so the row exists
      identically everywhere.
   6. `ALTER TABLE profiles ADD COLUMN display_tz text NULL;`. **NULL
      means "use the club zone"** per ADR-0034 §"Schema additions" — no
      DEFAULT, no CHECK against an allowlist (same rationale as
      `clubs.display_tz`), no NOT NULL. Adding the column to an existing
      table in a separate migration (rather than amending cycle 1's
      `0002_profiles_and_roles.sql`) preserves the cycle-1 spec's
      "no other columns are added in this migration" invariant
      (`docs/specs/0003-authorization-rls-implementation.md` AC3).
   7. `COMMENT ON COLUMN clubs.display_tz` and `COMMENT ON COLUMN
      profiles.display_tz` pointing back to ADR-0034 and to the
      `lib/time/` helper module.

   No other statements. No CREATE INDEX (`clubs` is single-row in v1,
   so an index on `slug` would never be used; the UNIQUE constraint
   already gives Postgres a btree). No CREATE TRIGGER (no
   `set_updated_at` on `clubs` in v1 — adds clutter without value;
   future ADRs that mutate `clubs` rows operationally can add a
   trigger in the same change).

   Verified by `pnpm migrate:check` and
   `pnpm test tests/migrations/timestamp-policy-shape.test.ts`.

6. **Migration shape tests at `tests/migrations/timestamp-policy-shape.test.ts`**
   parse `0007_clubs_and_display_tz.sql` and assert structural
   properties in two fidelity tiers (matching the cycle 1 / cycle 2
   pattern):

   - **Regex / lexical tier:**
     - filename matches `/^0007_clubs_and_display_tz\.sql$/`;
     - `CREATE TABLE clubs` present with all 5 v1 column names (`id`,
       `slug`, `display_tz`, `created_at`, `updated_at`);
     - presence of the literal `'America/Chicago'` (single-quoted) as
       the `display_tz` default;
     - presence of `enable row level security` (case-insensitive) on
       `clubs` AND `force row level security`;
     - presence of policy names `clubs_select_anyone` and
       `clubs_update_manager`;
     - **absence** of any `for insert` or `for delete` policy on
       `clubs` (comment-stripped first);
     - presence of `alter table profiles add column display_tz text`
       (case-insensitive);
     - presence of the seed `INSERT INTO clubs` statement with the
       `'default'` slug and `'America/Chicago'` display_tz literals;
     - **absence** of any `not null` qualifier on the `profiles.display_tz`
       ALTER ADD COLUMN statement — the column is intentionally nullable
       (NULL = "use club zone" per ADR-0034).
   - **AST / parser-fidelity tier (`pg-query-emscripten`):**
     - `CreateStmt` for `clubs` exists with exactly 5 columns; the `id`
       column has a `Constraint` of type CONSTR_PRIMARY; the `slug`
       column has a `Constraint` of type CONSTR_UNIQUE.
     - `CreatePolicyStmt` × 2 with names `clubs_select_anyone` (cmd_name =
       'select') and `clubs_update_manager` (cmd_name = 'update'). NO
       `CreatePolicyStmt` with cmd_name 'insert' or 'delete' for relation
       `clubs`.
     - `InsertStmt` for relation `clubs` exists with two values: a
       string `'default'` and a string `'America/Chicago'` (or
       libpg_query's equivalent string-node representation).
     - `AlterTableStmt` for relation `profiles` exists with a
       `AT_AddColumn` subtype targeting a column named `display_tz`
       whose type is `text` and which has NO `CONSTR_NOTNULL` constraint
       in the column's `constraints` list. (Defends against a worker
       "helpfully" tightening to NOT NULL with a default — that would
       silently re-introduce the auto-detection ADR-0034 forbids.)
     - The `AlterTableStmt` MUST be a separate statement from the
       `CreateStmt clubs` — assert by walking the parsed statement list
       and confirming index-ordering (CREATE TABLE clubs first,
       INSERT INTO clubs middle, ALTER TABLE profiles last). Catches a
       worker who consolidated them in a way that breaks rollback order.

7. **pglite migration round-trip test at `tests/db/clubs-and-display-tz.test.ts`**
   applies the three migrations in order against a fresh pglite
   instance and asserts:

   - **`beforeAll`:** construct `new PGlite()`, run `setupAuthStub(pg)`
     (the cycle 1 fixture), apply `0002_profiles_and_roles.sql`, then
     `0003_audit_log.sql`, then `0007_clubs_and_display_tz.sql`. Seed
     a manager and a member via the cycle 1 `seedProfile` helper.
   - **Sub-cases:**
     1. **`clubs` single-row seed present:** under service-role read,
        `SELECT slug, display_tz FROM clubs` returns exactly one row
        `{ slug: 'default', display_tz: 'America/Chicago' }`.
     2. **`profiles.display_tz` exists and is nullable:** introspect
        `information_schema.columns` and assert column
        `display_tz` on table `profiles` has `data_type = 'text'`,
        `is_nullable = 'YES'`, `column_default IS NULL`.
     3. **SELECT-anyone on clubs:** authenticated member can SELECT the
        clubs row. Returns one row. (No PII concern — the display zone
        is operationally public.)
     4. **UPDATE-manager on clubs (positive):** manager authenticated
        UPDATE on `clubs.display_tz` to `'America/Los_Angeles'`
        succeeds (1 row affected). Wrap in `withRollback` from
        `tests/db/_fixtures/rls-helpers.ts` so the seed isn't disturbed.
     5. **UPDATE-member on clubs (negative):** member authenticated
        UPDATE on `clubs.display_tz` affects 0 rows (RLS USING filters
        the row out before the UPDATE engages — Postgres returns 0
        rows-affected; no SQLSTATE error). This is the documented RLS
        UPDATE-denial shape per cycle 1.
     6. **INSERT denied (no insert policy):** any authenticated caller
        (member or manager under `app_authenticated` NOBYPASSRLS)
        attempting `INSERT INTO clubs (slug, display_tz) VALUES (...)`
        raises SQLSTATE 42501. Service-role bypasses (separate sub-case).
     7. **DELETE denied (no delete policy):** same — 42501 under any
        authenticated role.
     8. **Member sets own `profiles.display_tz`:** member authenticated
        UPDATE on own `profiles.display_tz = 'America/New_York'`
        succeeds via the cycle 1 `profiles_update_self_or_manager`
        policy (the existing policy already permits self-update of
        non-role columns). Read-back under service-role confirms.
     9. **Member cannot set another member's `display_tz`:** member-A
        UPDATE of member-B's `profiles.display_tz` affects 0 rows
        (cross-tenant RLS filter, same as cycle 1 AC8 sub-case 2).
        Regression guard — the ADR-0034 addition does not weaken
        cycle 1's cross-tenant denial.

   Verified by `pnpm test tests/db/clubs-and-display-tz.test.ts` —
   listed explicitly in the frontmatter `acceptance_commands` since
   the file lives under `tests/db/` (vitest treats the path argument
   as a prefix filter, not a repo-wide glob; `pnpm test tests/time/`
   does NOT pick it up).

8. **SQL day-bucket lint at `scripts/lint/sql-day-bucket.ts` flags bare
   `date_trunc('day', x)` (no `at time zone`) inside the configured
   directory scope.** Per ADR-0034 §"Storage and database rules": the
   lint's scope is exactly `db/queries/reports/**` (declared at the top
   of the file as `const SCOPE = 'db/queries/reports/**'`). The lint
   takes a file path or directory and:

   - reads every `.sql` file under the scope;
   - strips line- and block-comments first (comments may legitimately
     mention the forbidden pattern, e.g. "DO NOT use `date_trunc('day',
     x)` without `at time zone`");
   - searches for the regex `/date_trunc\s*\(\s*'(day|hour|week|month)'\s*,\s*[^)]+\)/i`
     and, for each match, checks whether the match is **followed within
     the same SQL expression** by `at time zone <zone-literal>` —
     scanning the AST tier is overkill for v1 (the lint runs on every
     PR and SQL files are small); a textual check is sufficient if the
     match-window includes the next `\b(at\s+time\s+zone)\b` within ~80
     characters or the rest of the statement, whichever is closer;
   - emits a finding per occurrence with `{ file, line, col, expr,
     reason: 'date_trunc(day|hour|week|month, ...) without at time zone
     — ADR-0034 §Storage and database rules' }`.
   - the script exposes a CLI: `node scripts/lint/sql-day-bucket.mjs`
     (or the TS-compiled equivalent if the worker prefers `tsx`) exits 0
     when clean, 1 when findings, and prints the findings to stdout in
     the same format as `scripts/check-migration-safety.mjs`. CI wires
     it into the existing `lint` job in a later slice; **CI wiring is
     out of scope for this slice** — the script is shipped and tested
     here.

   Sub-cases (in `tests/lint/sql-day-bucket.test.ts`):
   1. **Clean:** a fixture SQL file under
      `tests/lint/_fixtures/sql/clean.sql` containing `date_trunc('day',
      x at time zone 'America/Chicago')` produces no findings.
   2. **Naked day bucket:** a fixture file containing `date_trunc('day',
      x)` produces exactly one finding pointing at that line.
   3. **Naked hour / week / month:** analogous fixtures for `'hour'`,
      `'week'`, `'month'` each produce findings — the lint catches all
      four bucket sizes, not just `'day'`.
   4. **Comment-stripped:** a fixture containing `-- DO NOT use
      date_trunc('day', x) without at time zone` produces no findings
      (the regex match is inside a stripped comment).
   5. **Block-comment-stripped:** analogous for `/* ... */` block
      comments.
   6. **Scope respected:** a fixture file at
      `tests/lint/_fixtures/sql/out-of-scope.sql` (NOT under the
      configured `db/queries/reports/**` glob — the test invokes the
      lint with the scope override pointing at the fixtures dir) is NOT
      scanned by default; only files matching the scope glob are
      visited. Run the lint twice — once with default scope (no
      findings), once with the fixture path explicitly added to scope
      (findings present). Asserts the scope filter is load-bearing.
   7. **`at time zone` in a different expression doesn't satisfy the
      next match:** a fixture containing
      `date_trunc('day', x); select y at time zone 'UTC';` produces a
      finding (the `at time zone` is in a sibling statement, not the
      same expression). Tight on the proximity heuristic.

   The lint MUST NOT be wired into `pnpm lint` (the package script) in
   this slice — that would require changing `package.json` and adding
   a script entry, both of which the planner may want to do in a
   harmonized way with the lint plugin for `withAudit` (deferred to
   ADR-0006 Slice 4). Shipping the lint script + tests now lets a
   later cycle wire CI without re-litigating the rule.

   Verified by `pnpm test tests/lint/` — the frontmatter command
   covers all tests under `tests/lint/`, including both
   `tests/lint/no-naked-date.test.ts` (AC4) and
   `tests/lint/sql-day-bucket.test.ts` (this AC).

9. **No CI integration for the SQL day-bucket lint in this slice.** AC8
   ships the script and its tests; CI wiring (adding a `pnpm
   lint:sql-day-bucket` script entry or a CI workflow step) is
   explicitly Out of scope (see Out of scope section). The frontmatter
   command `pnpm test tests/lint/` covers both
   `tests/lint/no-naked-date.test.ts` and
   `tests/lint/sql-day-bucket.test.ts` and is the sole gate for this
   slice.

10. **`pnpm migrate:check` passes** on the new `0007_clubs_and_display_tz.sql`
    with no findings. The migration is purely additive (CREATE TABLE +
    INSERT + ALTER TABLE ADD COLUMN, all on a fresh table / on an
    additive column) — no DROPs, no ALTER COLUMN, no destructive ops —
    so it passes without acknowledgement comments.

11. **`pnpm typecheck` passes** — including the new TypeScript in
    `lib/time/**`, the new fixture types in `tests/time/**`, and the
    new fixture-import surfaces in
    `tests/lint/_fixtures/**`. `tsc --noEmit` over the repo must be
    green with these additions.

12. **`pnpm lint` passes** — after the new ESLint rule lands AND task
    t0 migrates the 5 known violation sites listed below to `nowUtc()`,
    `pnpm lint` runs zero `no-restricted-syntax` violations across the
    repo. The repo audit performed during spec authorship found five
    bare-Date call sites outside `lib/time/`, `tests/**`, and
    `scripts/**`; t0 migrates all five in this slice:

    - `app/sitemap.ts:9` — `const now = new Date();` → `const now = nowUtc();`
    - `app/api/health/route.ts:13` — `new Date().toISOString()` →
      `nowUtc().toISOString()`
    - `lib/analytics/driver.ts:39` — `ts: Date.now()` → `ts: nowUtc().getTime()`
    - `lib/analytics/driver.ts:43` — `ts: Date.now()` → `ts: nowUtc().getTime()`
    - `lib/observability/log.ts:28` — `ts: new Date().toISOString()` →
      `ts: nowUtc().toISOString()`
    - `lib/rate-limit/middleware.ts:63` — `nowMs: number = Date.now()` →
      `nowMs: number = nowUtc().getTime()` (parameter default — preserve
      the injectable test-seam shape; the function still accepts an
      explicit `nowMs` argument for deterministic test runs).

    Each migrated file imports `nowUtc` from `@/lib/time` (or
    `../time/now` etc., per the import-alias conventions already in
    use at each site). The `lib/time/**`, `tests/**`, and `scripts/**`
    paths are excluded via the `overrides` mechanism per AC4.

13. **`pnpm test scripts/conductor/` continues to pass** — no conductor
    regression.

14. **Cycle 1 / cycle 2 regression — zero edits, zero failures:**
    `pnpm test tests/db/rls-profiles.test.ts`,
    `pnpm test tests/migrations/profiles-shape.test.ts`,
    `pnpm test tests/db/audit-log.test.ts`,
    `pnpm test tests/migrations/audit-log-shape.test.ts`,
    `pnpm test tests/audit/with-audit.test.ts` MUST continue to pass
    without modification. The ADR-0034 migration is purely additive
    (new `clubs` table + new `profiles.display_tz` column); cycle 1's
    `seedProfile` is column-permissive (t7 in cycle 1's spec) so the
    new column flows through as an optional override without breaking
    a sub-case. The fixture's `ProfileRow` type widens; the defaults
    stay v1. If any cycle 1 / cycle 2 test needs editing to accommodate
    cycle ADR-0034, that is a fidelity fail — flag it and re-scope
    before shipping.

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Tests-first preferred
where feasible — the lib/time/ unit tests can be authored against the
type signatures before the helper code lands.

- **t0 — Audit and migrate the 5 known bare-Date violation sites to
  `nowUtc()` before installing the ESLint rule.** Spec-authorship audit
  found exactly five bare-Date call sites outside the override globs
  (`lib/time/**`, `tests/**`, `scripts/**`). t0 migrates each, in this
  order, so the rule installed by t6 lints a clean repo:

  1. `app/sitemap.ts:9` — replace `const now = new Date();` with
     `const now = nowUtc();`. Add `import { nowUtc } from '@/lib/time';`.
  2. `app/api/health/route.ts:13` — replace `new Date().toISOString()`
     with `nowUtc().toISOString()`. Add the import.
  3. `lib/analytics/driver.ts:39` and `:43` — replace both
     `ts: Date.now()` literals with `ts: nowUtc().getTime()`. Add the
     import (`import { nowUtc } from '../time';` per the directory's
     existing relative-import style).
  4. `lib/observability/log.ts:28` — replace
     `ts: new Date().toISOString()` with `ts: nowUtc().toISOString()`.
     Add the import.
  5. `lib/rate-limit/middleware.ts:63` — replace the parameter default
     `nowMs: number = Date.now()` with
     `nowMs: number = nowUtc().getTime()`. **Do not remove the
     parameter** — it is the injectable test-seam the slice 1
     rate-limit tests depend on; only the default expression changes.
     Add the import.

  After the migration, re-grep for `new Date(\s*)` and `Date\.now\(\)`
  across the repo excluding `node_modules`, `_design/**`, `tests/**`,
  and `scripts/**` to confirm zero residual findings. If t0 surfaces
  additional findings beyond the named five (e.g. a new file landed in
  another concurrent branch), migrate those too and flag in the
  dispatch summary so the curator can update the Iteration history.

  **t0 depends on t1 having authored `lib/time/now.ts`** — the worker
  may interleave t0 and t1 (author the helper first, then migrate),
  but t0 must be complete before t6 installs the ESLint rule.
  Workers MUST NOT add `eslint-disable` comments at any of the five
  sites; the migration to `nowUtc()` is mechanical and the test seam
  in (5) is preserved by the `.getTime()` shape.

- **t1 — `lib/time/` module: helpers + types + brands.** Per AC1 and
  AC3. Author each of the five files. Pure TypeScript — no runtime
  dependencies beyond `Intl.DateTimeFormat` (Node 20.11+ has full
  IANA tzdata bundled). Validate with `pnpm typecheck`.

- **t2 — `lib/time/` unit tests.** Per AC2 and AC3. Five test files
  under `tests/time/`. Each uses `vi.useFakeTimers()` +
  `vi.setSystemTime(new Date(<literal>))` to pin the wall-clock,
  exercises the helper, then `vi.useRealTimers()` in `afterEach`. The
  spring-forward and fall-back fixtures are the load-bearing
  sub-cases; everything else is type-shape and trivial-case coverage.

- **t3 — Migration: `0007_clubs_and_display_tz.sql`.** Per AC5. In
  order: CREATE TABLE clubs, CHECK constraint on display_tz, RLS
  enable + force, two policies, single-row INSERT seed, ALTER TABLE
  profiles ADD COLUMN display_tz, COMMENT ON COLUMN × 2. Validate
  with `pnpm migrate:check`.

- **t4 — Migration shape test:
  `tests/migrations/timestamp-policy-shape.test.ts`.** Per AC6. Two
  tiers (regex + AST). Copy-and-adapt from
  `tests/migrations/audit-log-shape.test.ts`.

- **t5 — pglite migration round-trip:
  `tests/db/clubs-and-display-tz.test.ts`.** Per AC7. Reuses cycle 1
  / cycle 2 fixtures (`auth-stub.ts`, `profiles.ts`, `rls-helpers.ts`).
  Nine sub-cases.

- **t6 — ESLint rule for `no-restricted-syntax`.** Per AC4. Extend
  `.eslintrc.json` with the two AST selectors and the
  `overrides`-based path exclusion. Authored as JSON, not TypeScript —
  the existing repo config is JSON. Validate with `pnpm lint` (entire
  repo must be clean) and the fixture-driven unit tests in
  `tests/lint/no-naked-date.test.ts`.

- **t7 — Lint-rule fixtures + unit tests:
  `tests/lint/no-naked-date.test.ts` and the five
  `tests/lint/_fixtures/uses-*.ts` / `_fixtures/.../naked-allowed.ts.skip`
  files.** Per AC4. The test invokes ESLint programmatically via
  `new ESLint({ ... }).lintFiles([fixturePath])` and asserts
  `result[0].messages[0].ruleId === 'no-restricted-syntax'` for the
  failing cases. The `.skip` suffix is significant: tsc and the
  ambient vitest glob both ignore it; the test reads it as raw text
  and writes a tmp file under `lib/time/` to verify the override
  glob.

- **t8 — SQL day-bucket lint script:
  `scripts/lint/sql-day-bucket.ts`.** Per AC8. Reads SQL files,
  strips comments, scans for naked `date_trunc('day'|'hour'|'week'|'month',
  ...)`. CLI entrypoint with exit code 0/1. Mirrors
  `scripts/check-migration-safety.mjs` in style (ESM, no deps beyond
  `node:fs` / `node:path`).

- **t9 — SQL day-bucket lint tests:
  `tests/lint/sql-day-bucket.test.ts`** with seven sub-cases per AC8.
  Fixtures under `tests/lint/_fixtures/sql/`.

- **t10 — Final gauntlet pass.** Run all 11 acceptance commands in
  order. Confirm cycle 1 / cycle 2 tests still pass (AC14
  regression). Capture any fidelity findings (e.g. pglite returning
  slightly different metadata for the seed INSERT than expected, or
  `Intl.DateTimeFormat` producing slightly different short-zone
  abbreviations on the host's Node version) and surface them in the
  dispatch summary so the curator can update the
  `docs/kb/timestamps.md` KB (lift to be authored in this cycle's
  retrospective phase).

## Touched-files inventory

Best estimate; workers may exceed if needed.

- **Create:** `lib/time/index.ts`
- **Create:** `lib/time/now.ts`
- **Create:** `lib/time/zones.ts`
- **Create:** `lib/time/display.ts`
- **Create:** `lib/time/categories.ts`
- **Create:** `lib/time/audit-render.ts`
- **Create:** `tests/time/now.test.ts`
- **Create:** `tests/time/display.test.ts`
- **Create:** `tests/time/zones.test.ts`
- **Create:** `tests/time/audit-render.test.ts`
- **Create:** `tests/time/categories.test.ts`
- **Create:** `tests/time/index.test.ts` (export-shape snapshot)
- **Create (optional):** `tests/time/categories.type-fixture.ts.skip`
  (negative-typecheck fixture; see AC2)
- **Create:** `supabase/migrations/0007_clubs_and_display_tz.sql`
- **Create:** `tests/migrations/timestamp-policy-shape.test.ts`
- **Create:** `tests/db/clubs-and-display-tz.test.ts`
- **Create:** `tests/lint/no-naked-date.test.ts`
- **Create:** `tests/lint/_fixtures/uses-now-utc.ts`
- **Create:** `tests/lint/_fixtures/uses-naked-new-date.ts`
- **Create:** `tests/lint/_fixtures/uses-naked-date-now.ts`
- **Create:** `tests/lint/_fixtures/uses-date-with-arg.ts`
- **Create:** `tests/lint/_fixtures/naked-allowed-template.ts.skip`
  (text-only template, copied to a `lib/time/` tmp path at test time)
- **Create:** `scripts/lint/sql-day-bucket.ts` (or `.mjs` — planner
  picks based on whether the existing migration scanner pattern is
  followed verbatim)
- **Create:** `tests/lint/sql-day-bucket.test.ts`
- **Create:** `tests/lint/_fixtures/sql/clean.sql`
- **Create:** `tests/lint/_fixtures/sql/naked-day.sql`
- **Create:** `tests/lint/_fixtures/sql/naked-hour.sql`
- **Create:** `tests/lint/_fixtures/sql/comment-stripped.sql`
- **Create:** `tests/lint/_fixtures/sql/block-comment-stripped.sql`
- **Create:** `tests/lint/_fixtures/sql/out-of-scope.sql`
- **Create:** `tests/lint/_fixtures/sql/at-time-zone-in-sibling.sql`
- **Modify:** `.eslintrc.json` — add the two `no-restricted-syntax`
  AST selectors under `rules`, add an `overrides` entry that disables
  the rule for `lib/time/**/*.ts`, `tests/**/*.ts`, and
  `scripts/**/*.{ts,mjs,js}`.
- **Modify (t0 — bare-Date migration):** `app/sitemap.ts` — replace
  `new Date()` at line 9 with `nowUtc()`; add `nowUtc` import from
  `@/lib/time`.
- **Modify (t0 — bare-Date migration):** `app/api/health/route.ts` —
  replace `new Date().toISOString()` at line 13 with
  `nowUtc().toISOString()`; add the import.
- **Modify (t0 — bare-Date migration):** `lib/analytics/driver.ts` —
  replace `Date.now()` at lines 39 and 43 with `nowUtc().getTime()`;
  add the import.
- **Modify (t0 — bare-Date migration):** `lib/observability/log.ts` —
  replace `new Date().toISOString()` at line 28 with
  `nowUtc().toISOString()`; add the import.
- **Modify (t0 — bare-Date migration):** `lib/rate-limit/middleware.ts`
  — replace the parameter default `nowMs: number = Date.now()` at
  line 63 with `nowMs: number = nowUtc().getTime()`; add the import.
  Preserve the parameter (injectable test seam).
- **Modify:** `tests/db/_fixtures/profiles.ts` — widen `ProfileRow` to
  include the optional `display_tz: string | null` field; defaults
  stay `null` so cycle 1 / cycle 2 sub-cases continue passing
  unchanged. (Per cycle 1 spec t7 — the column-permissive constraint
  is precisely for this.)
- **Modify:** `docs/kb/timestamps.md` (curator-owned post-cycle; not
  in worker scope unless lessons surface during t1/t2/t5).
- **Modify:** none for `package.json` — no new devDependencies; the
  existing pglite + pg-query-emscripten + vitest + eslint suffice.

If the planner determines that an additional ambient `.d.ts` file is
needed (e.g., for a brand-type discriminator pattern that tsc complains
about), that file is in scope. The principle: anything required to run
the acceptance commands deterministically is in scope; anything that
touches user-facing UI is not (UI consumes the substrate in later
cycles).

## Risk flags

This is the project's medium-risk auto-flag list — Phase 1 may
auto-trigger `premortem(mode=task)` on this spec; the planner decides
at t0.

- **0034 (this ADR — timestamp policy) — wide blast radius:** every
  dated row in the app is governed by this policy. A bug class to
  actively defend against: a `new Date()` or `Date.now()` call site
  that escapes the ESLint rule via an `eslint-disable-next-line`
  comment and silently re-introduces wall-clock-now from the host
  process. Mitigation: the rule fires repo-wide; the `overrides`
  exclusion is path-based, not comment-based; a worker who needs to
  disable the rule inline must add a comment that surfaces in code
  review.
- **0018 (database migrations) — template amendment owed:** ADR-0034
  §"Cross-ADR amendments" commits to amending ADR-0018's migration
  template to default `timestamptz` and to ban `timestamp without
  time zone` via CI. This slice does NOT amend the template — that's
  an ADR-0018 cycle, not an ADR-0034 cycle. What this slice DOES
  ship: the `0007_clubs_and_display_tz.sql` migration uses
  `timestamptz` for `created_at` / `updated_at` on `clubs`, matching
  the (future) template. A worker who adds `timestamp` (no tz) for
  any new column in this slice has broken the policy before it ships.
  AC6's regex/AST assertions catch this for the new migration.
- **0008 (environments) — deployment-hygiene amendment owed:** ADR-0034
  §"Cross-ADR amendments" commits to amending ADR-0008's checklist to
  add (a) Stripe account TZ = UTC verification on every promotion,
  (b) Postgres image tzdata version pinning, (c) DB session TZ = UTC
  verification. This slice does NOT amend ADR-0008 — that's an
  ADR-0008 cycle. The substrate this slice ships (`lib/time/`,
  `clubs.display_tz`, the lint scripts) is sufficient for the
  deployment-hygiene checklist to be authored without further
  schema changes when the ADR-0008 cycle runs.
- **0006 (audit log) — presentation-helper consumer downstream:** the
  `formatAuditRowDualZone` helper this slice ships is consumed by
  the audit viewer in ADR-0006 Slice 4 (cycle TBD). The contract is
  pinned in AC3; the viewer cycle writes JSX over the helper's
  output and does NOT re-derive the DST-banner logic. A worker who
  decides "the viewer will format its own timestamps" has duplicated
  the rule surface and the next DST change will require two diffs.
- **0012 (tournaments) — `tz_name` companion column downstream:** the
  category-2 `wallClockIntent` brand this slice ships has no DB
  write path yet. ADR-0012 Slice 3 adds `tournaments.starts_at`'s
  `tz_name` column and the admin schedule UI. A worker who, while
  building this slice, "helpfully" adds the column to a `tournaments`
  table is stealing scope from ADR-0012's cycle and introducing
  schema before its consumer exists. AC5's "no other statements" guard
  on the migration catches this.
- **0023 (privacy / GDPR) — `profiles.display_tz` is PII-adjacent:**
  the per-member display_tz override is member-set, member-readable,
  and may correlate to physical location. ADR-0023's anonymization
  model (cycle 6) MUST include `display_tz` in the `del:<hash>`
  replacement scheme — the column is on `profiles`, so it inherits
  whatever profile-anonymization ADR-0023 ships. This slice does
  NOT implement the anonymization; it only ensures the column is
  nullable so a future anonymization can set it to NULL without a
  constraint violation.
- **`Intl.DateTimeFormat` tzdata vs Postgres tzdata divergence
  (premortem-risk-10, residual):** ADR-0034 commits conversion to
  one tier (the DB). The `lib/time/display.ts` helper uses
  `Intl.DateTimeFormat({ timeZone })` for member-facing render of
  already-fetched UTC instants — that's a Node-runtime tzdata
  dependency. The audit-log presentation contract explicitly routes
  through Postgres (pre-formatted columns), so the audit surface is
  insulated. **The render surface is not.** Mitigation: production
  deployment pins the Node runtime version per Vercel deployment
  config (existing); the helper is small and easy to swap to a
  Postgres-pre-formatted string column if a future tzdata divergence
  forces it.
- **ESLint AST selector brittleness:** the `NewExpression[callee.name='Date'][arguments.length=0]`
  selector is tied to ESLint's espree AST node shape. A future ESLint
  major version that changes node names (e.g. `Identifier` →
  `JSXIdentifier` for the callee in some contexts) would break the
  rule silently. Mitigation: AC4 sub-cases 2 and 3 are explicit
  regression tests — they MUST fire when expected; if they stop
  firing after an ESLint upgrade, that's a load-bearing signal, not
  a flaky test.
- **Pglite vs production-Supabase fidelity gap (continued from cycle
  1 / cycle 2):** ditto cycle 1's documented gap. AC7's sub-cases
  rely on the existing `auth-stub.ts` / `set_test_uid` semantics.
  ADR-0008 / Slice 4 CI integration re-validates against real
  Supabase.
- **`process.env.TZ` of CI runners:** `lib/time/display.ts` and
  `formatAuditRowDualZone` MUST be invariant to the host's `TZ` env
  var (AC2 sub-case 2.4 asserts this). CI runners typically run UTC;
  a developer machine in CT could mask a bug where the helper
  silently uses the host TZ. The sub-case forces the test to set
  `process.env.TZ` explicitly to confirm invariance.

## Out of scope

What this slice deliberately does **not** do. Each item is bound to a
future ADR cycle.

- **Admin audit-log viewer UI (`/admin/audit`).** Per ADR-0006
  Slice 4. The `formatAuditRowDualZone` helper this slice ships is
  the v1 contract the viewer consumes. Routes, filters, search,
  pagination, the DST-seam banner JSX — none of it ships in this
  cycle.
- **`tournaments.starts_at` + `tz_name` companion column.** Per
  ADR-0012 Slice 3 (registration-with-entry-fees). The
  `wallClockIntent` brand ships in `lib/time/categories.ts` now so
  the type contract exists when the column lands; the DB schema does
  not change in this slice. Slice 1's read-only `/games` listing
  renders existing one-off near-term rows (none ship in this slice
  either — the listing has nothing to display until ADR-0012's data
  arrives).
- **In-app member-override surface (`/profile` "Display timezone"
  setting).** The DB column ships in this slice. The settings UI
  that lets a member set their preference ships in the cycle that
  builds the member profile page (most likely ADR-0023 cycle 6 or a
  dedicated ADR — the route map's `/profile` is currently
  unattributed for the timezone surface specifically). v1 in-app UI
  is club-zone for every member until that cycle ships; AC7 sub-case
  8 confirms the DB write path works, but no UI consumes it yet.
- **Email / SMS render helpers using club-zone.** ADR-0034 §"Presentation
  rules" commits that emails (Resend, ADR-0025) and SMS (Twilio,
  ADR-0025) always render club-zone, never member-zone. The
  `formatInZone()` helper this slice ships is the surface those
  cycles consume; the actual email/SMS templates ship with ADR-0025.
- **CI integration of `pnpm lint:sql-day-bucket`.** AC9 explicitly
  defers this. The lint script is shipped + tested; wiring it into
  `pnpm lint` / CI is harmonized with future lint additions
  (`audit-policy` lint per ADR-0006 Slice 4, etc.) in a single
  later cycle.
- **ADR-0018 migration template amendment.** ADR-0034's commitment
  is to amend the template; the amendment itself is an ADR-0018
  cycle (or a doc-only change owned by the conductor). This slice
  consumes the future template by example — its migration uses
  `timestamptz` defaults — but does not edit
  `docs/adr/0018-database-migrations.md` or the template file.
- **ADR-0008 deployment-hygiene checklist amendment.** Same as
  above — ADR-0034's commitment, but the amendment lands in an
  ADR-0008 cycle. The substrate (helpers, columns, lint) this slice
  ships is sufficient for ADR-0008's amendment to be authored
  without further schema or code changes.
- **Postgres database-level `SET timezone = 'UTC'` enforcement at
  the role level.** ADR-0034 commits the database session TZ is set
  to UTC at the role level. The Supabase-managed role configuration
  is owned by ADR-0008's environments cycle; this slice does NOT
  ship a `ALTER ROLE ... SET timezone = 'UTC';` migration because
  the Supabase platform manages the connection-pool defaults and
  the role configuration is out-of-band of the application's
  migration stream. AC8's day-bucket lint is the in-application
  defense against the latent-bug surface ADR-0034 §premortem-risk-4
  flags.
- **Stripe account timezone audit.** ADR-0034 names Stripe
  account TZ = UTC as a deployment dependency. The actual audit
  is an ADR-0008 environments-promotion checklist item; ADR-0034's
  policy commitment is documented, not executed.
- **Real-Supabase integration tests.** Continues cycle 1 / cycle 2's
  posture — pglite is the test substrate; CI integration with a
  real Supabase project lands in Slice 4 once API keys are available.
- **Recurring-event series templates (RRULE + TZID).** ADR-0034
  falsifier-1 defers this. Recurring tournaments and the RRULE
  column ship in their own future ADR if and when "every Tuesday
  at 7 PM forever" surfaces as a real product need.
- **Three-column audit-log presentation (UTC + club-zone +
  actor-zone).** ADR-0034 falsifier-3 defers this. v1 audit
  reconstruction uses UTC + club-zone; if a cross-jurisdiction
  dispute arises, ADR-0006 is amended to add `actor_tz`. The
  `formatAuditRowDualZone` helper signature does NOT include an
  `actorZone` parameter for forward-compatibility — adding a third
  zone column changes the JSX layout, and pretending the helper
  supports it now would be misleading.
- **`audit-policy` ESLint rule.** Per ADR-0006 Slice 4. Out for the
  same reason as above — the rule fires on writes to
  audit-required tables outside `withAudit`, which is an ADR-0006
  concern, not ADR-0034.
- **A `lib/time/parse.ts` for parsing user-input wall-clock strings
  in a chosen zone (i.e. the `fromClubTzInput(input)` helper named
  in the conductor dispatch).** The admin tournament-schedule UI
  (ADR-0012 Slice 3) is the first consumer of this helper. Shipping
  the parser now without a consumer means writing a contract no
  test exercises end-to-end; the helper lands in the same cycle as
  its first consumer. The `categories.ts` brand for
  `wallClockIntent` ships now (the type contract is the load-bearing
  part); the parser does not.
- **Member-facing receipts / GDPR/CCPA SLA-clock confirmations
  renderer extension.** ADR-0034 falsifier-2 defers this. v1 ships
  club-zone for these surfaces; cross-jurisdictional billing /
  compliance render is reconsidered if counsel or a regulator
  requires it.

## Open questions

Surfaced for resolution during planning. **Defaults are the spec
author's recommendation; the planner confirms before t-zero.**

1. **Repo audit at t0 — is the repo currently clean of bare
   `new Date()` / `Date.now()`?** Default: **no — five named files
   contain bare `new Date()` / `Date.now()` outside the override
   globs**: `app/sitemap.ts`, `app/api/health/route.ts`,
   `lib/analytics/driver.ts` (two sites), `lib/observability/log.ts`,
   `lib/rate-limit/middleware.ts`. Task t0 migrates all five to
   `nowUtc()` (or `nowUtc().getTime()` for the rate-limit middleware's
   numeric parameter default) as part of substrate landing — see AC12
   and t0's per-file decomposition. Action: planner re-runs the grep
   at t0 to confirm the five sites are the only findings; if
   additional sites have appeared on `main` since spec authorship,
   migrate those too and surface in the dispatch summary.

2. **`lib/time/categories.ts` type-level vs runtime brand enforcement.**
   Default: ship a TypeScript-only brand (`type Moment = Date & { readonly
   __brand: 'Moment' }`) — no runtime discriminator. The brand
   prevents accidental cross-category arithmetic at compile time and
   adds zero runtime cost. **Alternative:** add a runtime
   discriminator object (`{ kind: 'moment', value: Date }`) — heavier
   but defends against `as` casts at call sites. Default: **TypeScript
   brand**. The planner overrides if a sub-case in AC2 fails to
   express the load-bearing "the four categories are not
   interchangeable" property under the type-only brand — that
   triggers the runtime fallback.

3. **CLI shape of `scripts/lint/sql-day-bucket.ts` — TS-compiled or
   `.mjs`?** Default: ship as `.mjs` to match
   `scripts/check-migration-safety.mjs`. **Alternative:** ship as
   `.ts` and run via `tsx` (already a transitive dep via vitest).
   Default: **`.mjs`**. Tradeoff: `.ts` gives the script better type
   checks for free; `.mjs` matches the existing convention and
   doesn't need an entry in `package.json` to run. The planner
   picks based on whether it wants to migrate the existing
   `.mjs` scripts to `.ts` in the same change (lower-priority
   refactor — not in scope here).

4. **Should `lib/time/audit-render.ts` ship in this slice or wait for
   ADR-0006 Slice 4?** Default: ship now. Rationale: the audit
   viewer cycle inherits a pinned contract instead of designing one.
   The marginal cost is small — the helper is ~50 lines of pure
   TypeScript — and pinning the DST-banner logic now means the
   viewer's JSX is the only thing the viewer cycle writes. **Default:
   ship now.** The planner can defer if it judges the viewer cycle
   has materially different requirements (unlikely given the
   ADR-0034 contract is explicit).

5. **Naming: `nowUtc()` vs `now()`.** Default: `nowUtc()`. Rationale:
   the helper's name documents its contract — it returns a
   UTC-anchored Date — and no plausible future helper will be named
   `now()` without a zone tag. The slight verbosity (`nowUtc()` vs
   `now()`) is a feature, not a bug — it discourages a future
   contributor from importing it as "the way to get the current
   time" without thinking about the zone. **Default: `nowUtc`**.

## Iteration history

- **Revision 1 (2026-05-11):** initial spec authored. No prior critic
  concerns (the 7 critic concerns at `.conductor/0034/critic-concerns.md`
  pertain to the ratification proposal of the ADR itself, not this
  implementation spec — those concerns are already addressed in the
  Accepted ADR text per the conductor dispatch envelope). 14
  acceptance criteria covering the helper module, the schema
  additions, the two lint scripts, and cycle 1 / cycle 2 regression.
  10 task cuts (t0 audit, t1 helpers, t2 helper tests, t3 migration,
  t4 migration shape test, t5 pglite round-trip, t6 ESLint rule, t7
  lint-rule unit tests, t8 SQL day-bucket lint script, t9 SQL lint
  unit tests, t10 final gauntlet). 5 open questions, all with
  defaults. Reuses cycle 1 / cycle 2 fixtures wholesale (auth-stub,
  rls-helpers, column-permissive profiles fixture). Defers UI,
  CI wiring, ADR-0018 + ADR-0008 amendments, and the `tz_name`
  companion column to their owning future cycles.

- **Revision 2 (2026-05-11):** addresses two critic concerns from
  `.conductor/0034/dispatches/0008-critic-spec.md`.
  (1) Frontmatter `acceptance_commands` widened to cover the tests AC7,
  AC8, and AC14 commit to shipping — `pnpm test tests/migrations/`
  replaces the single-file migration command, `pnpm test tests/lint/`
  replaces the single-file lint command (covers both
  `no-naked-date.test.ts` and `sql-day-bucket.test.ts`), and explicit
  per-file commands added for `tests/db/clubs-and-display-tz.test.ts`,
  `tests/db/rls-profiles.test.ts`, `tests/db/audit-log.test.ts`, and
  `tests/audit/with-audit.test.ts`.
  AC7's incorrect "vitest matches both directories" claim and AC8's
  incorrect "tests/lint/ glob" claim were corrected.
  (2) Spec-authorship audit re-run found five bare-Date violation
  sites outside the override globs: `app/sitemap.ts:9`,
  `app/api/health/route.ts:13`, `lib/analytics/driver.ts:39+43`,
  `lib/observability/log.ts:28`, `lib/rate-limit/middleware.ts:63`.
  Open Question #1 default flipped from "clean / t0 no-op" to "five
  sites; t0 migrates each." AC12 narrative updated to commit to the
  migration in this slice with per-file specifics (including the
  `nowUtc().getTime()` shape for the rate-limit parameter-default
  case that preserves the injectable test seam). t0 task decomposition
  rewritten with per-file migration steps. Touched-files inventory
  adds 5 `Modify` entries for the bare-Date sites. No other AC or
  scope changes.
