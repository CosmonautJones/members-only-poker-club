# ADR-0034: Timestamp storage in UTC; presentation in club-local time

- **Status:** Accepted
- **Date:** 2026-05-09
- **Ratified:** 2026-05-09
- **Slice:** 1
- **content_signature:** 9d5c410cd131

## Context

Timestamps cross many boundaries in this app:

- **Auth (ADR-0002):** session issued/expires_at, last login.
- **Money (ADR-0004):** subscription period start/end, charge timestamps from Stripe.
- **Audit (ADR-0006):** `created_at` on every audit_log row — relied on for "who-did-what-when" reconstruction during disputes.
- **Time-bank (ADR-0011):** deposits, redemptions, expirations, dormancy and escheatment cutoffs.
- **Tournament (ADR-0012):** scheduled start times displayed to members in their local context.
- **Alcohol/BYOB (ADR-0033):** consumption windows defined in club-local time by TABC-equivalent house policy.

Texas operates on America/Chicago. The club's physical sessions, tournament starts, alcohol-service windows, and "today's redemptions" reports are all club-local concepts. Members may travel; their browser may report any timezone. There is currently no written policy on what timezone gets persisted, how displayed timestamps are localized, how audit log entries are reconstructed across DST transitions, or how scheduled-future events should survive a legislative DST rule change. The risk: ad-hoc handling drifts and an aggregation silently loses an hour twice a year.

## Decision

**All timestamps are persisted as `timestamptz` with values stored in UTC.** Postgres stores `timestamptz` internally as UTC regardless of session timezone, so storage is enforced by the engine. The presentation tier converts to America/Chicago for display; the audit log viewer renders both UTC and America/Chicago side-by-side. Every timestamp field in the system belongs to exactly one of four declared categories, each with its own policy.

### Timestamp categories

Every existing and future timestamp field MUST be classified as one of:

1. **Moments** — a single absolute instant. Storage: `timestamptz` UTC. Math: UTC elapsed time.
   Examples: `audit_log.created_at` (ADR-0006), `payments.created_at` and Stripe charge timestamps (ADR-0004), session `issued_at` / `expires_at` (ADR-0002), `time_ledger` entries and `time_wallets.last_activity_at` (ADR-0011).
2. **Wall-clock intents** — civil-time anchored to a wall clock that may move under DST or legislative change. Storage: `timestamptz` UTC **plus** a `tz_name` IANA-zone column on the same row, so the wall-clock can be re-resolved if rules change. Math: local wall-clock.
   Examples: **`tournaments.starts_at` (ADR-0012)**, BYOB / alcohol-service windows (ADR-0033), recurring-event templates if introduced. The `tz_name` companion column is added by ADR-0012 in the same change set that introduces the admin schedule write path (ADR-0012 Slice 3 — registration-with-entry-fees); the admin schedule UI does not ship before that column. Slice-1 read-only `/games` listing only renders rows whose `starts_at` is unambiguous (does not intersect a DST seam).
3. **Vendor-derived moments** — instants supplied by an external system whose own timezone configuration is part of the seam. Storage: `timestamptz` UTC, unmodified from vendor. The vendor's account timezone is a documented deployment dependency; **the Stripe account timezone MUST be set to UTC** (ADR-0008 environments concern) and any future vendor inherits the same audit line. Display of vendor-derived moments computes the user-facing day in America/Chicago and warns when the rendered day lands inside a DST transition window.
4. **Jurisdictional dates** — calendar dates whose meaning is set by a regulator. Storage: `date` (not `timestamptz`) plus an explicit jurisdiction config. Comparison: the jurisdiction's calendar.
   Examples: TX escheatment cutoff (ADR-0011), tax-year boundaries, GDPR/CCPA deletion deadlines.

**Future ADRs MUST declare the category for each new timestamp field.**

### Schema additions owned by this ADR (Slice 1)

ADR-0034 introduces two columns directly:

- **`clubs.display_tz text not null default 'America/Chicago'`** — the single config surface for the v1 default presentation zone (see Presentation rules). The `clubs` table is created in Slice 1 by this ADR (single row for the v1 club); multi-club expansion (ADR-0002 Slice-4 trigger) is then a config write, not an ADR rewrite.
- **`profiles.display_tz text null`** (IANA zone or null) — explicit member-set preference; null means use the club zone. No default; no auto-detection.

Both columns ship under the ADR-0018 migration template's `timestamptz` defaults amendment (see Storage and database rules).

### Storage and database rules

- No `timestamp without time zone` columns are permitted in application schemas. Vendor/extension tables that ship `timestamp` are wrapped in views that cast to `timestamptz` with an explicit zone. CI grep / `pg_catalog` query fails the build if a new `timestamp` (no-tz) column lands — same gating shape as ADR-0004's `*_cents` lint. **ADR-0018 migration template is amended to default `timestamptz`.**
- The **database session timezone** is set to UTC at the role/database level. App, migrations, psql, BI tools, and replicas all see UTC unless they explicitly opt out.
- **Day/hour buckets** in any business-meaningful query MUST express the zone explicitly: `date_trunc('day', x at time zone 'America/Chicago')`. Bare `date_trunc('day', x)` is forbidden in application SQL under `db/queries/reports/**` and any other directory whose output is a member-facing or finance-facing bucket; the CI lint scope is exactly that glob set, declared in `scripts/lint/sql-day-bucket.ts`. SQL outside that scope (ad-hoc analytics, internal-only debug queries) is exempted; the convention is enforced by directory placement, not prose.

### Presentation rules

- The **display zone is presentation-zone-as-data, not a constant.** v1 default is `America/Chicago` sourced from `clubs.display_tz` (see Schema additions). Multi-club expansion (ADR-0002 flagged Slice-4) is mechanical (add clubs, set their `display_tz`), not a new ADR.
- **Member overrides follow surface-by-surface posture (premortem-risk-2 Option 3):** emails and SMS always render club-zone (so a member cannot blame "I saw Pacific"); in-app UI MAY localize from `profiles.display_tz` when set; browser-detected zones are NEVER used silently. The audit log is ALWAYS UTC + club-zone, never member-zone — audit determinism does not depend on who is looking.
- **All duration math** (session lifetime per ADR-0002, dormancy and escheatment windows per ADR-0011, idempotency TTLs per ADR-0005, refund-eligibility windows per ADR-0012) is computed in UTC elapsed time. Durations are *intervals*, never `(start_local, end_local)` tuples; they never need re-resolution across DST.
- **Timezone conversion happens in exactly one tier — the database.** The presentation layer receives pre-formatted display strings + the raw UTC instant. The Node/JS runtime does not call `Intl.DateTimeFormat` with a `timeZone` argument for stored timestamps; this collapses the multi-runtime tzdata-divergence problem to a single Postgres-image dependency owned under ADR-0008's deployment-hygiene checklist.

### Audit log presentation contract

- Primary sort and filter axis is **UTC**, not Central.
- The Central column is annotated with the in-effect DST offset (`CDT` / `CST`) on every row.
- During fall-back's repeated hour, the viewer renders an explicit warning banner ("the next 1 hour of rows occurred during the DST repeat — sort is by UTC; Central times are not unique") for any time range that intersects the seam.
- The audit row schema is NOT amended to add an actor-TZ column in v1 (see falsifier-3 below). UTC + club-zone is the v1 audit reconstruction surface.

### Cross-ADR amendments owned by this ADR

- **ADR-0018 (database migrations):** migration template is amended so that new timestamp columns default to `timestamptz`, and the CI gate forbids `timestamp without time zone` in application schemas.
- **ADR-0008 (environments):** deployment-hygiene checklist is amended to include (a) Stripe account TZ verification = UTC on every environment promotion, (b) Postgres image tzdata version pinning and patch-cadence tracking (premortem-risk-10), and (c) verification that the database role/session timezone is UTC.

> **Open empirical bet (falsifier-1):** `tournaments.starts_at` is wall-clock-intent with a `tz_name` companion column landing alongside ADR-0012's admin schedule write path. If indefinite recurring schedules with semantic stability across legislative TZ changes are introduced (e.g., "every Tuesday at 7 PM, forever" surviving an abolition of DST), the `(timestamptz, tz_name)` pair is sufficient for a single recurrence but not for a series template; that case requires an RRULE-with-TZID column and is deferred until recurring schedules become real.

> **Open empirical bet (falsifier-2):** Member-visible billing receipts and compliance/legal disclosures (CCPA/GDPR SLA-clock confirmations) are rendered in club-zone in v1, on the bet that all such surfaces are addressed to club-context viewers. If counsel or a regulator later requires a receipt or SLA disclosure to render in the merchant-account or subject-resident TZ, billing-and-compliance becomes a fifth category (or a sub-class of vendor-derived moments) and the renderer is extended; v1 ships the simpler default.

> **Open empirical bet (falsifier-3):** v1 audit reconstruction relies on UTC + club-zone only. If a cross-jurisdiction dispute arises where the actor's then-current device TZ matters, two-column rendering is insufficient and ADR-0006 must be amended to add an `actor_tz` column with three-column rendering. Accepted as residual risk; the `ip` and `user_agent` columns already on `audit_log` provide a coarse TZ proxy.

## Consequences

**Positive:**

- One storage rule, four explicit categories: every future ADR declares which bucket its new field is in. No silent drift.
- Schema-level invariant (`no timestamp without time zone`) gated by CI — conventions decay; gates persist (parallels ADR-0004's `*_cents` enforcement).
- Single-tier conversion (DB only) eliminates Vercel-Node vs Supabase-Postgres tzdata divergence.
- Audit log reconstruction is deterministic under DST: UTC primary sort + offset-annotated Central + repeated-hour banner together address the actual operational failure mode (premortem-risk-6).
- Duration math in UTC means a "12-hour staff session" is *always* 12 hours of elapsed time, not 11 or 13 across DST seams (premortem-risk-7).
- Multi-club expansion (ADR-0002 Slice-4 trigger) is a config write to `clubs.display_tz`, not an ADR rewrite (premortem-risk-1).
- Cross-ADR amendments (ADR-0018 migration template, ADR-0008 deployment checklist) are committed in this ADR rather than left as drift candidates.

**Negative:**

- **Single-club v1 with column-backed expansion path (premortem-risk-1):** the policy hides the multi-club axis behind `clubs.display_tz`. The column exists in Slice 1, but the *application code* still reads a single row; until the read path is generalized, a partner club opening before that read path is generalized must wait on a small but real change. Trigger: owner announces second location.
- **Member override ambiguity (premortem-risk-2):** "surface-by-surface" is committed but spans email (Resend), SMS (Twilio), and in-app render paths. Three implementations could still drift. Mitigation: single `lib/time/display.ts` helper for every render call; integration test asserts SMS/email both render club-zone for a member with `profiles.display_tz != null`.
- **Scheduled-future events across DST (premortem-risk-3):** wall-clock-intent storage requires the `tz_name` companion column on `tournaments`. The admin schedule UI is gated on that column landing — it does not ship until ADR-0012's Slice 3 admin write path includes the column in the same change set; Slice 1 ships only the read-only listing, which renders no DST-intersecting rows. Risk: the gating must be enforced by the conductor cycle for ADR-0012, not by hope.
- **Postgres `now()` ambiguity (premortem-risk-4):** session-tz UTC is enforced at the role level, but a connection that explicitly `SET timezone` overrides it. Any reporting query that uses `current_date` or `date_trunc('day', x)` without an explicit zone is a latent bug. Mitigation: SQL-review checklist item; CI lint pattern (`scripts/lint/sql-day-bucket.ts`) over `db/queries/reports/**` for `date_trunc('day',` not followed by `at time zone`; out-of-scope queries are by directory convention, not prose.
- **Vendor-supplied timestamps (premortem-risk-5, falsifier-2):** Stripe account timezone is named as a deployment dependency (UTC), and the audit-on-promotion line lives in the ADR-0008 amendment above. If a future Stripe configuration drifts (e.g., a connected-account onboarding sets a non-UTC TZ), receipts may display the wrong renewal day. Mitigation: ADR-0008 promotion checklist item; webhook idempotency window expressed in elapsed UTC seconds, not day buckets.
- **Audit log dual-render becomes operationally noisy (premortem-risk-6):** two timestamp columns on every row of a 200k-row admin viewer is visual noise. Mitigation: UTC is the primary sort; Central column is offset-annotated and the repeated-hour banner is mandatory; collapse to a single column with a hover-popover for cross-zone is acceptable post-launch if usability data warrants.
- **Session expiry vs DST (premortem-risk-7):** durations-in-UTC is committed, so a 12-hour staff session is always 12 elapsed hours; a forensic question framed as "was this session valid at 8:55 AM Central on DST Sunday?" still requires the reviewer to map back through the in-effect offset. Mitigation: audit viewer renders session lifetime as `expires_at_utc` with a Central annotation, not as "12 hours from sign-in."
- **Time-bank dormancy & escheatment (premortem-risk-8):** "36 months dormant as of June 30" is a jurisdictional date — committed to the `date` + jurisdiction-config category. Until the CPA-pending ADR-0011 review concludes, the system computes `is_dormant_for_36_months` against America/Chicago calendar boundaries; if counsel directs otherwise (e.g., UTC for federal-tax cross-reference), the comparison-zone is reconfigurable.
- **`timestamptz` lulls developers into false confidence (premortem-risk-9):** the schema-invariant + CI gate is the structural mitigation, but a contractor-written migration or Supabase-managed table that ships `timestamp` will still fail the build *only after* it lands. Mitigation: the ADR-0018 migration template (amended above) leads with `timestamptz` defaults and the gate runs on every PR.
- **IANA tzdata is a deployment dependency nobody owns (premortem-risk-10):** committing conversion to a single tier (Postgres) collapses the divergence surface, but the Postgres image's tzdata version is now load-bearing. Mitigation: the ADR-0008 amendment above adds Postgres-image tzdata version pinning and patch-cadence tracking; staging is the canary for tzdata-rule changes before production promotes.
- **UTC-storage absolutism (falsifier-1, partially):** indefinite recurring schedules (e.g., a "Tuesday 7 PM forever" league) are deferred — when introduced, the `(timestamptz, tz_name)` pair is insufficient for a series template and an RRULE-with-TZID column is the right structure; this is a known future migration.
- **Cross-jurisdiction billing/compliance display (falsifier-2, residual):** receipts and SLA-clock disclosures render in club-zone in v1; if a regulator requires merchant-account or subject-resident TZ, the renderer is extended.
- **Cross-actor TZ in audit (falsifier-3, residual):** the audit log captures `ip` and `user_agent` (per ADR-0006) but no actor-TZ column. Cross-jurisdiction reconstruction requires inferring TZ from `ip` or amending ADR-0006 to add `actor_tz`. Accepted as residual risk for v1.

## Alternatives considered

- **Civil-time-as-default storage `(local_datetime, tz_name)` for all timestamps.** Correct for wall-clock intents, wrong for moments — every audit row would need re-resolution to compare against another row. Rejected as a global default; preserved as the *wall-clock-intent category* policy where it belongs.
- **No category distinction; UTC for everything (the original Direction prose).** Simpler. Breaks for `tournaments.starts_at` across DST and for jurisdictional escheatment dates. Rejected; the category split is the load-bearing structural amendment (premortem cross-cutting recommendation, falsifier-1).
- **Per-context display TZ — billing in merchant-account TZ, compliance in subject-resident TZ, club events in club TZ (falsifier-2's structural alternative).** Rejected for v1 on the bet that all current member-visible timestamps are club-context; revisit if counsel or a regulator requires otherwise. Stripe account is configured to UTC as the deployment-side mitigation in the meantime.
- **Three-column audit log (UTC + club-zone + actor-zone) with `actor_tz` added to `audit_log` (falsifier-3's structural alternative).** Rejected for v1: requires an ADR-0006 amendment and a non-trivial schema change; v1 audit scope is DST-disambiguation, not cross-jurisdiction. `ip` + `user_agent` provide a coarse TZ proxy. Reconsidered if a cross-jurisdiction dispute arises.
- **Single-zone-for-everything member display (premortem-risk-2 Option 1).** Simplest. Rejected because in-app UI for a traveling member benefits from explicit profile-preference localization; emails/SMS still pinned to club-zone preserves the audit determinism win.
- **App-config row instead of `clubs.display_tz` for the v1 default zone.** Rejected: an app-config row is single-club by construction and re-introduces the multi-club rewrite this ADR is built to avoid. The `clubs` row is the right scope owner.
- **Convert in the JS runtime (Node/browser) instead of Postgres.** Rejected — `Intl.DateTimeFormat` tzdata diverges from Postgres tzdata across runtime image updates (premortem-risk-10). DB tier is the single ownership boundary.
