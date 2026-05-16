---
date: 2026-05-15
adrs: [0035]
slice: 4
type: feature
status: shipped
---

# Conductor run — ADR-0035 admin operations console

## Context

Slice 4's load-bearing surface. Cycles 1–3 shipped the substrate for every staff workflow on the project — the `role_at_least` ladder (ADR-0003), the `audit_log` table + `withAudit` helper (ADR-0006), the ID-verification schema (ADR-0009), the `feature_flags` table (ADR-0020), and the soft-delete + `del:<hash>` anonymization machinery (ADR-0023) — but exactly zero `/admin/**` routes existed in `app/`. The middleware path-gate sat in front of a 404. ADR-0009's manual verification queue was a Storage bucket nobody could review; ADR-0023's deletion flow had no triage UI; ADR-0027's refund-authority matrix referenced "manager actions" that lived only in audit-log invariants. Slice 4 cannot launch without this console.

The ADR scoped the build deliberately to eight v1 surfaces (dashboard, members list, member detail, verifications queue, audit-log viewer, flags, privacy queue, refund handoff) wired to existing infrastructure with **no new business-domain tables** beyond `privacy_requests`. Tournament admin (ADR-0012), observability dashboards (ADR-0014), SMS history (ADR-0025), and bulk operations are explicitly out of v1. The cashier console (`/cashier`) is a separate surface owned by ADR-0027.

The run end-to-end: spec-writer + critic (2 iterations to ship rev 2 — pinned the AC4 layout-order contradiction, the AC5 first-await semantics extension to `_actions/*.ts`, the `initiateMemberDeletion` emission point, AC35 dashboard-cache invalidation as a new AC, and the `MFA_CHALLENGE_READY=false` fallback) → planner (`.conductor/0035/plan.json`, 23 tasks across 4 sub-slices) → mandatory premortem (13 additional risks beyond the 10 spec-pre-loaded) → six worker waves (1: t0/t1/t2/t8 schema+auth+pure-fn; 2: t3 layout; 3: t4/t5/t19 defense-in-depth + dashboard + Sentry; 4: t6/t7/t9/t12/t13 read-pages + audit-log + role; 5a: t10/t11/t14 verification actions + refund; 5b: t15/t16/t17 flags + privacy + deletion; 6: t18/t20/t21 observability + a11y + cross-cutting) → a combined finisher dispatch that picked up the remaining wave-6 work plus a surgical fix to a pre-existing defense-in-depth source-order failure → integration gauntlet of 9 acceptance commands all green → Phase 4 ship in flight.

Twenty-five worker iterations across the build, only one socket-error retry (t17 iter 1). Compare to ADR-0006's five-retry run — Slice 4 was easier because the premortem pre-loaded the substrate-vs-production gaps and the KB topics from prior cycles already had the load-bearing lessons.

## Changes

Total slice surface (uncommitted; Phase 5 shipper composes the commits):

**Schema (t0, t1):**

- `supabase/migrations/0005_privacy_requests.sql` — two enums (`privacy_request_kind_t`, `privacy_request_status_t`), the `privacy_requests` table (10 columns from ADR Data Model Deltas), three named RLS policies (`privacy_requests_select_self_or_manager`, `privacy_requests_insert_self`, `privacy_requests_update_manager`), **no DELETE policy** (audit-equivalent invariant), `privacy_requests_status_idx`, the `member_number_seq` sequence starting at 1000 (premortem R6 mitigation), and `COMMENT ON COLUMN privacy_requests.requester_email` documenting the pre-anonymization PII contract verbatim per premortem R7.
- `supabase/migrations/0006_feature_flags_rls.sql` — ENABLE+FORCE RLS on the cycle-1 `feature_flags` table; `feature_flags_select_authenticated` (any `auth.uid() IS NOT NULL`); `feature_flags_write_manager` (`FOR ALL USING+WITH CHECK auth.role_at_least('manager')`). Cycle-1 migration NOT rewritten — drift resolved forward per ADR-0018.
- `supabase/migrations/0007_privacy_requests_failed_status.sql` — `ALTER TYPE privacy_request_status_t ADD VALUE 'failed'` (landed mid-build by t16 to support premortem R2's `export_url_generation_failed` audit path; safe additive ALTER TYPE).

**Auth + role-gate layer (t2, t3, t4):**

- `lib/auth/requireRole.ts` (modified) — when minimum is `manager|owner`, reads `session.aal` via the new `lib/auth/getSessionAal.ts` shim (mockable AAL reader to preserve cycle-3's test matrix) and redirects to `/login/mfa-challenge?next=...` when `aal < aal2`, or to `/login/mfa-pending` when `MFA_CHALLENGE_READY === false`. Audit hooks `admin.session.entered` (cookie-scoped client, dedup via `mopc-admin-session-seen` cookie 30-min TTL) and `admin.session.role_check_denied` (service-role client to survive lack of caller's audit_log INSERT privilege).
- `lib/auth/mfa-availability.ts` — exports `MFA_CHALLENGE_READY: boolean = false`. ADR-0002 cycle 4 flips to true.
- `app/(auth)/login/mfa-pending/page.tsx` — static fallback. Renders actor email + role badge so phishing screenshot is visually distinguishable from real admin entry (premortem R13).
- `app/(admin)/admin/layout.tsx` — first body statement `await requireRole('manager')`. Renders top nav + logo + role badge + `{children}`. `InsufficientRoleError` renders the existing 403 page.

**Twelve admin pages + components (t5–t9, t12, t14–t16):**

- `app/(admin)/admin/page.tsx` — dashboard, four cards (pending verifications, pending deletions, active kill-switch flags, last 5 audit rows), wrapped in `unstable_cache(..., { revalidate: 30, tags: ['admin-dashboard-counts'] })`.
- `app/(admin)/admin/members/page.tsx` — list + 3 filters (status, role, q) + pagination; 8 columns including `member_number`, `id_verified_at`, `created_at` (UTC + Central per ADR-0034), `deleted_at` indicator.
- `app/(admin)/admin/members/[id]/page.tsx` — read-only detail (profile dl, membership, time wallet via `formatMoney`, last-20 audit rows, last-5 payments fallback). Self-edit banner hides action buttons when `profile.id === session.user.id`.
- `app/(admin)/admin/members/[id]/_components/actions-panel.client.tsx` — four typed-confirmation dialogs (role change, reverification, refund-flow, delete account) via the new shared component below.
- `app/(admin)/admin/verifications/page.tsx` — queue with per-row signed thumbnail (1hr TTL, server-side, `referrerPolicy='no-referrer'`), DOB-21-check banner (`AGE OK` green / `UNDER 21 — REJECT` red verbatim per ADR-0009), three action buttons each opening a typed dialog. Signed-URL failure mode: per-row try/catch, placeholder copy, buttons remain actionable (`data-thumb-failed='true'`).
- `app/(admin)/admin/audit-log/page.tsx` — paginated DESC by `created_at`, columns include resolved actor email (LEFT JOIN; literal `'system'` on miss), expand-on-click before/after JSON, ip, user_agent. Filter range entered in club-local time and converted via `crossesFallbackSeam` (t8) for the DST banner.
- `app/(admin)/admin/flags/page.tsx` — every `feature_flags` row, kill-switch (`key LIKE 'kill-%'`) flips gated by typed-confirmation; non-kill flags save immediately.
- `app/(admin)/admin/privacy/page.tsx` — status filter (default `pending`), requester display falls back to `requester_email` when `status='completed' AND kind='delete'`; three typed dialogs (Approve export → `'approve'`, Approve deletion → requester email, Reject → `'reject'` + 1..500 reason).
- `components/admin/typed-confirmation-dialog.tsx` — raw Radix `AlertDialog` (ADR-0023 precedent). Focus on Cancel, Esc closes, `aria-modal='true'`, case-sensitive whitespace-significant phrase gate. Empty phrase bypasses the input for non-mutation flows (refund handoff).

**Fourteen server actions (`app/(admin)/admin/**/_actions/*.ts`):**

- `searchMembers.ts` (t6) — q trimmed/lowercased/64-char truncated; cookie-scoped client (RLS-gated); parallel `count(*)`; no audit event.
- `queryAuditLog.ts` (t12) — actor-email typeahead resolves email→UUID, cookie-scoped (RLS gates manager+ visibility), no audit event.
- `approveVerification.ts` (t10) — `nextval('member_number_seq')` (premortem R6 mitigation — sequence created at migration time, not COALESCE-MAX fallback). Idempotent no-op on already-verified.
- `rejectVerification.ts`, `requestVerificationInfo.ts` (t11) — reason 1..500 / message 1..1000; reject stores verbatim reason; info_requested stores only `message_length`.
- `changeRole.ts` (t13) — role-ladder authority refine (promotion requires `await requireRole('owner')` as second gate; multi-rung demotion throws `RoleLadderViolation`); two-rows-per-role-change invariant (server action + DB trigger).
- `requestReverification.ts` (t13) — UPDATE `id_verified_at=NULL` inside `withAudit`; reason length-only in audit, not text.
- `openRefundFlow.ts` (t14) — no SQL mutation; UUID-regex + existence probe BEFORE the audit breadcrumb (premortem R9); redirects to `/admin/payments/[id]/refund` when `PAYMENTS_CONSOLE_READY===true` else `/admin/members/[id]?refund=pending-adr-0036`.
- `updateFlag.ts` (t15) — most-specific-first event selection (enabled→toggled, else percent→percent_changed, else allowlist→…, else role_gate→…), exactly one audit row per call.
- `approveExport.ts` (t16) — two-phase: audit-tx (`status='in_progress'`) → post-tx signed URL (24hr TTL) → second tx (`status='completed'`). Failure path emits `admin.privacy.export_url_generation_failed` + `status='failed'` (premortem R2; new 17th taxonomy event).
- `approveDeletion.ts` (t16) — load-bearing order: `SELECT ... FOR UPDATE` → assert `status='pending'` → assert `confirmEmail === requester_email` → `softDeleteProfile(profile_id, tx)` → `UPDATE status='completed'` (premortem R10 concurrency mitigation).
- `rejectRequest.ts` (t16) — reason 1..500; `UPDATE WHERE status='pending'` else throw `RequestNotPending`.
- `initiateMemberDeletion.ts` (t17) — creates a `privacy_requests` row (kind=delete, status=pending); audit `after={request_id}`, no PII.

**Errors (`app/(admin)/admin/_errors.ts`):**

- Seven custom error classes — `SelfEditViolation`, `RoleLadderViolation`, `RejectReasonInvalid`, `ConfirmEmailMismatch`, `RequestNotPending`, `NoChange`, `BadRequest`. All extend `Error` (premortem R12); all set `this.name` so analytics `classifyAdminActionError` mapping works.

**Observability (t18, t19):**

- `lib/analytics/admin-events.ts` — four PostHog events behind the consent gate; payload allowlist limited to `{ role, outcome, queue_depth?, flag_key?, field? }` — no `actor_id`, no `actor_email`, no `target_id` (premortem R4).
- `lib/observability/sentry.ts` (+ `instrumentation.ts`) — `surface=admin` tag, `action=<name>` + `actor_role=<role>` per server-action exception, `beforeSend` redaction list extended with `reject_reason`, `info_request_message`, `requester_email`.

**Timestamp helper (t8):**

- `lib/timestamps/dst-seam.ts` — pure `crossesFallbackSeam(fromUtc, toUtc): boolean` for the audit-log filter UI's DST banner per ADR-0034.

**Tests — 33 new files, 1345 total green:**

- Migration shape: `tests/migrations/admin-privacy-requests-shape.test.ts` (31), `role-change-trigger-shape.test.ts`.
- RLS contract: `tests/db/rls-privacy-requests.test.ts` (17), `tests/db/rls-feature-flags.test.ts` (20).
- Auth: `tests/auth/admin-routes.test.ts` (15), `admin-routes-defense-in-depth.test.ts`, `requireRole-aal.test.ts`.
- Per-action pglite-backed: 10 separate action test files.
- Per-page RTL: 7 separate page test files.
- A11y sweep: `tests/admin/a11y/` — 7 page suites, 21/21 axe-clean.
- Cross-cutting source-grep: `audit-event-taxonomy.test.ts`, `no-pii-in-admin-audit.test.ts`, `role-ladder-defense.test.ts`, `dashboard-cache-invalidation.test.ts`, `withAudit-throw-discipline.test.ts`, `posthog-events.test.ts`, `sentry-tags.test.ts`.
- DST: `tests/timestamps/dst-seam.test.ts`.

**Misc:**

- `.eslintrc.json` extended to allow `createAdminClient` inside `app/(admin)/admin/**/_actions/*.ts` (otherwise the cycle-3 "no service-role outside lib/" rule blocked the legitimate admin escape hatches).

## Decisions

Non-obvious choices made during build, worth pinning:

- **AAL check encapsulated inside `requireRole` rather than the admin layout (B1 critic resolution).** First spec draft had AC4 ordering the layout as `requireRole('manager') → AAL guard → render`, which makes the layout responsible for two security contracts. Critic flagged it; rev 2 moved the AAL check into `requireRole.ts` so the layout's single first statement is `await requireRole('manager')` and the AAL semantics are an encapsulated behavior of "requiring manager+." Every page's defense-in-depth assertion stays a single-token grep.
- **`member_number_seq` created at migration time, not COALESCE-MAX fallback (premortem R6 mitigation).** AC12's Open Q1 default was "prefer `nextval`; fall back to portable `MAX+1` inside FOR UPDATE if sequence absent." The premortem caught that two managers approving different profiles can both compute `MAX+1` from a snapshot where neither has committed yet — UNIQUE catches one but the losing tx already wrote its audit row before the violation surfaced. T0 fixes this by creating the sequence inside the spec's migration even though the spec didn't list it as a required artifact. `approveVerification` uses `nextval` unconditionally.
- **`approveDeletion` `SELECT FOR UPDATE` before the confirmEmail check (premortem R10 mitigation).** Two managers, same `privacy_requests` row, both type the requester email correctly within 100ms. The load-bearing order is (1) `SELECT FOR UPDATE` on the request row, (2) assert `status='pending'` (the racing second tx blocks until the first commits, then sees `'completed'` and throws `RequestNotPending`), (3) assert `confirmEmail === requester_email`, (4) `softDeleteProfile`, (5) `UPDATE status='completed'`. FOR UPDATE before the status check is the difference between "two confirmation emails" and "exactly one succeeds."
- **`openRefundFlow` validates UUID + profile existence before the audit breadcrumb (premortem R9 mitigation).** Even though there's no SQL mutation and no typed-confirmation in the UI, the action MUST validate `profileId` is a well-formed UUID AND corresponds to a real profile row BEFORE the `withAudit` call fires. Without it, a compromised manager session could spray thousands of `admin.refund.flow_opened` rows pointing at random UUIDs for forensic noise. `BadRequest` throws before the audit-tx opens.
- **`admin.privacy.export_url_generation_failed` audit event added beyond spec (premortem R2 mitigation).** `approveExport` is two transactions — the audit row commits with `status='in_progress'` before the signed-URL generation. If Supabase storage is degraded, the second tx never runs and the request is stuck `in_progress` forever (the dashboard only counts `'pending'`). T16 added a 17th event to the taxonomy: on `createSignedUrl` throw, write a NEW audit row + `UPDATE status='failed'` so the failure is observable. AC27 was updated to expect 17 distinct event strings, not 16.
- **`.eslintrc.json` extended to allow `createAdminClient` in admin actions.** Cycle 3 shipped a project-level rule banning `createAdminClient` outside `lib/`. The admin actions legitimately need service-role for `softDeleteProfile`, for `nextval('member_number_seq')` (PostgREST cannot express it via `.update()`), and for the `admin.session.role_check_denied` audit hook on a session that may lack `auth.uid()`. The override is scoped to `app/(admin)/admin/**/_actions/*.ts` — every other call site of the rule still triggers. The convention is to name the variable `adminClient` (service-role escape) vs `userClient` (cookie-scoped, RLS-gated) per premortem R1.
- **`PAYMENTS_CONSOLE_READY=false` stub for ADR-0036 handoff.** `lib/payments/console-availability.ts` exports a boolean constant. This cycle creates it; ADR-0036's spec flips it to `true`. The redirect target degrades gracefully (`?refund=pending-adr-0036` query param on member detail), and the audit breadcrumb fires identically in both branches so the historical record doesn't depend on the cutover date.
- **Typed-confirmation pattern: raw Radix `AlertDialog`, no abstraction.** Followed the ADR-0023 precedent that established the pattern. The shared `components/admin/typed-confirmation-dialog.tsx` is parameterized by `confirmPhrase` (case-sensitive, whitespace-significant; empty bypasses the input for refund-flow); initial focus is on Cancel; Esc closes. No shadcn `AlertDialog` wrapper — too easy for that abstraction to drift on focus management.
- **Two-rows-per-role-change is intentional and tested explicitly.** The DB trigger `profiles_protect_role_change` writes `profile.role_change` from cycle 1; the server action's `withAudit('admin.member.role_changed', ...)` writes a second row. Premortem R3 surfaced the failure mode: a future migration that consolidates triggers could silently drop the trigger emission. `tests/admin/role-ladder-defense.test.ts` asserts `audit_log` contains EXACTLY 2 rows within a 1-second window after a `changeRole` mutation; `tests/migrations/role-change-trigger-shape.test.ts` regexes the latest migration for the `INSERT INTO audit_log` literal inside the trigger function body.

## Tests

The integration gauntlet — all nine acceptance commands from the spec's frontmatter — passed in the finisher dispatch:

- `pnpm typecheck` — exit 0.
- `pnpm lint` — clean.
- `pnpm migrate:check` — 6 migrations scanned, all green.
- `pnpm test` — **132 files / 1345 tests / 1 skipped / 1 todo** (the skipped + todo are preserved from cycles 1–3, unrelated to this slice). Up from ADR-0034's ~1100 tests.
- `pnpm test tests/migrations/admin-privacy-requests-shape.test.ts` — 31/31.
- `pnpm test tests/db/rls-privacy-requests.test.ts` — 17/17.
- `pnpm test tests/db/rls-feature-flags.test.ts` — 20/20.
- `pnpm test tests/auth/admin-routes.test.ts` — 15/15.
- `pnpm test tests/admin/` — 37 files / 442 tests.

Cross-cutting structural tests landed in t21 / the finisher: taxonomy uniqueness (every `withAudit(...)` action string in the sixteen-event taxonomy and no two actions share the same string — extended to seventeen post-R2), no-PII source-grep (no `email|full_name|phone|dob` in `before:`/`after:` literals across every action file), role-ladder defense (UI + server-action + DB-trigger meta-pin), dashboard cache invalidation walker (every mutation-class action contains `revalidateTag('admin-dashboard-counts')` — generalized from the AC35 ten-action list to a walker that catches future actions per premortem R5), throw discipline (no string throws, every error class extends Error, every class sets `this.name`).

## Next

- **ADR-0036 (Payment Management Console)** — flips `PAYMENTS_CONSOLE_READY=true`, ships the actual refund flow at `/admin/payments/[id]/refund`, wires Stripe customer linkage. The breadcrumb action from this cycle (`openRefundFlow`) already redirects correctly when the constant flips.
- **ADR-0002 cycle 4 (MFA challenge)** — when MFA enrollment ships, `MFA_CHALLENGE_READY` flips to `true`, the `/login/mfa-pending` static page becomes a hard 410 Gone, and the AAL2 gate inside `requireRole` becomes the real challenge redirect instead of the friendly fallback.
- **Slice 5 polish ADRs** — bulk operations, saved searches, CSV export of the privacy queue (premortem R7 has a column-comment guarding the email leak on export), audit-log "anonymized profile" forensic banner (premortem R8 partial), `searchMembers` enumeration detection (premortem R11 v1 mitigation was min-2-char; v2 is operational logging).

## Notes for future me

- **The premortem earned its keep.** Thirteen distinct risks beyond the spec's pre-loaded ten. Six of them (R2 export_url_generation_failed event, R6 sequence-at-migration, R7 column comment, R9 UUID validation, R10 FOR UPDATE ordering, R12 throw discipline) became code/test contracts the workers implemented one-for-one. The pattern from ADR-0024 holds: privacy/PII surfaces fail silently — the validator can be green at 1345/1345 while a single audit row is malformed PII. The premortem is the artifact that turns "what could go wrong" into a checklist the implementation honors.
- **The biggest spec surprise — AC2 `feature_flags` RLS UPDATE filtering returns `rowCount=0`, NOT 42501.** Spec AC2 prose said "A `member`-roled session UPDATE against `feature_flags` raises SQLSTATE `42501`." This is wrong about Postgres semantics — with the prescribed FOR ALL write policy + GRANTed UPDATE, the policy's USING evaluates implicit-false and the row is invisible; UPDATE silently returns `rowCount: 0`, not 42501. This is the same gotcha cycle 2 hit on `audit_log` (already pinned in `docs/kb/rls.md` 2026-05-10). T1 the worker honored the observed PG behavior in the test, flagged the spec divergence in the dispatch, and shipped — the security contract (no non-manager writes commit) is fully satisfied either way. **Cycle 2's KB lesson would have prevented the spec error; pre-load it harder for cycle 5.**
- **The iter-2 spec revision was the right cost.** Critic iter 1 returned `revise` with 1 blocker + 8 should-fix + 5 nits. Rev 2 added ~238 lines (no AC renumber), pinned six load-bearing seams (B1 layout order, S1 first-await semantics, S2 changeRole authority order, S3 deletion-initiated emission point, S4 dashboard cache-invalidation AC35, S6 MFA fallback graceful degradation). Critic iter 2 returned `ship`. Two spec iterations + one planner iteration + 25 worker dispatches is the new high-water-mark for an 8-surface multi-module slice. Compare ADR-0006's 5 retries on a schema-only slice — the right metric is "iterations of substrate-vs-production gap learning," not "iterations of sloppy work."
- **T17 had a single socket-error retry on iter 1.** The recovery was clean: re-dispatching the same task brief produced an `ok` outcome on iter 2 with no contract drift. Worth noting because future runs may see the same transient — the framework's automatic retry budget absorbed it without surfacing.
- **The finisher dispatch is a real role.** Sub-tasks t18 / t20 / t21 were originally wave-6 worker tasks; mid-build the conductor combined them into a single capstone (`0026-finisher.md`) that also handled the pre-existing `admin-routes-defense-in-depth.test.ts` regression. The regression was caused by `app/(admin)/admin/privacy/page.tsx` and `verifications/page.tsx` declaring their `PrivacyQueueBody` / `VerificationsQueue` helper functions BEFORE the default export — the first `\bawait\b` token in source order was `await supabase.from(...)`, not `await requireRole(...)`. Surgical fix: moved the helper declarations BELOW the default export (function declarations are hoisted; JSX reference resolves correctly). The pattern mirrors `changeRole.ts` / `approveVerification.ts` / `openRefundFlow.ts` where the production `defaultDb` adapter sits below the action for the same first-await-token contract. **The defense-in-depth source-grep test is load-bearing on file order; document the convention in the admin-console KB topic.**
- **PostHog property allowlist is the v1 staff-PII guard.** Q6 in the spec acknowledged that we ship the consent gate as-is and accept silent telemetry from staff who declined (audit log is operational record-of-record). The premortem R4 caught that "staff who CONSENTED at signup have their email sent to PostHog" is a different problem — the cookie banner consent was for product analytics, not staff identity in cohort reports. The fix is a hard allowlist on event payload keys (`role`, `outcome`, `queue_depth?`, `flag_key?`, `field?`); the negative test fails if `actor_email|profile_id|actor_id|target_id|user_id` appears anywhere in the payload.
- **The cycle-3 ESLint rule banning `createAdminClient` outside `lib/` was the right default — and the right escape hatch is per-directory.** Don't relax the rule globally; extend `.eslintrc.json` with an `overrides` block for the legitimate exception scope (`app/(admin)/admin/**/_actions/*.ts`). Every other call site of the rule still triggers, and the override surface is readable in one place. Future ADRs adding new service-role escape points should add their own override entry rather than disabling per-file.
