# ADR-0035: Admin Operations Console

- **Status:** Accepted
- **Date:** 2026-05-15
- **Ratified:** 2026-05-15
- **Slice:** 4

> A single `/admin` console for `manager+` users that fronts every staff workflow that exists today but has no UI — verification queue, role assignment, audit log, feature flags, deletion requests — and provides the entry points for surfaces that other ADRs own (refunds via ADR-0036, dashboards via ADR-0014, tournament admin via ADR-0012).

## Context

Slices 1–3 shipped the substrate for staff workflows but no admin UI to drive them. The `profiles.role` enum (ADR-0003), the `auth.role_at_least()` ladder, the `audit_log` table (ADR-0006), the `withAudit` helper, the ID-verification schema (ADR-0009), the `feature_flags` table (ADR-0020), and the soft-delete + `del:<hash>` anonymization machinery (ADR-0023) are all on the disk and exercised by tests. None of them are reachable from a browser. There are **zero `/admin/**` routes** in `app/` today — `middleware.ts` pre-gates the `/admin` prefix at the auth layer, but the prefix resolves to a 404.

The cost of this gap is now load-bearing. ADR-0009 specifies a manual ID-verification queue staffed by `manager+`; that queue exists only as a Supabase Storage bucket plus a column on `profiles` until the queue UI ships. ADR-0027 publishes a refund-authority matrix that assumes admin tooling exists ("manager actions: refunds with audit, role changes, dispute responses…"). ADR-0023 promises members an export-and-deletion workflow that requires `manager+` to triage requests. Slice 4 cannot launch without this surface — every other ADR in this slice cycle (0020 flags, 0023 deletion, 0027 support, 0009 verification) has the admin console on its critical path.

This ADR is deliberately scoped to **the v1 critical-path admin console** — eight surfaces that the Slice 4 launch needs and nothing else. Tournament admin (ADR-0012), observability dashboards (ADR-0014), SMS history (ADR-0025), content-blocks editing, bulk operations, saved searches, and CSV export beyond the audit log are explicitly out of v1 and routed to a Slice 5 successor ADR. The cashier console (`/cashier`, ADR-0027 Tier 1) is a separate surface and is **not** part of this ADR — `cashier` role users do not see `/admin`.

A separate ADR-0036 owns the **Payment Management Console** — Stripe customer linkage, charge/refund mechanics, subscription overrides, invoice resends. This ADR defines only the entry point (a "Refunds" action on a member detail page) that hands off into the ADR-0036 surface; ADR-0036 owns the actual mutation.

## Decision

**We will build a unified `/admin` console for `manager+` users that fronts the eight critical-path staff workflows** — member list/search, member detail, role assignment, ID-verification queue, audit log viewer, refund entry point, feature flag toggles, and privacy/deletion request handling — **wired to existing infrastructure (ADR-0003 role ladder, ADR-0006 audit log, ADR-0009 verification schema, ADR-0020 flag table, ADR-0023 soft-delete) with no new business-domain tables**. The console ships in four sub-slices (A → D) of Slice 4, each independently shippable through the conductor.

## Information Architecture

```
/admin                       dashboard / quick links (manager+)
/admin/members               member list + search (manager+)
/admin/members/[id]          member detail page (manager+)
/admin/verifications         ID verification queue (manager+)
/admin/audit-log             audit log viewer (manager+, read-only)
/admin/flags                 feature flag toggles (manager+)
/admin/privacy               deletion request queue (manager+)
```

Every route is gated by `requireRole('manager')` in the page's RSC (defense in depth on top of the middleware path-gate). `cashier` users hitting any `/admin/**` path get an `InsufficientRoleError` and a 403; they have their own `/cashier` console per ADR-0027.

### `/admin` — dashboard

- **Role gate:** `manager+`
- **Data shown:** count of pending verifications, count of pending deletion requests, count of active kill-switch flags, last 5 audit log rows. All counts are cached for 30s via `unstable_cache` (revalidate by tag on the corresponding write paths).
- **Mutations:** none.
- **Audit events:** none (read-only).

### `/admin/members` — list + search

- **Role gate:** `manager+`
- **Data shown:** paginated table of profiles. Columns: `full_name`, `email`, `member_number` (when issued), `role`, `id_verified_at`, `created_at` (rendered UTC + Central per ADR-0034), membership status (joined from `memberships`), `deleted_at` indicator.
- **Filters:** status (`pending_verification | active | past_due | canceled | deleted`), role (`member | cashier | manager | owner`), free-text search across `full_name` and `email` (case-insensitive, ILIKE prefix match on first 64 chars; no third-party search index in v1).
- **Mutations:** none on the list page — click-through to detail.
- **Audit events:** none (read-only; per ADR-0006 "What does NOT get logged: Read access").

### `/admin/members/[id]` — member detail

- **Role gate:** `manager+`
- **Data shown:** profile fields (read-only), membership status + current period (joined from `memberships`), time-bank balance (joined from `time_wallets`), last 20 audit-log rows for this `target_id` (recent activity), last 5 payments (read-only summary; deep link to ADR-0036 payments console for mutations).
- **Mutations available:**
  - Promote/demote role (gates through the refund-authority matrix in ADR-0027 — see [Permission Matrix](#permission-matrix))
  - Trigger ID re-verification request (sets `id_verified_at = NULL`, sends email — wired to ADR-0009 + ADR-0025)
  - Open refund flow (deep link to ADR-0036 surface; no mutation in this ADR)
  - Open delete-account dialog (gates through ADR-0023 soft-delete flow)
- **Audit events emitted:** `admin.member.role_changed`, `admin.member.reverification_requested`, `admin.member.deletion_initiated` (the deletion mutation itself is owned by `/admin/privacy` — see below).

### `/admin/verifications` — ID verification queue

- **Role gate:** `manager+`
- **Data shown:** paginated list of profiles where `id_verified_at IS NULL AND id_doc_uploaded_at IS NOT NULL` (i.e. uploaded but not yet reviewed). Each row: signed thumbnail URL of the ID document (1-hour TTL, server-signed per ADR-0009), DOB-with-21-check banner, full name, email, upload timestamp (UTC + Central).
- **Mutations:**
  - Approve → writes `id_verified_at = now()`, generates `member_number` via the Postgres sequence (ADR-0009), emits audit event, fires email-on-approval (ADR-0025).
  - Reject → writes `id_verification_rejected_at` + `id_verification_rejected_reason` (free-text from the reviewer), emits audit event, fires rejection email with reason + re-upload instructions.
  - Request more info → no schema mutation; sends an email + emits audit event.
- **Audit events emitted:** `admin.verification.approved`, `admin.verification.rejected`, `admin.verification.info_requested`.

### `/admin/audit-log` — audit log viewer

- **Role gate:** `manager+` (matches the `audit_log_select_manager` RLS policy in migration 0003).
- **Data shown:** paginated, descending by `created_at`. Columns: `created_at` (UTC primary, Central with `CDT`/`CST` annotation per ADR-0034), `actor_id` (resolved to `profiles.email` via join — service-role actions show "system"), `action`, `target_type`, `target_id`, expand-on-click for `before` / `after` JSON, `ip`, `user_agent`.
- **Filters:** action prefix (`admin.*`, `membership.*`, `profile.*`, etc.), actor (typeahead by email), target_type + target_id, date range (entered in club-local time, converted to UTC at query time per ADR-0034).
- **DST handling:** when the filter range intersects a fall-back seam, the table renders the "next 1 hour of rows occurred during the DST repeat" banner mandated by ADR-0034.
- **Mutations:** none — audit log is append-only by RLS policy and by ADR-0006 invariant.
- **Audit events emitted:** none (read of the audit log is not itself audited, per ADR-0006).

### `/admin/flags` — feature flag toggle

- **Role gate:** `manager+`
- **Data shown:** all rows from `feature_flags` (ADR-0020 schema). Columns: `key`, `enabled`, `percent`, `allowlist[]` count, `role_gate`, `owner`, `expires_at` (with stale-flag indicator if `>90d` at 0% or 100%), `updated_at` + `updated_by`.
- **Mutations:**
  - Toggle `enabled`
  - Set `percent` (0–100, constraint at DB layer per migration 0001)
  - Edit `allowlist[]` (add/remove profile UUIDs)
  - Set `role_gate` (one of `member | cashier | manager | owner | NULL`)
- **Audit events emitted:** `admin.flag.toggled`, `admin.flag.percent_changed`, `admin.flag.allowlist_changed`, `admin.flag.role_gate_changed`.

### `/admin/privacy` — deletion request queue

- **Role gate:** `manager+`
- **Data shown:** queue of pending deletion + export requests. v1 stores requests in a `privacy_requests` table (see [Data Model Deltas](#data-model-deltas)) created by this ADR. Columns: requester profile, kind (`export | delete`), submitted_at, status (`pending | in_progress | completed | rejected`).
- **Mutations:**
  - Approve export → generates a signed-URL JSON download (24hr TTL per ADR-0023), emails the link, marks request `completed`.
  - Approve deletion → invokes the existing `softDeleteProfile(profile_id)` flow (ADR-0023 + migration 0004), which writes `del:<hash>` tokens onto `full_name`, `email`, `phone`, sets `profiles.deleted_at`, and deletes the storage bucket entry for the ID document. Audit log row survives forever with the actor's UUID.
  - Reject → marks request `rejected`, captures a free-text reason, sends email.
- **Audit events emitted:** `admin.privacy.export_approved`, `admin.privacy.deletion_approved`, `admin.privacy.request_rejected`.

## Permission Matrix

Four-tier model from ADR-0003. **Cashiers never use this console** — they have a separate `/cashier` surface (ADR-0027 Tier 1). The matrix below covers `manager+` only inside `/admin`. Each row's authority level matches the [ADR-0027 refund-authority matrix](./0027-support-operations.md#refund-authority-matrix) where applicable; deviations are flagged.

| Surface / Action                                       | member | cashier | manager | owner |
|--------------------------------------------------------|--------|---------|---------|-------|
| Reach any `/admin/**` route                            |   —    |    —    |    ✓    |   ✓   |
| View member list / detail                              |   —    |    —    |    ✓    |   ✓   |
| Promote `member → cashier`                             |   —    |    —    |    —    |   ✓   |
| Promote `cashier → manager`                            |   —    |    —    |    —    |   ✓   |
| Promote `manager → owner`                              |   —    |    —    |    —    |   ✓   |
| Demote `cashier → member`                              |   —    |    —    |    ✓    |   ✓   |
| Demote `manager → cashier`                             |   —    |    —    |    —    |   ✓   |
| Approve / reject ID verification                       |   —    |    —    |    ✓    |   ✓   |
| Request ID re-verification                             |   —    |    —    |    ✓    |   ✓   |
| Read audit log                                         |   —    |    —    |    ✓    |   ✓   |
| Toggle feature flag (non-kill-switch)                  |   —    |    —    |    ✓    |   ✓   |
| Toggle `kill-*` feature flag                           |   —    |    —    |    ✓    |   ✓   |
| Approve data export request                            |   —    |    —    |    ✓    |   ✓   |
| Approve account deletion                               |   —    |    —    |    ✓    |   ✓   |
| Open refund entry point (handoff to ADR-0036)          |   —    |    —    |    ✓    |   ✓   |

**Role-change rule (ADR-0003 + ADR-0027 §refund-authority):** any **promotion** is owner-only. **Demotions one rung down the ladder** are `manager+`. Promoting `member → manager` directly is forbidden in v1 UI (must go via `member → cashier → manager`) — the audit trail then has two rows instead of one and the intermediate state is visible.

The role-ladder check is enforced in three layers (defense in depth):
1. UI hides the disallowed actions (`manager` users see no "Promote to owner" button).
2. Server action runs `requireRole('owner')` for owner-only promotions and `requireRole('manager')` for demotions.
3. Database trigger `profiles_protect_role_change` (migration 0002 / 0003) raises SQLSTATE `42501` if a non-manager+ caller attempts a role write — the third line of defense if the server action is bypassed.

## State Machines / Key Workflows

### Verification approval flow

```
        ┌─────────────────────┐
        │ uploaded            │  id_doc_uploaded_at IS NOT NULL
        │ (member-side)       │  id_verified_at IS NULL
        └──────────┬──────────┘  id_verification_rejected_at IS NULL
                   │
                   │  manager opens /admin/verifications
                   ▼
        ┌─────────────────────┐
        │ under_review        │  (UI-only state, no DB column)
        └──────────┬──────────┘
                   │
       ┌───────────┼─────────────┐
       │           │             │
   approve     reject       request_info
       │           │             │
       ▼           ▼             ▼
 ┌──────────┐ ┌──────────┐ ┌──────────────────┐
 │ approved │ │ rejected │ │ awaiting_info    │
 │          │ │          │ │ (email sent;     │
 │ writes:  │ │ writes:  │ │  no DB write —   │
 │ id_      │ │ id_      │ │  member can      │
 │ verified │ │ verifi-  │ │  re-upload)      │
 │ _at      │ │ cation_  │ │                  │
 │ +        │ │ rejected │ └──────────────────┘
 │ member_  │ │ _at +    │
 │ number   │ │ reason   │
 └──────────┘ └──────────┘
```

Approve and reject are mutually exclusive terminal states; `request_info` leaves the row in its original `uploaded` state and the member's next upload re-enters the queue.

### Role-change flow

```
  manager+ opens member detail page
            │
            ▼
   selects new role from dropdown
            │
            ▼
  client-side check: target rank
  vs. caller's authority
            │
   ┌────────┴────────┐
   │                 │
 allowed           denied (UI hides; defense in depth)
   │
   ▼
 confirmation dialog ("You are about to
   promote X from cashier to manager.")
            │
   confirm  │
            ▼
  server action: requireRole(needed)
            │
            ▼
  withAudit transaction:
   - SELECT current role FOR UPDATE
   - UPDATE profiles SET role = new_role
   - trigger profiles_protect_role_change
     fires → writes audit_log row
     ('profile.role_change')
   - server action ALSO writes
     audit_log row ('admin.member.
     role_changed') with surrounding
     context (actor IP, UA, dialog
     confirmation)
            │
            ▼
       success toast
```

Two audit rows per role change is deliberate: the trigger row (`profile.role_change`) is the structural record-of-record; the `admin.member.role_changed` row carries the admin-console context (which path, which dialog, the actor IP/UA from the request that wasn't visible to the trigger). Both rows reference the same `target_id`.

### Deletion-request flow

```
  member submits "Delete my account"
   from /profile/privacy (ADR-0023)
            │
            ▼
   INSERT INTO privacy_requests
   (kind='delete', status='pending')
            │
            ▼
  appears in /admin/privacy queue
            │
            ▼
   manager reviews; opens dialog
            │
   ┌────────┴────────┐
   │                 │
 approve           reject
   │                 │
   ▼                 ▼
 calls           writes
 softDelete-     status='rejected'
 Profile(id)     + reason; sends
 (ADR-0023):     rejection email;
  - profiles     emits audit
    full_name,   'admin.privacy.
    email,        request_rejected'
    phone =
    del:<sha>
  - deleted_at
    = now()
  - storage
    bucket
    entry
    deleted
  - audit row
    'admin.
    privacy.
    deletion_
    approved'
  - status =
    'completed'
            │
            ▼
   confirmation email to
   the (now-anonymized)
   email — sent to the
   pre-anonymization address
   captured in the request row
```

The privacy_request row keeps the pre-anonymization email so the confirmation email can be sent **after** the soft-delete commits. The audit log row carries the actor (manager) UUID forever; the deleted profile's UUID is referenced via `target_id` per ADR-0006.

## Data Model Deltas

The console is built on existing tables. **One new table is added** in this ADR.

### `privacy_requests` (new)

Slice 4 owns this table. It backs `/admin/privacy` and the member-side `/profile/privacy` submission flow.

```sql
CREATE TYPE privacy_request_kind_t   AS ENUM ('export', 'delete');
CREATE TYPE privacy_request_status_t AS ENUM ('pending', 'in_progress', 'completed', 'rejected');

CREATE TABLE privacy_requests (
    id              UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID                       NOT NULL REFERENCES profiles(id) ON DELETE NO ACTION,
    requester_email TEXT                       NOT NULL,   -- captured pre-anonymization
    kind            privacy_request_kind_t     NOT NULL,
    status          privacy_request_status_t   NOT NULL DEFAULT 'pending',
    submitted_at    TIMESTAMPTZ                NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ                NULL,
    resolved_by     UUID                       NULL REFERENCES auth.users(id) ON DELETE NO ACTION,
    reject_reason   TEXT                       NULL,
    export_url      TEXT                       NULL        -- signed URL, 24hr TTL
);

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE  ROW LEVEL SECURITY;

CREATE POLICY privacy_requests_select_self_or_manager ON privacy_requests
    FOR SELECT USING (profile_id = auth.uid() OR auth.role_at_least('manager'));

CREATE POLICY privacy_requests_insert_self ON privacy_requests
    FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY privacy_requests_update_manager ON privacy_requests
    FOR UPDATE USING (auth.role_at_least('manager'))
    WITH CHECK (auth.role_at_least('manager'));

CREATE INDEX privacy_requests_status_idx ON privacy_requests (status, submitted_at);
```

The `requester_email` is captured at submission so the confirmation email after a deletion approval can still be addressed (the `profiles.email` is `del:<hash>` post-anonymization). `ON DELETE NO ACTION` on `profile_id` prevents a deleted profile from cascading away its own request row — the request is part of the audit-equivalent trail.

### Other schema changes — none

- No `admin_search_recents` table in v1. Saved searches are deferred to the Slice 5 successor ADR (see [Open Questions](#open-questions--deferred)).
- No `helpdesk_tickets` table in v1. ADR-0027 names the shared inbox + SMS as the v1 ticketing mechanism — building a tickets table without a workflow engine is premature.
- No additions to `profiles` — `id_verification_rejected_at` and `id_verification_rejected_reason` are already added in the ADR-0009 Slice 2 migration set (verified by reading migrations 0002 + 0004; if absent at implementation time, that's a Slice 2 backfill, not new schema owned by this ADR).
- No additions to `feature_flags` — migration 0001 already covers everything `/admin/flags` needs.

## API Contracts

All server actions live in `app/(admin)/admin/_actions/`. Every action runs `requireRole(...)` first, then `withAudit` for the mutation. Route handlers are avoided where a server action suffices (per ADR-0001 / Next.js 14 conventions).

```ts
// app/(admin)/admin/members/_actions/searchMembers.ts
import 'server-only';
export async function searchMembers(params: {
  q?: string;
  status?: 'pending_verification' | 'active' | 'past_due' | 'canceled' | 'deleted';
  role?: Role;
  page?: number;        // default 1
  pageSize?: number;    // default 25, max 100
}): Promise<{
  rows: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
}>;
// Role gate: requireRole('manager')
// Audit event: none (read-only)
```

```ts
// app/(admin)/admin/members/[id]/_actions/changeRole.ts
import 'server-only';
export async function changeRole(params: {
  profileId: string;
  newRole: Role;
}): Promise<{ ok: true }>;
// Role gate: requireRole('owner') for promotions; requireRole('manager') for
//            one-rung demotions to a role still at or above 'member'.
// Implementation: opens a transaction, uses withAudit('admin.member.role_changed', ...).
//                 The DB trigger profiles_protect_role_change ALSO writes
//                 'profile.role_change' in the same tx.
// Throws: InsufficientRoleError, RoleLadderViolation (e.g., demoting an owner
//         when caller is owner-but-self — owner cannot demote self in v1).
```

```ts
// app/(admin)/admin/verifications/_actions/approveVerification.ts
import 'server-only';
export async function approveVerification(params: {
  profileId: string;
}): Promise<{ ok: true; memberNumber: number }>;
// Role gate: requireRole('manager')
// Side effects (single tx):
//   - UPDATE profiles SET id_verified_at = now(), member_number = nextval(...)
//   - withAudit('admin.verification.approved', 'profile', profileId, ...)
// Post-commit (best-effort, NOT in tx): enqueue welcome email (ADR-0025).
```

```ts
// app/(admin)/admin/verifications/_actions/rejectVerification.ts
import 'server-only';
export async function rejectVerification(params: {
  profileId: string;
  reason: string;   // 1..500 chars; surfaced to member verbatim
}): Promise<{ ok: true }>;
// Role gate: requireRole('manager')
// Audit event: 'admin.verification.rejected'
```

```ts
// app/(admin)/admin/verifications/_actions/requestVerificationInfo.ts
import 'server-only';
export async function requestVerificationInfo(params: {
  profileId: string;
  message: string;  // 1..1000 chars; emailed to member
}): Promise<{ ok: true }>;
// Role gate: requireRole('manager')
// Audit event: 'admin.verification.info_requested'
// No DB column mutation — the email is the action.
```

```ts
// app/(admin)/admin/audit-log/_actions/queryAuditLog.ts
import 'server-only';
export async function queryAuditLog(params: {
  actionPrefix?: string;
  actorEmail?: string;
  targetType?: string;
  targetId?: string;
  fromUtc?: string;    // ISO string, inclusive
  toUtc?: string;      // ISO string, exclusive
  page?: number;
  pageSize?: number;   // default 50, max 200
}): Promise<{ rows: AuditRow[]; total: number; page: number; pageSize: number }>;
// Role gate: requireRole('manager') — matches audit_log_select_manager policy.
// Read-only; no audit event emitted.
```

```ts
// app/(admin)/admin/flags/_actions/updateFlag.ts
import 'server-only';
export async function updateFlag(params: {
  key: string;
  enabled?: boolean;
  percent?: number;       // 0..100
  allowlist?: string[];   // profile UUIDs
  roleGate?: Role | null;
}): Promise<{ ok: true }>;
// Role gate: requireRole('manager')
// Side effects (single tx):
//   - UPDATE feature_flags SET ... WHERE key = $1
//   - withAudit('admin.flag.toggled' | '.percent_changed' | '.allowlist_changed'
//               | '.role_gate_changed', 'feature_flag', key, ...)
// Emits ONE audit row per call, with the action chosen by which field changed
// (most specific first; .toggled wins over the rest if 'enabled' changed).
// Invalidates the in-memory flag cache via the existing lib/flags/ refresh
// channel (ADR-0020).
```

```ts
// app/(admin)/admin/privacy/_actions/approveExport.ts
import 'server-only';
export async function approveExport(params: {
  requestId: string;
}): Promise<{ ok: true; expiresAt: string }>;
// Role gate: requireRole('manager')
// Side effects (single tx for the status update, async generation outside tx):
//   - UPDATE privacy_requests SET status='in_progress' WHERE id = $1
//   - withAudit('admin.privacy.export_approved', 'privacy_request', id, ...)
// Post-tx: generates signed URL via Supabase Storage (24hr TTL), updates
//          status='completed' + export_url in a second tx, sends email.
```

```ts
// app/(admin)/admin/privacy/_actions/approveDeletion.ts
import 'server-only';
export async function approveDeletion(params: {
  requestId: string;
  confirmEmail: string;   // typed-confirmation pattern; must match requester_email
}): Promise<{ ok: true }>;
// Role gate: requireRole('manager')
// Side effects (single tx):
//   - SELECT profile_id, requester_email FROM privacy_requests WHERE id=$1 FOR UPDATE
//   - assert confirmEmail === requester_email  (else throw)
//   - call softDeleteProfile(profile_id)  [ADR-0023 helper]
//   - UPDATE privacy_requests SET status='completed', resolved_at=now(), resolved_by=$actor
//   - withAudit('admin.privacy.deletion_approved', 'profile', profile_id, ...)
// Post-tx: send confirmation email to the captured requester_email.
```

```ts
// app/(admin)/admin/privacy/_actions/rejectRequest.ts
import 'server-only';
export async function rejectRequest(params: {
  requestId: string;
  reason: string;
}): Promise<{ ok: true }>;
// Role gate: requireRole('manager')
// Audit event: 'admin.privacy.request_rejected'
```

```ts
// app/(admin)/admin/members/[id]/_actions/requestReverification.ts
import 'server-only';
export async function requestReverification(params: {
  profileId: string;
  reason: string;
}): Promise<{ ok: true }>;
// Role gate: requireRole('manager')
// Side effects (single tx):
//   - UPDATE profiles SET id_verified_at = NULL WHERE id = $1
//   - withAudit('admin.member.reverification_requested', 'profile', profileId, ...)
// Post-tx: enqueue re-verification email (ADR-0025) with reason.
```

```ts
// app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts
import 'server-only';
export async function openRefundFlow(params: {
  profileId: string;
  scope: 'membership' | 'time_bank' | 'tournament_entry';
}): Promise<{ redirectTo: string }>;
// Role gate: requireRole('manager')
// No mutation here — emits an audit-trail breadcrumb that the admin
// CLICKED INTO the refund flow, then redirects to the ADR-0036 surface
// which owns the actual refund mechanic and its own audit events.
// Audit event: 'admin.refund.flow_opened'
```

Every action above runs with the cookie-scoped supabase client (`lib/supabase/server.ts`) so RLS evaluates against the caller. The `createAdminClient()` service-role escape hatch (`lib/supabase/admin.ts`) is used **only** by `softDeleteProfile` (which needs to bypass RLS to write `del:<hash>` tokens) and is wrapped inside a `requireRole('manager')` call per the file's own comment.

## Authentication & Authorization

Three gates compose. None alone is sufficient; together they're defense in depth.

1. **Middleware path gate** (`middleware.ts`, already shipped):
   ```ts
   const GATED_PREFIXES = ['/dashboard', '/profile', '/admin'] as const;
   ```
   Unauthenticated requests to `/admin/**` redirect to `/login?next=<encoded>`. The middleware does NOT check role — it only checks session presence. Role enforcement is the RSC's job.

2. **MFA assertion (ADR-0002 + ADR-0003):** staff sessions must carry `aal=aal2`. The admin RSC layout (`app/(admin)/admin/layout.tsx`) checks the session's AAL claim and redirects to `/login/mfa-challenge` if `aal < aal2`. **No `/admin/**` page renders content over an `aal1` session.**

3. **RSC role check** (`requireRole('manager')` at the top of every admin RSC):
   ```ts
   // app/(admin)/admin/layout.tsx
   export default async function AdminLayout({ children }: { children: React.ReactNode }) {
     await requireRole('manager');  // throws InsufficientRoleError → 403 page
     // ... render shell ...
   }
   ```
   Per `lib/auth/requireRole.ts`, no profile → redirect to `/login?next=<path>`; profile rank below `manager` → `InsufficientRoleError` → 403.

4. **Database RLS** is the fourth gate, evaluated on every query. A bug in the RSC role check still cannot expose `audit_log` rows to a non-`manager+` caller because `audit_log_select_manager` denies the read at the database. Per ADR-0003: *"A bug in our application code can't expose another member's data — RLS catches it."*

### Self-edit prevention

A `manager` viewing their own member detail page MUST NOT see role-change controls for themselves. An `owner` viewing their own page MUST NOT see "Demote to manager" controls (no self-demotion in v1 — there must always be at least one owner). Both are UI-gated; the server actions ALSO refuse `profileId === session.user.id` for role changes (return a `SelfEditViolation` error). This is an additional, explicit invariant beyond the role-ladder check — losing the last owner is a recovery scenario that requires a service-role intervention, not an admin-console action.

## Audit Event Taxonomy

Every mutation in `/admin` emits exactly one `audit_log.action` from this list. Naming follows the `<surface>.<entity>.<verb>` dotted form used elsewhere (e.g. `membership.cancel`, `profile.role_change`).

| `audit_log.action`                        | Emitted by                                      | Target type        |
|-------------------------------------------|-------------------------------------------------|--------------------|
| `admin.member.role_changed`               | `changeRole` server action                      | `profile`          |
| `admin.member.reverification_requested`   | `requestReverification`                         | `profile`          |
| `admin.member.deletion_initiated`         | member-detail "delete" dialog (precursor)       | `profile`          |
| `admin.verification.approved`             | `approveVerification`                           | `profile`          |
| `admin.verification.rejected`             | `rejectVerification`                            | `profile`          |
| `admin.verification.info_requested`       | `requestVerificationInfo`                       | `profile`          |
| `admin.flag.toggled`                      | `updateFlag` (when `enabled` changed)           | `feature_flag`     |
| `admin.flag.percent_changed`              | `updateFlag` (when `percent` changed)           | `feature_flag`     |
| `admin.flag.allowlist_changed`            | `updateFlag` (when `allowlist` changed)         | `feature_flag`     |
| `admin.flag.role_gate_changed`            | `updateFlag` (when `role_gate` changed)         | `feature_flag`     |
| `admin.privacy.export_approved`           | `approveExport`                                 | `privacy_request`  |
| `admin.privacy.deletion_approved`         | `approveDeletion`                               | `profile`          |
| `admin.privacy.request_rejected`          | `rejectRequest`                                 | `privacy_request`  |
| `admin.refund.flow_opened`                | `openRefundFlow` (handoff to ADR-0036)          | `profile`          |
| `admin.session.entered`                   | admin layout RSC (first request per tab/session)| `session`          |
| `admin.session.role_check_denied`         | `requireRole` throw on `/admin/**`              | `session`          |

`profile.role_change` (the DB-trigger-emitted action from migration 0003) is NOT in this list — it's owned by ADR-0006 / migration 0003, not by this console. Both rows co-exist for every role change; that duplication is by design (see [Role-change flow](#role-change-flow)).

The `admin.session.role_check_denied` event captures attempted access from `member` and `cashier` users — useful for both forensics ("did someone try to brute-force the admin URL?") and product analytics ("are cashiers confused about where their console is?").

## UI Conventions

- **Date rendering:** every timestamp shows **UTC primary** with **America/Chicago annotated** (CDT/CST per ADR-0034). Tables sort by UTC; Central is a display column with the offset annotation; the repeated-hour banner ships verbatim from ADR-0034 §audit-log-presentation-contract.
- **Money rendering:** all money values render through `formatMoney(c: Cents)` from `lib/money/types.ts` (ADR-0004). Never raw `${cents}` in any admin component — the ADR-0004 lint rule covers this.
- **Empty states:** every list has an empty state with the literal copy "No rows match these filters." Loading states use Suspense + a table skeleton.
- **Error toasts:** server-action throws surface as a top-of-page toast (sonner). `InsufficientRoleError` shows "You don't have permission for that." (no role names leaked). All other errors show "Something went wrong. Tracking ID: `<sentry_event_id>`."
- **Confirmation dialogs:** mandatory for **every** destructive or escalating action — role change, verification reject, deletion approval, kill-switch toggle. Pattern is a typed-confirmation: the dialog requires the actor to type a short literal ("approve", or in the deletion case, the requester's email) before the action button enables. This is the same pattern used in `/profile/privacy` for self-deletion.
- **Tables are virtualized** at >100 rows (react-virtual). The audit log can easily exceed 100k rows; pagination plus virtualization keeps the viewer responsive.

## Observability Hooks

Per ADR-0014:

- **Sentry:** every `/admin/**` route tagged with `surface=admin`. Server-action exceptions surface in Sentry with `action=<server_action_name>`, `actor_role=<role>` (never email — PII redaction per ADR-0014). p95 latency tracked per server action; alert at >2× baseline for 10 min.
- **PostHog:** four events with `surface=admin`:
  - `admin_session_entered` (one per tab session)
  - `admin_action_attempted` (`action`, `target_type`, `outcome ∈ ok | denied | error`)
  - `admin_verification_decision` (`decision ∈ approve | reject | request_info`, `queue_depth_at_decision`)
  - `admin_flag_changed` (`flag_key`, `field`, `before`, `after`)
  PostHog events fire **after** consent gate (ADR-0024). Staff users do consent at signup (no marketing-banner footgun) — events fire for them.
- **Vercel function logs:** server-action invocations log `{ action, actor_id, target_id, duration_ms, ok|err }` as structured JSON. The audit log is the record-of-record; Vercel logs are for diagnostic speed (the audit row may not have been committed yet when the function returns; the log line is the easier first-look).
- **PII redaction:** Sentry `beforeSend` already redacts `email`, `phone`, `dob`, `id_doc_path` (ADR-0014). The admin console adds `requester_email` (from `privacy_requests`) and `reject_reason` / `info_request_message` to the redaction list — free-text fields can contain PII.

## Testing Strategy

The console has three test surfaces.

**RLS contract tests** (`tests/db/rls-admin-*.test.ts`, pglite substrate):
- A `cashier`-roled session SELECT against `audit_log` returns 0 rows (`audit_log_select_manager` policy).
- A `manager`-roled session SELECT against `audit_log` returns rows.
- A `member`-roled session UPDATE against `feature_flags` raises SQLSTATE `42501` (no policy allows it).
- A `cashier`-roled session UPDATE against `profiles SET role = 'owner'` raises SQLSTATE `42501` (the `profiles_protect_role_change` trigger).
- A `manager`-roled session UPDATE against `profiles SET role = 'owner'` succeeds; an audit_log row with `action='profile.role_change'` is written in the same transaction.

**Role-gate unit tests** (`tests/auth/admin-routes.test.ts`, mocked headers + supabase client):
- `requireRole('manager')` in the admin layout redirects unauthenticated requests to `/login?next=...`.
- `member` and `cashier` profiles throw `InsufficientRoleError`.
- `manager` and `owner` profiles pass.
- The `aal=aal2` check fires before the role check (an `aal1` `manager` session redirects to `/login/mfa-challenge`, not 403).

**Playwright E2E** (`tests/e2e/admin-*.spec.ts`):

1. **Verification queue happy path**
   - Seed: a member with `id_doc_uploaded_at IS NOT NULL`, `id_verified_at IS NULL`.
   - Steps: manager logs in (MFA challenge cleared via seeded TOTP), navigates to `/admin/verifications`, clicks Approve, confirms in dialog.
   - Assertions: row disappears from queue; `profiles.id_verified_at` is set; `profiles.member_number` is set; one `audit_log` row with `action='admin.verification.approved'` and one with `actor_id` = manager's UUID exists; welcome email enqueued.

2. **Role-change with audit assertion**
   - Seed: a `member`-roled profile; an `owner`-roled manager session.
   - Steps: owner opens member detail, selects "Promote to cashier", types "approve" in confirmation, clicks confirm.
   - Assertions: two `audit_log` rows exist — `action='profile.role_change'` (trigger) AND `action='admin.member.role_changed'` (server action), both referencing the same `target_id` and the owner's `actor_id`. The trigger row's `before` shows `{"role":"member"}`, the trigger row's `after` shows `{"role":"cashier"}`. The server-action row carries `ip` and `user_agent`.

3. **Deletion request processing**
   - Seed: a `privacy_requests` row with `kind='delete'`, `status='pending'`.
   - Steps: manager opens `/admin/privacy`, opens the request, types the requester's email in the confirmation field, clicks "Approve deletion".
   - Assertions: `profiles.deleted_at` is set; `full_name`, `email`, `phone` start with `del:` prefix; the ID document blob is gone from Supabase Storage; `privacy_requests.status='completed'`; an `audit_log` row with `action='admin.privacy.deletion_approved'` exists; the confirmation email is sent to the pre-anonymization address.

4. **Feature flag kill-switch toggle**
   - Seed: a `kill-stripe-webhook` flag with `enabled=false`.
   - Steps: manager opens `/admin/flags`, toggles the flag on, types "enable" in confirmation.
   - Assertions: `feature_flags.enabled=true`; an `audit_log` row with `action='admin.flag.toggled'`, `before={"enabled":false}`, `after={"enabled":true}` exists; the in-memory flag cache refresh fires (verified by reading the flag value via `/api/health` immediately after).

Accessibility tests (axe-core via Playwright, ADR-0026) run against every admin page in CI. Each page must score zero violations at "serious" or "critical" severity.

## Slice Plan

The console ships in four sub-slices of Slice 4. Each is independently shippable, each ends in a conductor green-light, each gates the next.

### Slice 4A — Shell + members list + member detail (read-only)

- Route group `app/(admin)/` with `app/(admin)/admin/layout.tsx` (the role-gated shell)
- `app/(admin)/admin/page.tsx` — dashboard with placeholder counts
- `app/(admin)/admin/members/page.tsx` — list + search + filters
- `app/(admin)/admin/members/[id]/page.tsx` — read-only detail
- Server actions: `searchMembers`, `getMemberDetail` (read-only)
- No mutations in this slice; no new audit events; no schema changes.
- Tests: role-gate unit tests, RLS contract tests (read paths), Playwright "manager can see the dashboard and a member detail page" smoke.

### Slice 4B — Verification queue + audit log viewer

- `app/(admin)/admin/verifications/page.tsx`
- `app/(admin)/admin/audit-log/page.tsx`
- Server actions: `approveVerification`, `rejectVerification`, `requestVerificationInfo`, `queryAuditLog`
- Audit events: `admin.verification.*` (×3)
- Schema: none (ADR-0009's columns already exist).
- Tests: verification happy-path E2E; audit log filter E2E (UTC range across DST seam — the banner appears); RLS contract test that audit log is invisible to `cashier`.

### Slice 4C — Role assignment + feature-flag toggle + deletion-request handling

- `app/(admin)/admin/flags/page.tsx`
- `app/(admin)/admin/privacy/page.tsx`
- Server actions: `changeRole`, `requestReverification`, `updateFlag`, `approveExport`, `approveDeletion`, `rejectRequest`
- Audit events: `admin.member.*`, `admin.flag.*`, `admin.privacy.*`
- Schema: migration adds `privacy_requests` table (per [Data Model Deltas](#data-model-deltas)).
- Tests: role-change-with-audit E2E; deletion-request E2E; kill-switch E2E; RLS contract test that `privacy_requests` is invisible to other members.

### Slice 4D (optional) — Polish + observability + accessibility audit

- Refund-flow entry-point handoff to ADR-0036 (the link, not the surface): `openRefundFlow` action + member-detail UI.
- PostHog event wiring (the four admin events listed above).
- Sentry tag wiring per [Observability Hooks](#observability-hooks).
- Full axe-core sweep on every admin page; fix all serious + critical violations.
- Audit event `admin.refund.flow_opened` and `admin.session.entered`, `admin.session.role_check_denied`.
- This slice is optional in the sense that 4A + 4B + 4C is launchable; 4D is the production-grade pass.

## Consequences

**Positive:**

- Every Slice-1-through-3 ADR that named "manager+ console" as a downstream consumer (ADR-0009 verification, ADR-0020 flags, ADR-0023 deletion, ADR-0027 support) now has a place to live. The Slice 4 launch unblocks itself.
- Defense-in-depth is structural: middleware → AAL check → `requireRole` RSC → DB RLS. A bug in any one layer is caught by the next.
- Every mutation in the console writes an audit row in the same transaction via `withAudit`. Forensic reconstruction of an admin's day is one query: `SELECT * FROM audit_log WHERE actor_id = $1 AND action LIKE 'admin.%' ORDER BY created_at`.
- Role-change events emit **two** audit rows — one from the trigger (structural), one from the server action (contextual). Disputes get the full record without either layer alone being load-bearing.
- The `privacy_requests` table is the only new schema; everything else reuses what's already on disk. Migration risk is bounded.
- v1 scope is locked tight: eight surfaces, one new table, sixteen audit events. The Slice 5 successor ADR (admin-console-v2) has a clear seam to extend from.

**Negative:**

- **Two audit rows per role change** is intentional but visually noisy in the audit log viewer. The viewer filters default to hiding `profile.role_change` when an `admin.member.role_changed` row exists for the same `target_id` within a 1-second window (UI-only collapse; both rows remain in the DB). Documented as a known viewer convention; if forensic clarity needs both rows visible, the filter is one click away.
- **No bulk operations in v1.** Approving 20 verifications means 20 clicks. Acceptable at expected v1 volume (ADR-0009 names "20 pending verifications" as the escalation threshold to a KYC vendor — at that depth, single-row approval is still tractable). Bulk is in the Slice 5 successor.
- **No saved searches, no CSV export beyond audit log.** Acceptable for v1; the audit log CSV export covers the only export use case where a regulator-style downloadable record is actually needed.
- **Manual role-ladder enforcement at three layers** (UI, server action, DB trigger) means three places to keep in sync. Mitigation: the `ROLE_RANK` constant in `lib/auth/types.ts` is the single source for UI + server-action; the SQL trigger is asserted by the RLS contract tests above. A new role added to the ladder fails CI in three places if any layer is missed.
- **`/admin/flags` writes flow through the cookie-scoped supabase client, not the service-role client.** This is correct (manager+ has GRANT on `feature_flags` via the implicit `authenticated` role) but inconsistent with the comment in `supabase/migrations/0001_feature_flags.sql` that said writes would use the service-role key. The migration comment was Slice-1 forecasting; this ADR amends it. If a future need arises to write flags from a non-authenticated context (e.g., an alerting bot flipping a kill-switch), that's a service-role escape-hatch added in a follow-up — not the v1 path.
- **`openRefundFlow` is a stub until ADR-0036 lands.** Slice 4D is gated on ADR-0036 acceptance; if ADR-0036 slips, Slice 4D ships without the refund handoff and the `admin.refund.flow_opened` event isn't emitted. No downstream ADR breaks — refunds happen via Stripe Dashboard in the meantime, exactly as ADR-0027 names the interim posture.

**What this ADR locks in:**

- The route shape `/admin/**` is the canonical admin surface; cashier surfaces live at `/cashier/**` per ADR-0027. No staff surface is added under any other prefix without a successor ADR.
- The action-naming dotted-form (`admin.<entity>.<verb>`) is the canonical taxonomy for admin-emitted audit events. Future audit events from new admin surfaces extend this taxonomy, do not invent a parallel one.
- The three-layer defense (middleware path-gate → RSC `requireRole` → DB RLS) is the canonical admin auth pattern. New admin pages must call `requireRole('manager')` (or `'owner'`) at the top of their RSC.

**What this ADR leaves open:**

- Bulk operations (deferred to Slice 5 successor).
- Saved searches and a `admin_search_recents` table (deferred).
- Tournament admin CRUD UI (ADR-0012 owns).
- Observability dashboards UI (ADR-0014 owns).
- SMS history viewer (ADR-0025 owns).
- Content-blocks editor (deferred to whichever ADR owns content; this console does not edit `content_blocks`).
- Stripe disputes mirror (ADR-0027 explicitly defers this; Stripe Dashboard remains the v1 disputes UI).

## Open Questions / Deferred

- **Bulk verification approve** — deferred. v1 sticks to single-row approval; the queue depth threshold for switching to a KYC vendor (ADR-0009 §open-questions) is 50/week, well below the volume where bulk-approve is the ergonomics win. Re-evaluate at the Slice-5 successor ADR.
- **Saved searches / pinned filters** — deferred. The four filter modes (status, role, free-text, date-range) cover every v1 use case. A `admin_search_recents` table is described above as schema-prepared but not built.
- **Content-blocks editor** — deferred. Privacy policy, member agreement, marketing copy all live in `content_blocks` (per ADR-0023, ADR-0009). v1 edits these via direct migration; an editor UI is a Slice-5 concern.
- **Custom reports / CSV export beyond audit log** — deferred. Audit log CSV is the only export the regulator-facing use case requires; product-analytics reports run through PostHog.
- **Cashier read-only view of the admin console** — declined for v1. Cashiers escalate by emailing the manager helpdesk (ADR-0027). A read-only "what would I see if I were a manager" mode is a leak surface (cashier sees audit log → cashier learns refund amounts → privacy gradient) without a corresponding workflow win. Re-evaluate only if support volume forces it.
- **Admin activity dashboard** ("show me what each manager has done in the last 7 days") — deferred to ADR-0014's Slice-4 observability dashboards.
- **Per-action confirmation thresholds based on the ADR-0027 refund-authority matrix** — partly implemented (typed-confirmation for destructive actions). A future enhancement could surface the authority threshold inline ("This refund of $250 requires owner approval — escalating to owner now."). Tracked for Slice 5.
- **Self-demotion / last-owner protection** — invariant is named above (no owner can demote self in v1, the server action refuses). A formal "always at least one owner" DB constraint is deferred — the application invariant is the v1 enforcement; if a future incident shows the application invariant was bypassed, escalate to a DB-level CHECK.

A Slice 5 successor ADR (working title: `0040-admin-console-v2.md`) will own the deferred items above. This ADR explicitly does NOT enumerate that successor's contents — that's the successor's job.

## References

- **ADR-0001** — Tech stack & deployment. Next.js 14 App Router + Supabase. Provides the route-group convention used here (`(admin)`).
- **ADR-0002** — Authentication & session management. MFA aal=aal2 requirement for staff; cookie-scoped supabase clients; `lib/supabase/server.ts` + `lib/supabase/admin.ts`.
- **ADR-0003** — Authorization model — roles + RLS. The `role_t` enum, the `auth.role_at_least()` ladder, the three-layer defense pattern; the protection trigger on `profiles.role`.
- **ADR-0004** — Money handling — integer cents. `formatMoney(c: Cents)` is the only money renderer used in the admin UI.
- **ADR-0006** — Audit log — append-only. The `audit_log` table, the `audit_log_select_manager` RLS policy, the `withAudit` helper this console uses for every mutation.
- **ADR-0009** — Member identity & ID verification. The `/admin/verifications` queue wires to the schema and storage bucket ADR-0009 owns.
- **ADR-0014** — Observability. Sentry tags, PostHog events, PII redaction posture.
- **ADR-0020** — Feature flags. The `feature_flags` table and the `/admin/flags` toggle surface.
- **ADR-0023** — Privacy, GDPR/CCPA, data deletion. The soft-delete machinery and the `del:<hash>` anonymization; this console's `/admin/privacy` queue surfaces those workflows.
- **ADR-0026** — Accessibility. axe-core in CI; every admin page must hit zero serious/critical violations.
- **ADR-0027** — Support operations. The refund-authority matrix that gates role changes and refund authority; the cashier-vs-admin surface split.
- **ADR-0034** — Timestamp & timezone policy. UTC primary, Central annotated in every admin date display; the audit log DST-seam banner is verbatim from ADR-0034.
- **ADR-0036** *(separate, in-flight)* — Payment Management Console. `openRefundFlow` hands off here; this ADR owns the entry-point breadcrumb only.
