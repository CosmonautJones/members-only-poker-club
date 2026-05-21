---
name: timestamps-utc
description: Use when writing or reviewing code that touches dates, times, timezones, or date arithmetic. Triggers on `new Date()`, `Date.now()`, `Intl.DateTimeFormat`, `at time zone`, `date_trunc`, `timestamptz`/`timestamp without time zone` column types, `nowUtc()`, `formatInZone()`, IANA zone strings, DST seam handling, ESLint no-restricted-syntax violations on Date-now, or "today's report drifted by hours" debugging. Critical for migration authors, query authors, and audit-render consumers.
---

# timestamps-utc — ADR-0034 timestamp + timezone discipline

ADR-0034 is the single-source-of-truth policy: storage in UTC `timestamptz`, presentation in club-local time via the `lib/time/` helpers. Load this skill before any code that creates, formats, or buckets a timestamp.

## The headline rules

1. **`nowUtc()` is the ONLY sanctioned wall-clock-now caller.** Not `new Date()`, not `Date.now()`. Enforced by ESLint `no-restricted-syntax` rule (`NewExpression[callee.name='Date'][arguments.length=0]` and `CallExpression[callee.object.name='Date'][callee.property.name='now']`).
2. **Exceptions are by directory only, not by file.** `lib/time/**/*.ts` (implements itself), `tests/**/*.ts` (constructs literal instants), `scripts/**/*.{ts,mjs,js}` (build/migration scripts). Everywhere else: `nowUtc()`.
3. **`new Date(<iso-string>)` and `new Date(<utc-millis>)` are ALLOWED everywhere.** The lint targets only the zero-argument form (`new Date()` = wall-clock-now). Deterministic constructors that parse a known instant are not wall-clock references.
4. **Storage is always `timestamptz` (UTC).** Never `timestamp without time zone`. CI gate forbids the latter in migrations.
5. **Presentation goes through `formatInZone(d, zone, opts?)` or `formatAuditRowDualZone(utc, clubZone)`.** Direct `Intl.DateTimeFormat({ timeZone })` calls outside `lib/time/` are forbidden.

## The day-bucket SQL lint

`date_trunc('day' | 'hour' | 'week' | 'month', x)` without an explicit `at time zone <zone>` clause produces UTC day buckets, NOT club-local buckets. A "today's redemptions" report computed in UTC drifts by up to 6 hours from the America/Chicago day boundary — evening transactions silently mis-attributed.

`scripts/lint/sql-day-bucket.mjs` enforces this under `db/queries/reports/**`. The `at time zone` clause must appear within ~80 chars of the `date_trunc` match, OR before the next `;`. Day, hour, week, AND month buckets are all gated.

Out-of-scope queries (ad-hoc analytics, internal debug, migrations) are exempted by directory placement, NOT by prose. Callable as a library via `lintSqlDayBucket({ scope?, files? })`.

## ICU portability quirks (Node 22 Windows)

Two known platform divergences in `Intl.DateTimeFormat`:

- **`'CST'` and `'America/chicago'` (lowercase) don't throw.** Node 22 silently aliases them to `'America/Chicago'`. The cheap "did the constructor throw" predicate inside `isValidIanaZone()` is looser than the spec assumed. Tests for these zones use a `FIDELITY GAP` describe block. To tighten: compare `Intl.DateTimeFormat({ timeZone: input }).resolvedOptions().timeZone` against the input and reject mismatch.
- **`timeZoneName: 'short'` for non-CT zones returns `'GMT+1'` instead of `'BST'` on Node 22 Windows.** Older Node versions and other OS hosts may produce `'BST'` or `'GMT+01:00'`. Tests asserting short-zone abbreviations across non-Chicago zones use a regex like `/BST|GMT\+1|GMT\+01:00/`. The `looksDaylight()` heuristic inside `audit-render.ts` correctly handles all variants for the DST-seam invariant — but DON'T pattern-match on `'BST'` literally in downstream consumer code.

## DST-seam handling (America/Chicago specifics for 2026)

- **Spring-forward:** 2026-03-08 02:00 wall-clock jumps to 03:00 CDT. The hour 02:00–03:00 wall-clock DOES NOT EXIST. `formatInZone(2026-03-08T07:59Z, 'America/Chicago')` → `01:59 CST`. `formatInZone(2026-03-08T08:00Z, 'America/Chicago')` → `03:00 CDT`. The seam is SKIPPED, not interpolated.
- **Fall-back:** 2026-11-01 02:00 wall-clock falls back to 01:00 CST (the 01:00 hour repeats). `formatInZone(2026-11-01T06:30Z, ...)` and `formatInZone(2026-11-01T07:30Z, ...)` BOTH return `01:30` (ambiguous wall-clock — different UTC instants, same render string).
- **The `dstSeam` field on `formatAuditRowDualZone()` exists to disambiguate this case.** It fires `'spring-forward'` or `'fall-back'` within the 1-hour UTC window around each transition.

## Test discipline for time helpers

Every time-related test:
- Uses `vi.useFakeTimers()` + `vi.setSystemTime(new Date(<literal>))` to pin the test's notion of "now".
- Asserts invariance under `process.env.TZ` (set to `'UTC'` and `'America/Los_Angeles'` and re-run; output should be identical).
- Tests at least one spring-forward instant, one fall-back instant, and one non-DST instant.
- For `audit-render.test.ts`: test all 8 sub-cases (mid-summer, mid-winter, spring-forward seam, fall-back seam, outside-window, both fall-back repeats, non-CT zone).

The literal `new Date(<iso-literal>)` is permitted inside `tests/**/*.ts` per AC4's lint exception clause.

## Postgres `timestamptz` semantics (read this once)

- `timestamptz` stores values as UTC microseconds-since-epoch, period. There is no "stored timezone" — the timezone in the source literal is used to compute UTC, then discarded.
- `date_trunc('day', some_timestamptz)` operates in **session timezone** (which we pin to UTC). Without `at time zone <zone>`, you get UTC day buckets. With it, you get club-local day buckets. This is why the lint exists.
- The session timezone is pinned to UTC in production via `0001_session_timezone_utc.sql` (or equivalent) — DO NOT rely on the OS timezone of the Postgres host.

## Vendor moment categories

Four declared timestamp categories (ADR-0034 §"Categories"):

| Category | Wrapper | Storage | Use case |
|---|---|---|---|
| 1 — Moment | `momentUtc(d)` | `timestamptz` | Audit `created_at`, observation instants |
| 2 — Wall-clock intent | `wallClockIntent(utc, tz)` | `timestamptz` + `tz_name` column | Future scheduled events ("Tournament at 7pm Chicago time") |
| 3 — Vendor moment | `vendorMoment(d, vendorTz?)` | `timestamptz` | Stripe webhook timestamps, external API instants |
| 4 — Jurisdictional date | `jurisdictionalDate(d, juris)` | `date` (no time) | Tax dates, compliance windows — no instant |

The four are TypeScript-branded so they don't unify under `tsc --noEmit`. Mixing them is a type error, not a runtime check.

## Cited evidence

- ADR-0034 Slice 1 — single-source-of-truth helper, ESLint rule, day-bucket lint, audit-render contract
- ADR-0034 cycle 3 — Node 22 ICU aliasing of `'CST'` and case-insensitive zone names
- ADR-0034 cycle 3 — `BST` vs `GMT+1` abbreviation portability on Node 22 Windows
- ADR-0034 Open Q5 — `nowUtc()` naming (deliberate friction over `now()`)
- ADR-0034 §"Storage and database rules" — bare `date_trunc` forbidden under `db/queries/reports/**`
