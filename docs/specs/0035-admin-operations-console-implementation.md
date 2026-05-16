---
adr: 0035
slice: 4
risk: high
# Acceptance commands MUST be runnable shell commands that exit 0 only when
# every numbered acceptance criterion is satisfied. The validator runs each
# one in order during the slice/integration pass; scope-judge refuses to
# return ship_ready=true if any was not run-and-passed.
#
# Runtime-deferred per ADR-0017 (CI/CD) ratification — the Windows host
# cannot bind port 3000 (Hyper-V / WinNAT reserves 2983–3082). Following
# the ADR-0023 precedent, this slice ships vitest + RTL + pglite RLS
# contract tests as structural substitutes for the ADR-0035 §Testing
# Strategy "Playwright E2E" scenarios. Playwright E2E is NOT in scope and
# rides on ADR-0017's CI venue.
acceptance_commands:
  - 'pnpm typecheck'
  - 'pnpm lint'
  - 'pnpm migrate:check'
  - 'pnpm test'
  - 'pnpm test tests/migrations/admin-privacy-requests-shape.test.ts'
  - 'pnpm test tests/db/rls-privacy-requests.test.ts'
  - 'pnpm test tests/db/rls-feature-flags.test.ts'
  - 'pnpm test tests/auth/admin-routes.test.ts'
  - 'pnpm test tests/admin/'
  # - 'pnpm test:e2e admin'   # deferred — CI-only per ADR-0017
---

# Spec: Admin Operations Console (ADR-0035 slice 4)

- **ADR:** [0035](../adr/0035-admin-operations-console.md)
- **Status:** Draft
- **Date:** 2026-05-15

## Goal

Ship the **`/admin` operations console** — a `manager+`-gated unified
surface fronting the eight critical-path staff workflows (dashboard,
member list/search, member detail, ID-verification queue, audit-log
viewer, refund entry point, feature-flag toggles, privacy/deletion
requests) — wired to the already-shipped substrate (ADR-0003 role
ladder + RLS, ADR-0006 audit log + `withAudit`, ADR-0009 verification
schema, ADR-0020 `feature_flags`, ADR-0023 `softDeleteProfile`) with
**one new table** (`privacy_requests`), **sixteen audit event types**,
and **three layers of defense** (middleware path-gate → RSC
`requireRole` → DB RLS), so every Slice-1-through-3 ADR that named
"manager+ console" as a downstream consumer now has a place to live.
ADR-0036 (payment management) is in-flight; the refund entry point
ships as a stub redirect with a single breadcrumb audit event that
gracefully degrades when ADR-0036 has not landed.

## Acceptance criteria

Numbered, testable. Each AC names the file (or source-grep target)
that verifies it. Style mirrors `docs/specs/0023-privacy-gdpr-implementation.md`:
exact file paths, function signatures, error branches, a11y contracts.

### Schema layer

1. **Migration `supabase/migrations/0005_privacy_requests.sql`** exists,
   follows the `NNNN_<snake_case>.sql` naming convention (after the
   existing `0001..0004` migrations), and applies cleanly when fed
   (after migrations 0002, 0003, 0004) to a fresh pglite instance via
   `pg.exec()`. Contents:
   - `CREATE TYPE privacy_request_kind_t AS ENUM ('export', 'delete');`
   - `CREATE TYPE privacy_request_status_t AS ENUM ('pending', 'in_progress', 'completed', 'rejected');`
   - `CREATE TABLE privacy_requests (...)` with the exact column set
     pinned in ADR-0035 §Data Model Deltas:
     `id UUID PK DEFAULT gen_random_uuid()`,
     `profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE NO ACTION`,
     `requester_email TEXT NOT NULL`,
     `kind privacy_request_kind_t NOT NULL`,
     `status privacy_request_status_t NOT NULL DEFAULT 'pending'`,
     `submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
     `resolved_at TIMESTAMPTZ NULL`,
     `resolved_by UUID NULL REFERENCES auth.users(id) ON DELETE NO ACTION`,
     `reject_reason TEXT NULL`,
     `export_url TEXT NULL`.
   - `ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;`
   - `ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;`
   - Three policies, verbatim names (the names are load-bearing — RLS
     tests grep for them):
     `privacy_requests_select_self_or_manager` (FOR SELECT) USING
     `(profile_id = auth.uid() OR auth.role_at_least('manager'))`;
     `privacy_requests_insert_self` (FOR INSERT) WITH CHECK
     `(profile_id = auth.uid())`;
     `privacy_requests_update_manager` (FOR UPDATE) USING + WITH CHECK
     `auth.role_at_least('manager')`. **NO DELETE policy** — privacy
     requests are an audit-equivalent trail and must not be deleted.
   - `CREATE INDEX privacy_requests_status_idx ON privacy_requests (status, submitted_at);`
   - `COMMENT ON TABLE privacy_requests IS '...'` documenting the
     ADR-0035 ownership and the `requester_email`-captured-pre-anonymization
     invariant.

   Verified by `pnpm test tests/migrations/admin-privacy-requests-shape.test.ts`
   (regex tier + pg-query-emscripten AST tier mirroring
   `tests/migrations/audit-log-shape.test.ts`) and the `beforeAll` of
   `pnpm test tests/db/rls-privacy-requests.test.ts`.

2. **Migration `supabase/migrations/0006_feature_flags_rls.sql`** exists
   and applies cleanly. It closes the gap between ADR-0035's required
   posture (`/admin/flags` writes via the cookie-scoped supabase client)
   and the cycle-1 comment in `0001_feature_flags.sql` that said writes
   would use the service-role key. Contents:
   - `ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;`
   - `ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;`
   - `CREATE POLICY feature_flags_select_authenticated ON feature_flags
      FOR SELECT USING (auth.uid() IS NOT NULL);` — every authenticated
     caller can read flags (the in-memory eval path needs read access).
   - `CREATE POLICY feature_flags_write_manager ON feature_flags
      FOR ALL USING (auth.role_at_least('manager'))
                WITH CHECK (auth.role_at_least('manager'));` — only
     `manager+` may INSERT / UPDATE / DELETE rows.
   - `COMMENT ON TABLE feature_flags IS '...'` amending the cycle-1
     comment ("Writes flow through cookie-scoped client per ADR-0035
     §Consequences; service-role retains BYPASSRLS for emergency repair.").

   Verified by `pnpm test tests/db/rls-feature-flags.test.ts`. The
   `0001_feature_flags.sql` migration is NOT rewritten — drift is
   resolved forward via `0006_feature_flags_rls.sql` per ADR-0018
   migration policy.

3. **`pnpm migrate:check`** passes on both new migrations. They are
   purely additive at the type / table / index / policy level. `ENABLE
   RLS` on a previously-RLS-disabled table (`feature_flags`) may
   require a `migration-review: rls-enable-approved` acknowledgement
   comment if the scanner flags it — the worker adds the comment with
   text justifying why the change is safe (the table has no production
   writers yet that depended on the un-RLS'd posture; the in-memory
   `lib/flags/registry.ts` reader is unaffected).

### Auth & role-gate layer

4. **`app/(admin)/admin/layout.tsx`** exists as an RSC and is the
   sole entrypoint for every `/admin/**` route. Contract:
   - **First statement of the body MUST be `await requireRole('manager');`**
     — verified by source-grep in `tests/auth/admin-routes.test.ts`.
     `requireRole('manager' | 'owner')` itself encapsulates the AAL
     assertion: as part of "what it means to require a manager+
     role," the helper reads the session's `aal` claim and, if
     `aal < 'aal2'`, calls `redirect('/login/mfa-challenge?next=' + encoded path)`
     BEFORE returning. (Per ADR-0035 §Auth: no `/admin/**` page
     renders content over an `aal1` session.) The AAL check is
     therefore part of the role-gate, not a separate sibling check
     — there is one gate, one first-statement, and AAL is a
     sub-property of "requireRole('manager')" specifically.
     `lib/auth/requireRole.ts` is amended in this slice to perform
     the AAL assertion when the required minimum is `manager+`
     (no behavior change for `member`/`cashier` callers — those
     do not require `aal2`). See AC34 cross-ref for the audit
     events emitted from inside `requireRole` on the AAL and
     role-deny paths.
   - **MFA route fallback (Open Q 7):** if `/login/mfa-challenge`
     does not exist at ship time (ADR-0002 cycle 4 has not landed),
     `requireRole` falls through to `redirect('/login/mfa-pending')`
     — a static page that renders "MFA enrollment required —
     please contact the owner." This is a graceful degradation so
     the conductor cycle is NOT blocked on an external ADR. The
     fallback path is pinned in `lib/auth/requireRole.ts` via a
     route-existence probe (`await fs-resolve` on
     `app/login/mfa-challenge/page.tsx` at module init), OR via a
     `MFA_CHALLENGE_READY: boolean` constant in
     `lib/auth/mfa-availability.ts` (planner picks; recommend the
     constant pattern, mirroring `PAYMENTS_CONSOLE_READY`).
   - Renders the shared admin shell: top nav (Dashboard, Members,
     Verifications, Audit log, Flags, Privacy), a logo+role badge in
     the header (showing the actor's role), and `{children}`.
   - Throws `InsufficientRoleError` for `member` and `cashier` →
     renders the existing 403 page (the framework error-boundary
     contract from ADR-0003 slice 1).
   - On the first request per browser tab/session, `requireRole`
     emits an `admin.session.entered` audit event (Slice 4D-eligible
     — see AC34). On `InsufficientRoleError` throws, `requireRole`
     emits `admin.session.role_check_denied` (Slice 4D-eligible —
     see AC34).

   Verified by `tests/auth/admin-routes.test.ts`: unauthenticated
   redirect to `/login?next=...`; `member` and `cashier` throw
   `InsufficientRoleError`; `manager` and `owner` (with `aal2`) pass;
   `aal1` `manager` session redirects to `/login/mfa-challenge`;
   when `MFA_CHALLENGE_READY === false`, `aal1` `manager` redirects
   to `/login/mfa-pending` instead; source-grep asserts the
   layout's first body statement is `await requireRole('manager')`
   AND that the AAL-check call (`session.aal`) appears inside
   `lib/auth/requireRole.ts`, NOT inside `layout.tsx`.

5. **Every admin RSC under `app/(admin)/admin/**/page.tsx`** AND
   **every admin server action under `app/(admin)/admin/**/_actions/*.ts`**
   calls `requireRole('manager')` (or `'owner'` for owner-gated
   pages/actions) **as the very first `await`-expression in the
   exported function's body**, independently of the layout's guard.
   This is defense-in-depth — a future refactor that accidentally
   inlines the layout, or a worker who slips a DB read before the
   gate, must not silently bypass the role check.

   Verified by a vitest test at
   `tests/auth/admin-routes-defense-in-depth.test.ts` that walks
   both the `app/(admin)/**/page.tsx` set and the
   `app/(admin)/**/_actions/*.ts` set and asserts:
   - **(existence)** every file matches
     `/await\s+requireRole\(\s*['"](manager|owner)['"]\s*\)/`.
   - **(first-await)** the FIRST `await` token in the exported
     function's body is the `await requireRole(...)` call. The
     check uses a first-token walker over the function body
     (parsed via the existing `typescript` AST package already in
     devDependencies, OR via a sturdy regex: trim the body, locate
     the first occurrence of `\bawait\b`, assert it is followed
     within 40 characters by `requireRole(`). The walker pattern
     is preferred — pin to AST for robustness; regex fallback is
     planner-acceptable. The `layout.tsx` is exempt from the
     page-level check (it is the layout's own check), but is
     still asserted in AC4. Test files (`*.test.ts`, `*.test.tsx`)
     and barrel re-exports are excluded.

6. **Middleware path-gate behavior is unchanged.** `middleware.ts`'s
   `GATED_PREFIXES = ['/dashboard', '/profile', '/admin']` MUST
   remain. The middleware does NOT check role — it only checks
   session presence — and continues to redirect unauthenticated
   `/admin/**` requests to `/login?next=<encoded>`. Verified by the
   existing `tests/auth/middleware.test.ts` continuing to pass
   (cross-cutting regression — see AC30).

### Surface 1 — `/admin` dashboard (Slice 4A)

7. **`app/(admin)/admin/page.tsx`** renders the manager+ dashboard
   with four cards and a recent-activity panel:
   - **Pending verifications** card: count of profiles where
     `id_verified_at IS NULL AND id_doc_uploaded_at IS NOT NULL`.
     Clicking the card navigates to `/admin/verifications`.
   - **Pending deletion requests** card: count of `privacy_requests`
     rows where `status = 'pending'` AND `kind = 'delete'`. Clicking
     navigates to `/admin/privacy`.
   - **Active kill-switch flags** card: count of `feature_flags`
     rows where `key LIKE 'kill-%' AND enabled = true`. Clicking
     navigates to `/admin/flags?prefix=kill-`.
   - **Recent activity** panel: last 5 `audit_log` rows ordered by
     `created_at DESC` (no filter — staff sees everything they have
     RLS access to). Each row shows action, target_type, target_id,
     and the UTC + Central timestamp per ADR-0034.
   - All counts are cached via `unstable_cache(..., [...], { revalidate: 30 })`
     keyed by tag (`admin-dashboard-counts`) so the write paths can
     invalidate via `revalidateTag('admin-dashboard-counts')` —
     verified by source-grep on the page file.

   Verified by `tests/admin/dashboard-page.test.tsx`: mock the four
   queries; assert each card renders the count; click each card and
   assert `next/navigation` `push` was called with the expected path;
   assert the page calls `requireRole('manager')`.

### Surface 2 — `/admin/members` list + search (Slice 4A)

8. **`app/(admin)/admin/members/page.tsx`** renders a paginated
   `manager+`-gated table backed by the server action
   `searchMembers(params)`. Columns (in order):
   `full_name`, `email`, `member_number` (when issued — falls back to
   `—`), `role`, `id_verified_at` (UTC+Central per ADR-0034, "Not
   verified" when null), `created_at` (UTC+Central), membership
   `status` (joined; falls back to `—` if no membership), `deleted_at`
   indicator (a "deleted" pill when non-null). Filters: `status`
   (select: pending_verification | active | past_due | canceled |
   deleted | any), `role` (member | cashier | manager | owner | any),
   free-text `q` (case-insensitive ILIKE prefix on
   `full_name` OR `email`, capped at 64 chars at the action layer per
   ADR-0035 §`/admin/members`). Page size 25 (max 100). Sort: `created_at DESC`.

   Verified by `tests/admin/members-list-page.test.tsx` (RTL):
   renders all 8 columns; renders the three filter controls; submit
   triggers `searchMembers` with the expected params; pagination
   buttons fire `?page=N` updates; the "deleted" pill appears for
   rows with non-null `deleted_at`; the action `requireRole('manager')`
   is asserted via mock.

9. **Server action `app/(admin)/admin/members/_actions/searchMembers.ts`**
   has signature (load-bearing, do not weaken):

   ```ts
   import 'server-only';
   export async function searchMembers(params: {
     q?: string;
     status?: 'pending_verification' | 'active' | 'past_due' | 'canceled' | 'deleted';
     role?: Role;
     page?: number;        // default 1, min 1
     pageSize?: number;    // default 25, max 100
   }): Promise<{
     rows: MemberRow[];
     total: number;
     page: number;
     pageSize: number;
   }>;
   ```

   Properties:
   - `import 'server-only';` at top of file.
   - First runtime statement is `await requireRole('manager');`.
   - `q` is trimmed and lower-cased; if length > 64 chars after trim,
     truncate to 64 (not throw — graceful UX).
   - Reads via `createClient()` (cookie-scoped — RLS evaluates
     against caller; no service-role bypass).
   - Returns `total` from a parallel `count(*)` query against the same
     filter set for pagination math.
   - **NO audit event** — read-only per ADR-0006.
   - On a malformed `page` / `pageSize` (negative, non-integer), the
     action clamps to defaults rather than throwing. Type pins this
     via parse step at function entry.

   Verified by `tests/admin/search-members-action.test.ts`: mocks the
   supabase client; asserts the SQL filter shape (`ilike` against both
   columns when `q` provided, role filter when role provided, etc.);
   asserts `requireRole('manager')` is called via mock; asserts
   `q` is truncated at 64 chars (positive test: input 80 chars,
   asserted query param is 64).

### Surface 3 — `/admin/members/[id]` member detail (Slice 4A → mutations land in 4C)

10. **`app/(admin)/admin/members/[id]/page.tsx`** renders the
    manager+-gated detail view for a profile. Sections:
    - **Profile** (read-only `<dl>`): `full_name`, `email`,
      `member_number`, `role`, `dob`, `created_at`, `id_verified_at`
      (all timestamps UTC+Central per ADR-0034).
    - **Membership** (joined from `memberships`): status, current
      period start/end if active. Renders "No membership" when
      absent.
    - **Time bank** (joined from `time_wallets`): current balance
      rendered via `formatMoney` (ADR-0004 — never raw cents).
      Renders "No wallet" when absent.
    - **Recent activity** (joined from `audit_log` filtered to
      `target_id = profile.id`): last 20 rows, ordered
      `created_at DESC`.
    - **Recent payments** (joined from `payments` if the table
      exists; for Slice 4A, falls back to "Payment integration
      pending — see ADR-0010 / 0036." inline message).
    - **Actions panel** (mutations land in Slice 4C — see AC15-18):
      Promote role, Demote role, Request re-verification, Open
      refund flow, Delete account. In Slice 4A these render as
      disabled buttons with a "Available in Slice 4C" hover tip.
      Slice 4C wires the action handlers.

    Self-edit guard (UI-level): if the rendered profile's `id` ===
    `session.user.id`, the entire Actions panel renders a banner
    "You cannot perform admin actions against your own profile" and
    the buttons are hidden. (Server-side defense duplicates this in
    AC15.)

    Verified by `tests/admin/member-detail-page.test.tsx`: renders
    all five sections; the Profile section's timestamps appear with
    both UTC and Central; the self-edit banner appears when
    `session.user.id === profile.id`; the action buttons are hidden
    in the self-edit case.

### Surface 4 — `/admin/verifications` queue (Slice 4B)

11. **`app/(admin)/admin/verifications/page.tsx`** renders the
    ID-verification queue. Backed by a server-side query selecting
    profiles where
    `id_verified_at IS NULL AND id_doc_uploaded_at IS NOT NULL AND id_verification_rejected_at IS NULL`
    (i.e. uploaded but neither approved nor rejected). Each row:
    - Signed thumbnail URL of the ID document (1-hour TTL, generated
      via Supabase Storage signed URL per ADR-0009 — server-side, not
      bundled into client). The URL is set on each row's data prop;
      the `<img>` element receives `referrerPolicy="no-referrer"` and
      `alt="ID document thumbnail for {member email}"`.
    - DOB-with-21-check banner: green check if `dob` < now() - 21
      years, red warning otherwise (the banner copy is verbatim per
      ADR-0009: "AGE OK" or "UNDER 21 — REJECT").
    - Full name, email, upload timestamp (UTC+Central per ADR-0034).
    - Three action buttons: **Approve**, **Reject**, **Request more info**
      — each opens a typed-confirmation dialog (AC12-14).
    Empty state: "No rows match these filters." (per ADR-0035 §UI
    Conventions). Loading state: Suspense + table skeleton.

    **Signed-URL failure mode (error branch):** signed-URL
    generation per row is wrapped in `try/catch`. If the Supabase
    Storage signed-URL call throws (5xx, network blip,
    rate-limit, expired-key), the row renders a placeholder
    "Thumbnail unavailable — refresh" (verbatim copy) in place of
    the `<img>` element. The Approve / Reject / Request more info
    buttons **remain active and clickable** on the failed-thumbnail
    row — the staff member can still act on the row's metadata
    (DOB 21+ banner, full name, email, upload timestamp) without
    seeing the document; the action handlers do not depend on the
    thumbnail URL. The DOB 21+ banner is rendered from the
    profile's `dob` column, not the signed URL, so it is unaffected.
    The row's `<tr>` element receives `data-thumb-failed="true"`
    for test discovery.

    Verified by `tests/admin/verifications-page.test.tsx`: renders
    rows with the four pieces of data; the 21+ banner renders red
    when DOB < 21 years and green otherwise; the empty state copy
    is the literal string; the buttons trigger their respective
    dialogs; **when the signed-URL generator rejects for a given
    row, the row renders the "Thumbnail unavailable — refresh"
    placeholder AND the Approve / Reject buttons remain
    actionable (assert click handler fires).**

12. **Server action `app/(admin)/admin/verifications/_actions/approveVerification.ts`**:

    ```ts
    import 'server-only';
    export async function approveVerification(params: {
      profileId: string;
    }): Promise<{ ok: true; memberNumber: number }>;
    ```

    - First statement `await requireRole('manager');`.
    - Self-edit guard: if `profileId === session.user.id`, throw
      `SelfEditViolation('cannot approve own verification')`.
    - Inside `withAudit('admin.verification.approved', 'profile', profileId, ...)`
      (one tx; mutation + audit row atomic):
      - `SELECT id_verified_at FROM profiles WHERE id = $1 FOR UPDATE`
        — capture `before`.
      - `UPDATE profiles SET id_verified_at = now(), member_number = nextval('member_number_seq') WHERE id = $1`
        (the sequence name is owned by ADR-0009; if absent at
        implementation time, the worker emits a TODO and uses a
        portable `(SELECT COALESCE(MAX(member_number), 0) + 1 FROM profiles)`
        fallback wrapped in a planner-confirmed comment).
      - `SELECT id_verified_at, member_number FROM profiles WHERE id = $1`
        — capture `after`.
    - Post-tx (best-effort, NOT in tx): `revalidateTag('admin-dashboard-counts')`
      and enqueue welcome email per ADR-0025 (currently a stub — ADR-0025
      is blocked; the action MAY skip the email step with a TODO).
    - Audit `before` / `after` carry **only timestamps and the
      member number** — no PII (`full_name`, `email`, `phone`, `dob`)
      in the snapshot.
    - On `withAudit` throw: caller's tx rolls back; action re-throws
      to the page-level error boundary (existing toast pattern).

    Verified by `tests/admin/approve-verification-action.test.ts`
    (pglite-backed): first call mutates and writes audit row with
    `action='admin.verification.approved'`; second call on same row
    is idempotent (or returns the existing `memberNumber` — pin the
    behavior in the worker's implementation; recommend: idempotent
    no-op when `id_verified_at IS NOT NULL`, return the existing
    `memberNumber`); self-edit attempt throws; audit `before` /
    `after` JSON does not match `/email|full_name|phone|dob/`.

13. **Server action `app/(admin)/admin/verifications/_actions/rejectVerification.ts`**:

    ```ts
    import 'server-only';
    export async function rejectVerification(params: {
      profileId: string;
      reason: string;   // 1..500 chars; surfaced to member verbatim
    }): Promise<{ ok: true }>;
    ```

    - First statement `await requireRole('manager');`.
    - Self-edit guard (as AC12).
    - Validates `reason` length 1..500 (reject 0 or >500 with a
      structured error — `RejectReasonInvalid`).
    - Inside `withAudit('admin.verification.rejected', 'profile', profileId, ...)`:
      `UPDATE profiles SET id_verification_rejected_at = now(),
       id_verification_rejected_reason = $2 WHERE id = $1`.
      (The two columns are owned by ADR-0009 — if absent, fall back
      per AC12.)
    - `before` / `after`: `{ id_verification_rejected_at: null }` →
      `{ id_verification_rejected_at: '<iso>' }`. The `reason` text
      is included in the audit `after` but PII redaction (Sentry)
      treats `reject_reason` as redactable per ADR-0035 §Observability.
      The audit row keeps the verbatim text — it is the staff's
      authored content, not the member's PII.

    Verified by `tests/admin/reject-verification-action.test.ts`:
    reason length validation; audit row written; idempotency on
    repeated calls (re-reject overwrites `reason` and writes a
    second audit row — that is the documented behavior).

14. **Server action `requestVerificationInfo`** at
    `app/(admin)/admin/verifications/_actions/requestVerificationInfo.ts`:

    ```ts
    import 'server-only';
    export async function requestVerificationInfo(params: {
      profileId: string;
      message: string;  // 1..1000 chars; emailed to member
    }): Promise<{ ok: true }>;
    ```

    - First statement `await requireRole('manager');`.
    - No schema mutation — the email is the action.
    - Inside `withAudit('admin.verification.info_requested', 'profile', profileId, ...)`:
      writes the audit row with `before = null`, `after = { message_length: <int> }`
      (the verbatim message is NOT stored in the audit row to avoid
      forever-retention of staff prose; only the length is recorded
      as a forensic breadcrumb).
    - Post-tx: enqueue email per ADR-0025 (stub — ADR-0025 blocked).

    Verified by `tests/admin/request-verification-info-action.test.ts`:
    message length validation 1..1000; audit row contains only
    `message_length` in `after`; no `message` substring in the audit
    record.

### Surface 5 — `/admin/members/[id]` mutations (Slice 4C)

15. **Server action `changeRole`** at
    `app/(admin)/admin/members/[id]/_actions/changeRole.ts`:

    ```ts
    import 'server-only';
    export async function changeRole(params: {
      profileId: string;
      newRole: Role;
    }): Promise<{ ok: true }>;
    ```

    - **First runtime statement is `await requireRole('manager');`**
      (every `/admin/**` caller must already be `manager+`; this is
      the outer auth gate that AC5's first-await test asserts on
      this file).
    - Reads `session.user.id` via `createClient().auth.getUser()`.
    - **Self-edit guard:** if `profileId === session.user.id`, throw
      `SelfEditViolation('cannot change own role')`. (Owner cannot
      demote self in v1 — there must always be at least one owner;
      the application invariant is the v1 enforcement per ADR-0035
      §Self-edit prevention.)
    - Reads the target's current role:
      `SELECT role FROM profiles WHERE id = $1` (outside the audit
      tx — used only for ladder-math; the tx re-reads with `FOR UPDATE`).
    - **Role-ladder authority refine** (second gate; runs AFTER the
      outer `requireRole('manager')` and AFTER the target's current
      role is known — it is a refine, NOT a replacement):
      - Compute `currentRank = ROLE_RANK[currentRole]`,
        `newRank = ROLE_RANK[newRole]`.
      - Promotion (`newRank > currentRank`): require an additional
        `await requireRole('owner');` (owner-only authority for
        upward role moves).
      - Demotion of one rung (`newRank === currentRank - 1`): the
        outer `requireRole('manager')` already covers — no refine.
      - Demotion of >1 rung (e.g. `owner → member` skipping `manager`
        and `cashier`): **forbidden in v1 UI** — throw
        `RoleLadderViolation('multi-rung demotion not allowed in v1')`.
      - No-op (`newRank === currentRank`): early return `{ ok: true }`
        (no audit row).
    - Inside `withAudit('admin.member.role_changed', 'profile', profileId, ...)`:
      `SELECT role FROM profiles WHERE id = $1 FOR UPDATE` → before;
      `UPDATE profiles SET role = $2 WHERE id = $1`;
      `SELECT role FROM profiles WHERE id = $1` → after.
      The DB trigger `profiles_protect_role_change` (cycle-1 +
      cycle-3 rewrite) **also** writes a `profile.role_change`
      audit row in the same tx — two audit rows per role change is
      the documented invariant (ADR-0035 §Role-change flow,
      ADR-0006 §audit taxonomy).
    - Audit `before` / `after`: only `{ role }` — no PII.

    Verified by `tests/admin/change-role-action.test.ts`
    (pglite-backed):
    - Promotion as `manager` → throws `InsufficientRoleError`.
    - Promotion as `owner` → succeeds; **two** audit rows exist
      (`profile.role_change` and `admin.member.role_changed`) both
      targeting the same profile and same actor (the owner).
    - Demotion `cashier → member` as `manager` → succeeds.
    - Demotion `manager → cashier` as `manager` → throws
      `InsufficientRoleError`.
    - Demotion `manager → cashier` as `owner` → succeeds.
    - Multi-rung demotion `owner → member` → throws
      `RoleLadderViolation`.
    - Self-edit attempt → throws `SelfEditViolation`.
    - Audit `before` / `after` JSON does not contain
      `/email|full_name|phone|dob/`.

16. **Server action `requestReverification`** at
    `app/(admin)/admin/members/[id]/_actions/requestReverification.ts`:

    ```ts
    import 'server-only';
    export async function requestReverification(params: {
      profileId: string;
      reason: string;
    }): Promise<{ ok: true }>;
    ```

    - `requireRole('manager')`; self-edit guard.
    - Inside `withAudit('admin.member.reverification_requested', 'profile', profileId, ...)`:
      `UPDATE profiles SET id_verified_at = NULL WHERE id = $1`.
      `before = { id_verified_at: '<iso or null>' }`,
      `after = { id_verified_at: null }`. `reason` is NOT in audit
      (length-only per AC14 pattern).
    - Post-tx: enqueue re-verification email per ADR-0025 (stub).

    Verified by `tests/admin/request-reverification-action.test.ts`.

17. **Server action `openRefundFlow`** at
    `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts`:

    ```ts
    import 'server-only';
    export async function openRefundFlow(params: {
      profileId: string;
      scope: 'membership' | 'time_bank' | 'tournament_entry';
    }): Promise<{ redirectTo: string }>;
    ```

    - `requireRole('manager')`.
    - **No mutation** — emits one audit breadcrumb that the manager
      clicked into the refund flow. Inside `withAudit('admin.refund.flow_opened', 'profile', profileId, ...)`:
      `before = null`, `after = { scope }`, no SQL UPDATE.
    - Returns `{ redirectTo }`:
      - If ADR-0036 has landed and exposes a `/admin/payments/[id]/refund`
        route (detected via a static `lib/payments/console-availability.ts`
        constant `PAYMENTS_CONSOLE_READY: boolean = false` until ADR-0036
        flips it to `true`): return that path.
      - If `PAYMENTS_CONSOLE_READY === false`: return
        `'/admin/members/' + profileId + '?refund=pending-adr-0036'`
        and the page renders a toast: "Refund flow not yet available
        — see ADR-0036 (in flight)."
    - The audit row fires in **both** cases (the breadcrumb is the
      whole point of this action even before ADR-0036 lands).

    Verified by `tests/admin/open-refund-flow-action.test.ts`:
    asserts the audit row fires; asserts the redirect target degrades
    to the placeholder when `PAYMENTS_CONSOLE_READY` is false; asserts
    the action gates on `manager+`.

    **ADR-0036 coordination note:** ADR-0036's spec MUST include an
    AC that flips `PAYMENTS_CONSOLE_READY` to `true` in
    `lib/payments/console-availability.ts` upon ship; tracked as a
    planner coordination concern surfaced in
    `.conductor/0035/dispatches/0002-critic-spec.md` S8. The
    conductor session that drives ADR-0036 should verify this
    coordination AC is present in the ADR-0036 spec before
    accepting that spec.

18. **Member-detail UI wiring (Slice 4C):** the disabled buttons in
    AC10's Actions panel are replaced with active buttons that open
    typed-confirmation dialogs. Each dialog mirrors ADR-0024's
    cookie-banner customize-panel a11y pattern (Radix
    `AlertDialog`, focus on Cancel, Esc closes, `aria-modal="true"`).
    The typed-confirmation phrase per ADR-0035 §UI Conventions:
    - Role change: type `approve` to enable the destructive button.
    - Request reverification: type `approve`.
    - Open refund flow: no typed confirmation (it's a redirect, not
      a mutation).
    - Delete account: type the member's email address (matches the
      `approveDeletion` pattern in AC22).
    Self-edit: when `profile.id === session.user.id`, NONE of these
    buttons render — the AC10 banner is shown instead.

    Verified by `tests/admin/member-detail-dialogs.test.tsx` (RTL):
    each dialog opens; initial focus lands on Cancel; the destructive
    action button is disabled until the typed phrase matches; Esc
    closes; the server action is called with the correct params on
    confirm; the self-edit case hides all four buttons.

### Surface 6 — `/admin/audit-log` viewer (Slice 4B)

19. **`app/(admin)/admin/audit-log/page.tsx`** renders a paginated,
    descending-by-`created_at` audit log view, gated by
    `requireRole('manager')` (matching the
    `audit_log_select_manager` RLS policy). Columns: `created_at`
    (UTC primary, Central annotated with `CDT`/`CST` per ADR-0034),
    `actor_id` (resolved to `profiles.email` via LEFT JOIN — when
    NULL or the join misses, render literal "system"), `action`,
    `target_type`, `target_id`, `before`/`after` (expand-on-click,
    formatted JSON), `ip`, `user_agent`. Page size 50 (max 200).

    Filters: action prefix (text input — applied as `WHERE action LIKE $prefix || '%'`),
    actor email (typeahead — server action returns up to 10 profile
    matches), `target_type` + `target_id` (literal match),
    `fromCentral` + `toCentral` (datetime-local in club zone —
    converted to UTC at query time per ADR-0034).

    **DST handling:** when the filter range intersects a fall-back
    seam (`fromUtc` ≤ DST-end UTC moment ≤ `toUtc`), the table
    renders the verbatim ADR-0034 banner: "the next 1 hour of rows
    occurred during the DST repeat — sort is by UTC; Central times
    are not unique". The DST-detection helper lives at
    `lib/timestamps/dst-seam.ts` (new — see Touched-files).

    Verified by `tests/admin/audit-log-page.test.tsx` (RTL): mock 5
    audit rows; assert columns render; click an `actor_id` cell and
    assert the join-resolved email is shown; assert the expand-on-click
    JSON renders; submit a filter range that crosses 2026-11-01
    America/Chicago and assert the DST banner appears; submit a range
    that does not cross and assert the banner is absent.

20. **Server action `queryAuditLog`** at
    `app/(admin)/admin/audit-log/_actions/queryAuditLog.ts`:

    ```ts
    import 'server-only';
    export async function queryAuditLog(params: {
      actionPrefix?: string;
      actorEmail?: string;
      targetType?: string;
      targetId?: string;
      fromUtc?: string;
      toUtc?: string;
      page?: number;
      pageSize?: number;
    }): Promise<{ rows: AuditRow[]; total: number; page: number; pageSize: number }>;
    ```

    - `requireRole('manager')`.
    - Reads via `createClient()` cookie-scoped — RLS gates the SELECT
      per the existing `audit_log_select_manager` policy.
    - **NO audit event** — read-only per ADR-0006 §"What does NOT
      get logged: Read access".
    - When `actorEmail` provided, a sub-query resolves email →
      profile UUID via `SELECT id FROM profiles WHERE email = $1`
      (RLS allows `manager+` to read all profiles).
    - Sort: `created_at DESC`. Pagination via `total` from a
      `count(*)` on the same filter.

    Verified by `tests/admin/query-audit-log-action.test.ts`:
    asserts the SQL filter shape; asserts `manager`-roled session
    returns rows; **asserts `cashier`-roled session returns empty
    array** (cashier should never hit this action — but if it
    somehow does, RLS catches it).

### Surface 7 — `/admin/flags` toggles (Slice 4C)

21. **`app/(admin)/admin/flags/page.tsx`** renders the
    `feature_flags` table (post-AC2 RLS migration) with one row per
    flag. Columns: `key`, `enabled` (toggle), `percent` (slider 0-100),
    `allowlist[]` count (link to add/remove UUIDs), `role_gate`
    (select), `owner`, `expires_at` (UTC+Central; with a "STALE"
    pill if `expires_at < now() - 90d` AND `percent IN (0, 100)`),
    `updated_at` + `updated_by` (resolved to email). Each row is
    independently editable in-line (Save button per row).

    **Kill-switch typed-confirmation:** toggling a `key LIKE 'kill-%'`
    flag opens a typed-confirmation dialog requiring the user to
    type `enable` or `disable` (matching the action) before the
    save button enables. Non-kill flags save immediately on toggle.

    Verified by `tests/admin/flags-page.test.tsx` (RTL): renders
    rows from a mocked query; toggling a non-kill flag calls
    `updateFlag` immediately; toggling a `kill-stripe-webhook` flag
    opens the typed-confirmation dialog; the STALE pill renders when
    `expires_at` is >90d ago and `percent ∈ {0, 100}`.

22. **Server action `updateFlag`** at
    `app/(admin)/admin/flags/_actions/updateFlag.ts`:

    ```ts
    import 'server-only';
    export async function updateFlag(params: {
      key: string;
      enabled?: boolean;
      percent?: number;       // 0..100
      allowlist?: string[];   // profile UUIDs
      roleGate?: Role | null;
    }): Promise<{ ok: true }>;
    ```

    - `requireRole('manager')`.
    - At least one of the four optional fields must be present
      (otherwise throw `NoChange`).
    - Inside `withAudit('<event>', 'feature_flag', key, ...)`
      where `<event>` is selected by **most-specific-first**:
      - `enabled` changed → `admin.flag.toggled`
      - else `percent` changed → `admin.flag.percent_changed`
      - else `allowlist` changed → `admin.flag.allowlist_changed`
      - else `roleGate` changed → `admin.flag.role_gate_changed`
      Exactly ONE audit row per call. `before` / `after` carry only
      the changed columns + the `updated_at` / `updated_by` deltas;
      no PII.
    - SQL: `UPDATE feature_flags SET ..., updated_at = now(), updated_by = $actor WHERE key = $key`
      with only the provided columns set. Validates `percent ∈ [0, 100]`
      at the action layer in addition to the DB CHECK constraint.
    - Post-tx: invalidate the in-memory flag cache (currently no
      cache exists — `lib/flags/index.ts` reads from in-code
      registry, so this is a no-op TODO for the future Slice that
      wires the lib to the DB; the action emits a `console.log`
      breadcrumb noting the invalidation hook is pending).

    Verified by `tests/admin/update-flag-action.test.ts`
    (pglite-backed): each of the four mutation kinds produces the
    matching audit `action`; an `enabled`-only change produces
    exactly one `admin.flag.toggled` row; an `enabled` + `percent`
    multi-change produces exactly one `admin.flag.toggled` row
    (most-specific-first); a no-fields call throws `NoChange`; a
    `cashier`-roled session call throws `InsufficientRoleError`.

### Surface 8 — `/admin/privacy` deletion queue (Slice 4C)

23. **`app/(admin)/admin/privacy/page.tsx`** renders the
    `privacy_requests` queue filtered by `status = 'pending'`
    (default; toggle filter switches to `'in_progress' | 'completed' | 'rejected'`).
    Columns: requester profile (`full_name`, email — note: when
    `status='completed'` and `kind='delete'`, the profile is
    anonymized, so the row falls back to `requester_email` from
    the request itself), `kind`, `submitted_at` (UTC+Central).
    Actions:
    - For `kind='export', status='pending'`: **Approve export** →
      typed-confirmation `approve` → calls `approveExport`.
    - For `kind='delete', status='pending'`: **Approve deletion**
      → typed-confirmation requires the actor to type the request's
      `requester_email` (matches AC25 pattern).
    - For any `status='pending'`: **Reject** → typed-confirmation
      `reject` + free-text reason (1..500 chars).
    Empty state: "No pending privacy requests."

    Verified by `tests/admin/privacy-page.test.tsx` (RTL): renders
    rows from a mocked query; the export and delete approval
    dialogs require the correct typed phrase; the reject flow
    requires a reason (button stays disabled when reason is empty).

24. **Server action `approveExport`** at
    `app/(admin)/admin/privacy/_actions/approveExport.ts`:

    ```ts
    import 'server-only';
    export async function approveExport(params: {
      requestId: string;
    }): Promise<{ ok: true; expiresAt: string }>;
    ```

    - `requireRole('manager')`.
    - Inside `withAudit('admin.privacy.export_approved', 'privacy_request', requestId, ...)`:
      `SELECT profile_id, kind, status FROM privacy_requests WHERE id = $1 FOR UPDATE`;
      assert `kind = 'export'` AND `status = 'pending'`;
      `UPDATE privacy_requests SET status = 'in_progress', resolved_by = $actor WHERE id = $1`.
      Audit `before = { status: 'pending' }`, `after = { status: 'in_progress' }`.
    - **Post-tx (NOT in audit transaction):** generate a signed-URL
      JSON export (24hr TTL per ADR-0023) via the existing
      `/api/privacy/export` payload shape; the signed URL is
      `supabase.storage.from('privacy-exports').createSignedUrl(...)`
      with `expiresIn: 86400`. Then `UPDATE privacy_requests SET status = 'completed', resolved_at = now(), export_url = $url WHERE id = $1`
      in a second transaction.
    - Post-tx (best-effort): email the link to `requester_email`
      per ADR-0025 (stub).
    - Returns `{ ok: true, expiresAt: '<iso>' }`.

    Verified by `tests/admin/approve-export-action.test.ts`:
    state transitions `pending → in_progress → completed`; audit
    row fires only once (on the pending→in_progress transition);
    re-approving a `completed` request throws `RequestNotPending`.

25. **Server action `approveDeletion`** at
    `app/(admin)/admin/privacy/_actions/approveDeletion.ts`:

    ```ts
    import 'server-only';
    export async function approveDeletion(params: {
      requestId: string;
      confirmEmail: string;   // must match requester_email
    }): Promise<{ ok: true }>;
    ```

    - `requireRole('manager')`.
    - Inside `withAudit('admin.privacy.deletion_approved', 'profile', profile_id, ...)`:
      `SELECT profile_id, requester_email, kind, status FROM privacy_requests WHERE id = $1 FOR UPDATE`;
      assert `kind = 'delete'` AND `status = 'pending'`;
      **assert `confirmEmail === requester_email`** (else throw
      `ConfirmEmailMismatch` — the load-bearing typed-confirmation
      guard that prevents the wrong-user-deletion premortem); call
      `softDeleteProfile(profile_id, tx)` (ADR-0023 helper — the
      same tx via the structural `TransactionClient` interface);
      `UPDATE privacy_requests SET status = 'completed', resolved_at = now(), resolved_by = $actor WHERE id = $1`.
      Audit `before = { deleted_at: null }`,
      `after = { deleted_at: '<iso>', request_id: $requestId }`.
      **NO PII in audit** — `email`, `full_name`, `phone` MUST NOT
      appear in `before`/`after`. (Cross-cutting structural
      assertion below — AC28.)
    - Post-tx: send confirmation email to the captured
      `requester_email` per ADR-0025 (stub).
    - The action does NOT sign the deleted user out (the user is a
      different session than the actor's). If the user is currently
      signed in, their next page load picks up the anonymization
      and the existing middleware/session handling redirects.

    Verified by `tests/admin/approve-deletion-action.test.ts`
    (pglite-backed):
    - Happy path: `softDeleteProfile` was called; `profiles.deleted_at`
      is set; `full_name` / `email` / `phone` carry the `del:` prefix;
      `privacy_requests.status = 'completed'`; one audit row with
      `action='admin.privacy.deletion_approved'`.
    - Wrong `confirmEmail` → throws `ConfirmEmailMismatch`,
      `softDeleteProfile` NOT called, no audit row.
    - Re-approving a `completed` request → throws.
    - Audit `before` / `after` JSON does not match
      `/email|full_name|phone|dob/`.

26. **Server action `rejectRequest`** at
    `app/(admin)/admin/privacy/_actions/rejectRequest.ts`:

    ```ts
    import 'server-only';
    export async function rejectRequest(params: {
      requestId: string;
      reason: string;
    }): Promise<{ ok: true }>;
    ```

    - `requireRole('manager')`.
    - Validates `reason` length 1..500.
    - Inside `withAudit('admin.privacy.request_rejected', 'privacy_request', requestId, ...)`:
      `UPDATE privacy_requests SET status = 'rejected', resolved_at = now(), resolved_by = $actor, reject_reason = $reason WHERE id = $1 AND status = 'pending'`.
      Throws `RequestNotPending` if no row matched. Audit
      `after = { status: 'rejected', reject_reason_length: <int> }`
      — length-only per AC14 pattern.

    Verified by `tests/admin/reject-request-action.test.ts`.

### Cross-cutting structural ACs

27. **Audit event taxonomy is exhaustive and unique.** A vitest test
    at `tests/admin/audit-event-taxonomy.test.ts` greps all server
    actions under `app/(admin)/admin/**/_actions/*.ts` and asserts:
    - Every `withAudit(...)` call's `action` string appears in the
      sixteen-event taxonomy table from ADR-0035 §Audit Event Taxonomy
      (`admin.member.role_changed`, `admin.member.reverification_requested`,
      `admin.member.deletion_initiated`, `admin.verification.approved`,
      `admin.verification.rejected`, `admin.verification.info_requested`,
      `admin.flag.toggled`, `admin.flag.percent_changed`,
      `admin.flag.allowlist_changed`, `admin.flag.role_gate_changed`,
      `admin.privacy.export_approved`, `admin.privacy.deletion_approved`,
      `admin.privacy.request_rejected`, `admin.refund.flow_opened`,
      `admin.session.entered`, `admin.session.role_check_denied`).
    - No action uses a verb form outside this set.
    - No two distinct actions share the same string (uniqueness).
    Slice 4D events (`admin.session.entered`,
    `admin.session.role_check_denied`, `admin.member.deletion_initiated`,
    `admin.refund.flow_opened`) are present in the taxonomy even if
    not yet emitted by every code path — the taxonomy list is the
    contract; coverage is per-slice.

28. **No PII in any admin audit row (cross-cutting source-grep
    regression guard).** A vitest test at
    `tests/admin/no-pii-in-admin-audit.test.ts` reads the text of
    **every** server-action file under
    `app/(admin)/admin/**/_actions/*.ts` and asserts that the
    `before:` / `after:` object literals (or the return value of
    `mutate`'s `return { before, after, ... }`) do NOT contain
    the literal substrings `'email'`, `'full_name'`, `'phone'`,
    `'dob'`, `'reject_reason:'` (full text — only `_length` is
    allowed), `'message:'` (full text). This guards against a
    future "refactor for cleanliness" pass leaking PII into the
    forever-retained audit log. The check is coarse but high-signal.

29. **Role-ladder defense is structural at three layers.** A
    cross-cutting test at `tests/admin/role-ladder-defense.test.ts`
    asserts:
    - **UI layer:** the member-detail page renders no
      "Promote to owner" button when the rendered session is `manager`
      (asserted via the existing component test pattern).
    - **Server-action layer:** `changeRole` with a promotion target
      throws `InsufficientRoleError` when the session is `manager`
      (asserted via the AC15 mock).
    - **DB-trigger layer:** the existing
      `tests/db/rls-profiles.test.ts` already asserts that a
      `cashier`-roled session UPDATE on `profiles.role` raises
      SQLSTATE `42501` via the `profiles_protect_role_change`
      trigger (the cycle-1 contract; AC30 covers regression).
    This AC is the meta-pin that all three layers exist; if any one
    is missing, the test fails with a guidance message naming the
    missing layer.

30. **Cycle 1-3 regression — minimal-edit, zero-failure contract
    (mechanically verifiable).**
    The existing test suites (`tests/db/rls-profiles.test.ts`,
    `tests/db/audit-log.test.ts`, `tests/audit/with-audit.test.ts`,
    `tests/migrations/*.test.ts`, `tests/auth/*.test.ts`,
    `tests/consent/*.test.ts`, `tests/privacy/*.test.ts`) MUST
    continue to pass. The new migrations (0005, 0006) are additive
    at the table / type / index / policy level and do not touch
    existing schema. The new `app/(admin)/` route group is wholly new.

    **Mechanical contract (greppable, not human-judgment):**
    No `expect(...).toX(...)` call inside any cycle-1/2/3 test file
    (under `tests/db/`, `tests/audit/`, `tests/privacy/`,
    `tests/consent/`, `tests/migrations/`, `tests/auth/`) is
    **added, removed, or has its argument changed** during this
    slice. Mechanically verified by running
    `git diff --unified=0 origin/main -- tests/db/ tests/audit/ tests/privacy/ tests/consent/ tests/migrations/ tests/auth/`
    and filtering to lines matching `^[+-]\s+expect\(` — the
    filtered output MUST be empty. Whitespace-only changes,
    comment edits, and `import` reorganizations are permitted
    (they do not match the filter). Adding wholly new test
    files in these directories is permitted (the assertion is
    on `expect(...)` lines, not file presence).

    If any cycle-1/2/3 behavior test legitimately fails because
    of this slice, the failure must be reconciled by updating the
    spec (a new AC justifying the change), NOT by silently
    editing the assertion — silent test edits are a fidelity fail
    and the regression-diff check above catches them.

### Slice 4D (optional polish — recommend include)

31. **PostHog event wiring for the four admin events** named in
    ADR-0035 §Observability. Events fire **after** consent gate
    (ADR-0024 — staff users do consent at signup; the gate check
    is in `lib/analytics/consent-aware-track.ts`, which exists per
    ADR-0024). Events:
    - `admin_session_entered` — emitted from the layout RSC's first
      request per browser tab (deduplicated via a cookie
      `mopc-admin-session-seen` with 30-min TTL).
    - `admin_action_attempted` — emitted from each server action's
      entry point, with `outcome ∈ 'ok' | 'denied' | 'error'`.
    - `admin_verification_decision` — emitted from
      `approve|reject|requestVerificationInfo` with
      `decision` + `queue_depth_at_decision`.
    - `admin_flag_changed` — emitted from `updateFlag` with
      `flag_key`, `field`, `before`, `after`.

    Verified by `tests/admin/posthog-events.test.ts`: assert each
    event fires under the expected scenario with the expected
    payload shape; assert no event fires when
    `consent-aware-track` reports `granted: false`.

32. **Sentry tag wiring.** Every `/admin/**` route adds the tag
    `surface=admin` to the Sentry scope (via the existing
    `lib/observability/sentry.ts` `withScope` helper). Server-action
    exceptions add `action=<server_action_name>` and
    `actor_role=<role>` (NOT email — the ADR-0014 PII redaction
    list is the source-of-truth). The admin audit free-text fields
    (`reject_reason`, `info_request_message`, `requester_email`) are
    added to the Sentry `beforeSend` redaction list at
    `instrumentation.ts` (or wherever the `beforeSend` lives).
    Verified by `tests/admin/sentry-tags.test.ts`: mock the Sentry
    SDK and assert the tags are set; assert the
    `beforeSend`-redacted event payload does not contain
    `reject_reason` / `info_request_message` / `requester_email`
    values.

33. **axe-core a11y sweep on every admin page.** Each
    `app/(admin)/admin/**/page.tsx` ships with a co-located
    `*.a11y.test.tsx` (RTL render → run `axe(container)` from
    `@axe-core/playwright`'s jsdom-compatible companion or
    `vitest-axe`). **NO** "serious" or "critical" axe violations
    are permitted. The existing `tests/a11y/` directory holds the
    pattern (ADR-0026); mirror it under `tests/admin/a11y/`.
    Verified by `pnpm test tests/admin/a11y/`.

34. **`admin.session.entered` + `admin.session.role_check_denied`
    + `admin.member.deletion_initiated` + `admin.refund.flow_opened`
    audit events are emitted by their respective code paths.** The
    first two emit from inside `requireRole` (called by the layout
    — see AC4). The third emits from a concrete server action
    `initiateMemberDeletion` at
    `app/(admin)/admin/members/[id]/_actions/initiateMemberDeletion.ts`
    (signature + contract pinned below). The fourth is covered by
    AC17.

    **`initiateMemberDeletion` server action** (the manager-initiated
    deletion path documented in ADR-0035 §Deletion-request flow;
    the member self-deletion path remains `/profile/privacy` per
    ADR-0023):

    ```ts
    import 'server-only';
    export async function initiateMemberDeletion(params: {
      profileId: string;
      reason: string;       // 1..500 chars; staff's authored justification
    }): Promise<{ ok: true; requestId: string }>;
    ```

    - **First runtime statement is `await requireRole('manager');`**
      (AC5 first-await contract).
    - Self-edit guard: if `profileId === session.user.id`, throw
      `SelfEditViolation('cannot initiate deletion of own profile')`.
    - Validates `reason` length 1..500.
    - Inside `withAudit('admin.member.deletion_initiated', 'profile', profileId, ...)`
      (one tx; INSERT + audit row atomic):
      - `SELECT id, email FROM profiles WHERE id = $1 FOR UPDATE` — assert
        the profile exists and is not already anonymized
        (`email NOT LIKE 'del:%'`).
      - `INSERT INTO privacy_requests (profile_id, requester_email,
        kind, status, submitted_at, resolved_by)
        VALUES ($1, (SELECT email FROM profiles WHERE id = $1),
        'delete', 'pending', now(), NULL)` — `resolved_by` is left
        NULL (the resolving manager is recorded by `approveDeletion`
        in AC25; this action only opens the request).
      - Capture the new `privacy_requests.id` for the audit row's
        `after`.
    - Audit `before = null`, `after = { request_id: '<uuid>' }` —
      **NO PII** in the audit row (the `requester_email` lives in
      the `privacy_requests` row, not the audit row).
    - Post-tx: `revalidateTag('admin-dashboard-counts')` so the
      pending-deletions dashboard card reflects the new row.
    - The dialog opens client-side in the member-detail surface
      (AC18 "Delete account" button) but the audit row is written
      ONLY when the manager confirms the typed-email guard and the
      server action commits. A dialog-open with no confirm produces
      no audit row.

    Verified by `tests/admin/session-and-flow-audit-events.test.ts`
    (covers the three layout-emitted + refund-flow events) AND
    `tests/admin/initiate-member-deletion-action.test.ts` (covers
    the new action): happy-path creates one `privacy_requests`
    row (`kind='delete', status='pending'`) + one audit row
    (`admin.member.deletion_initiated`); self-edit attempt throws
    `SelfEditViolation`; reason length validation; audit `before`/
    `after` JSON does not match `/email|full_name|phone|dob/`.

35. **Dashboard cache invalidation — every dashboard-driving
    mutation calls `revalidateTag('admin-dashboard-counts')`
    after the audit-write transaction commits.** The four
    dashboard cards (AC7) cache counts via
    `unstable_cache(..., [...], { revalidate: 30, tags: ['admin-dashboard-counts'] })`;
    a 30-second TTL is the backstop, but the immediate-consistency
    path is tag invalidation from every mutation that changes a
    counted set.

    Mutation actions required to invalidate (the set named in
    Open Q 8 plus the new `initiateMemberDeletion`):
    - `approveVerification` (AC12) — changes pending-verifications count.
    - `rejectVerification` (AC13) — changes pending-verifications count.
    - `requestVerificationInfo` (AC14) — does NOT change the count
      (the row stays in the queue) but invalidates anyway for
      consistency of the recent-activity panel.
    - `changeRole` (AC15) — invalidates the recent-activity panel.
    - `requestReverification` (AC16) — pushes a row back into
      pending-verifications; count changes.
    - `initiateMemberDeletion` (AC34) — increments pending-deletions count.
    - `updateFlag` (AC22) — changes active-kill-switch count when
      the toggled flag matches `key LIKE 'kill-%'`; invalidates
      unconditionally for simplicity.
    - `approveExport` (AC24), `approveDeletion` (AC25),
      `rejectRequest` (AC26) — change pending-deletions count.

    Each of the action files above MUST contain the literal
    `revalidateTag('admin-dashboard-counts')` call **after** the
    `withAudit` block returns (post-tx, NOT inside the audit
    transaction). Failure mode: dashboard goes 30s stale after
    every admin write — acceptable but not the documented
    contract.

    Verified by `tests/admin/dashboard-cache-invalidation.test.ts`
    (source-grep across the ten action files; assert each contains
    the literal `revalidateTag('admin-dashboard-counts')` token).

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Grouped into the
four waves the ADR's Slice Plan named (4A → 4D), with a Wave 5 gauntlet.

### Wave A — Migrations + Shell + Members read-only (Slice 4A)

- **WA.T0 — Migration `0005_privacy_requests.sql` + shape test (AC1, AC3).**
  Two ENUMs + table + three policies + index + comments. Shape test
  mirrors `tests/migrations/audit-log-shape.test.ts` (regex tier +
  pg-query-emscripten AST tier). (~4h)

- **WA.T1 — Migration `0006_feature_flags_rls.sql` + RLS contract test (AC2, AC3).**
  Enable + FORCE RLS; SELECT-authenticated + ALL-manager policies;
  amend comment. RLS contract test asserts member SELECT works,
  member UPDATE fails 42501, manager UPDATE succeeds. (~3h)

- **WA.T2 — `app/(admin)/admin/layout.tsx` (AC4).** Role gate + AAL
  check + admin shell. (~3h)

- **WA.T3 — Role-gate tests (AC4, AC5).** `tests/auth/admin-routes.test.ts`
  and `tests/auth/admin-routes-defense-in-depth.test.ts`. (~2h)

- **WA.T4 — `app/(admin)/admin/page.tsx` dashboard (AC7).** Four
  cards + recent-activity panel + `unstable_cache` wrapping. Tests
  `tests/admin/dashboard-page.test.tsx`. (~4h)

- **WA.T5 — `searchMembers` action + page (AC8, AC9).** Server
  action with filter + pagination math; page with table + filter
  form. Tests for action and page. (~6h)

- **WA.T6 — Member detail page read-only (AC10).** Five sections
  with disabled action buttons; self-edit banner. Tests. (~5h)

### Wave B — Verifications + Audit log (Slice 4B)

- **WB.T7 — Verifications page + signed-URL thumbnail (AC11).**
  Server query for the queue; signed-URL generation; 21+ banner;
  three action buttons with dialogs. (~5h)

- **WB.T8 — `approveVerification` action + tests (AC12).** Includes
  the `member_number` nextval path with a planner-confirmed
  fallback if the sequence doesn't exist. (~4h)

- **WB.T9 — `rejectVerification` + `requestVerificationInfo`
  actions + tests (AC13, AC14).** (~4h)

- **WB.T10 — `lib/timestamps/dst-seam.ts` helper.** Pure function
  `crossesFallbackSeam(fromUtc: Date, toUtc: Date): boolean` for the
  audit-log viewer banner. Tests cover 2026-11-01 03:00 America/Chicago
  (fall-back), 2027-03-08 03:00 (spring-forward — no banner), and
  ranges that don't intersect. (~3h)

- **WB.T11 — Audit-log page + `queryAuditLog` action (AC19, AC20).**
  Page with filters + DST banner; action with cookie-scoped read +
  cashier-denied test. (~6h)

### Wave C — Mutations: roles, flags, privacy (Slice 4C)

- **WC.T12 — `changeRole` action + tests (AC15).** Self-edit guard
  + role-ladder authority check + multi-rung rejection. (~5h)

- **WC.T13 — `requestReverification` action + tests (AC16).** (~2h)

- **WC.T14 — `openRefundFlow` action + tests (AC17).** Includes the
  `PAYMENTS_CONSOLE_READY` constant module +
  `lib/payments/console-availability.ts`. (~3h)

- **WC.T15 — Member-detail dialogs (AC18).** Four typed-confirmation
  dialogs + self-edit hiding. Adds a small reusable
  `components/admin/typed-confirmation-dialog.tsx` (no shadcn
  wrapper — raw Radix per ADR-0023 precedent). Tests. (~5h)

- **WC.T16 — Flags page + `updateFlag` action (AC21, AC22).** Page
  with per-row Save; kill-switch typed confirmation. Action with
  most-specific-first audit selection. (~6h)

- **WC.T17 — Privacy page + three actions (AC23-26).** Queue page
  + `approveExport` + `approveDeletion` (typed-email confirmation)
  + `rejectRequest`. Tests including the `ConfirmEmailMismatch`
  guard. (~7h)

### Wave D — Polish + observability + a11y (Slice 4D, recommended in-scope)

- **WD.T18 — Audit event taxonomy test (AC27).** Source-grep that
  every `withAudit` call uses one of the sixteen named actions. (~2h)

- **WD.T19 — No-PII audit guard (AC28).** Source-grep across all
  admin server actions. (~2h)

- **WD.T20 — Role-ladder defense meta-test (AC29).** (~2h)

- **WD.T21 — PostHog event wiring (AC31).** Four events with consent
  gate. (~3h)

- **WD.T22 — Sentry tag wiring (AC32).** `surface=admin` tag +
  beforeSend redaction additions. (~3h)

- **WD.T23 — axe-core sweep (AC33).** Co-located a11y tests for
  every admin page. (~4h)

- **WD.T24 — Slice-4D-only audit events (AC34).**
  `admin.session.entered` + `admin.session.role_check_denied`
  wired to emission inside `lib/auth/requireRole.ts`;
  `admin.member.deletion_initiated` wired via the new
  `initiateMemberDeletion` server action (signature pinned in
  AC34); `admin.refund.flow_opened` already covered by AC17.
  Adds `tests/admin/initiate-member-deletion-action.test.ts`.
  (~4h)

- **WD.T25 — Dashboard cache invalidation source-grep (AC35).**
  Add `revalidateTag('admin-dashboard-counts')` post-tx in the
  ten action files named in AC35. Source-grep test at
  `tests/admin/dashboard-cache-invalidation.test.ts` asserts
  every listed action contains the literal. (~2h)

### Wave E — Gauntlet + cross-cutting

- **WE.T25 — Cycle 1-3 regression sweep (AC30).** Run the entire
  pre-existing test suite; reconcile any drift (e.g. the cycle-1
  `feature_flags` migration comment update — see AC2). (~2h)

- **WE.T26 — Final gauntlet.** All acceptance commands; typecheck;
  lint; migrate:check; full vitest. (~2h)

## Touched-files inventory

Best estimate; workers may exceed if needed. **Workers MUST NOT
edit any cycle-1/2/3 source file** under `app/`, `lib/auth/`,
`lib/supabase/`, `lib/audit/`, `lib/privacy/`, or `middleware.ts`
unless a numbered AC above explicitly authorizes it. The
admin-console code lives in its own route group + lib subpaths.

### Create

#### Schema
- `supabase/migrations/0005_privacy_requests.sql` (AC1, WA.T0)
- `supabase/migrations/0006_feature_flags_rls.sql` (AC2, WA.T1)

#### Layout + dashboard
- `app/(admin)/admin/layout.tsx` (AC4, WA.T2)
- `app/(admin)/admin/page.tsx` (AC7, WA.T4)

#### Members
- `app/(admin)/admin/members/page.tsx` (AC8, WA.T5)
- `app/(admin)/admin/members/[id]/page.tsx` (AC10, AC18, WA.T6 + WC.T15)
- `app/(admin)/admin/members/_actions/searchMembers.ts` (AC9, WA.T5)
- `app/(admin)/admin/members/[id]/_actions/changeRole.ts` (AC15, WC.T12)
- `app/(admin)/admin/members/[id]/_actions/requestReverification.ts` (AC16, WC.T13)
- `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts` (AC17, WC.T14)
- `app/(admin)/admin/members/[id]/_actions/initiateMemberDeletion.ts` (AC34, WD.T24)

#### Verifications
- `app/(admin)/admin/verifications/page.tsx` (AC11, WB.T7)
- `app/(admin)/admin/verifications/_actions/approveVerification.ts` (AC12, WB.T8)
- `app/(admin)/admin/verifications/_actions/rejectVerification.ts` (AC13, WB.T9)
- `app/(admin)/admin/verifications/_actions/requestVerificationInfo.ts` (AC14, WB.T9)

#### Audit log
- `app/(admin)/admin/audit-log/page.tsx` (AC19, WB.T11)
- `app/(admin)/admin/audit-log/_actions/queryAuditLog.ts` (AC20, WB.T11)

#### Flags
- `app/(admin)/admin/flags/page.tsx` (AC21, WC.T16)
- `app/(admin)/admin/flags/_actions/updateFlag.ts` (AC22, WC.T16)

#### Privacy
- `app/(admin)/admin/privacy/page.tsx` (AC23, WC.T17)
- `app/(admin)/admin/privacy/_actions/approveExport.ts` (AC24, WC.T17)
- `app/(admin)/admin/privacy/_actions/approveDeletion.ts` (AC25, WC.T17)
- `app/(admin)/admin/privacy/_actions/rejectRequest.ts` (AC26, WC.T17)

#### Shared admin components + helpers
- `components/admin/typed-confirmation-dialog.tsx` (AC18, WC.T15)
- `lib/timestamps/dst-seam.ts` (AC19, WB.T10)
- `lib/payments/console-availability.ts` (AC17, WC.T14)
- `lib/auth/mfa-availability.ts` (AC4, WA.T2) — exports
  `MFA_CHALLENGE_READY: boolean` (default `false` until ADR-0002
  cycle 4 lands and flips it; mirrors `PAYMENTS_CONSOLE_READY`).
- `app/login/mfa-pending/page.tsx` (AC4, WA.T2) — static
  "MFA enrollment required — please contact the owner." fallback
  page. No data fetch; pure render.

#### Tests
- `tests/migrations/admin-privacy-requests-shape.test.ts` (AC1, WA.T0)
- `tests/db/rls-privacy-requests.test.ts` (AC1, WA.T0)
- `tests/db/rls-feature-flags.test.ts` (AC2, WA.T1)
- `tests/auth/admin-routes.test.ts` (AC4, WA.T3)
- `tests/auth/admin-routes-defense-in-depth.test.ts` (AC5, WA.T3)
- `tests/admin/dashboard-page.test.tsx` (AC7, WA.T4)
- `tests/admin/members-list-page.test.tsx` (AC8, WA.T5)
- `tests/admin/search-members-action.test.ts` (AC9, WA.T5)
- `tests/admin/member-detail-page.test.tsx` (AC10, WA.T6)
- `tests/admin/member-detail-dialogs.test.tsx` (AC18, WC.T15)
- `tests/admin/verifications-page.test.tsx` (AC11, WB.T7)
- `tests/admin/approve-verification-action.test.ts` (AC12, WB.T8)
- `tests/admin/reject-verification-action.test.ts` (AC13, WB.T9)
- `tests/admin/request-verification-info-action.test.ts` (AC14, WB.T9)
- `tests/admin/change-role-action.test.ts` (AC15, WC.T12)
- `tests/admin/request-reverification-action.test.ts` (AC16, WC.T13)
- `tests/admin/open-refund-flow-action.test.ts` (AC17, WC.T14)
- `tests/admin/audit-log-page.test.tsx` (AC19, WB.T11)
- `tests/admin/query-audit-log-action.test.ts` (AC20, WB.T11)
- `tests/admin/flags-page.test.tsx` (AC21, WC.T16)
- `tests/admin/update-flag-action.test.ts` (AC22, WC.T16)
- `tests/admin/privacy-page.test.tsx` (AC23, WC.T17)
- `tests/admin/approve-export-action.test.ts` (AC24, WC.T17)
- `tests/admin/approve-deletion-action.test.ts` (AC25, WC.T17)
- `tests/admin/reject-request-action.test.ts` (AC26, WC.T17)
- `tests/admin/audit-event-taxonomy.test.ts` (AC27, WD.T18)
- `tests/admin/no-pii-in-admin-audit.test.ts` (AC28, WD.T19)
- `tests/admin/role-ladder-defense.test.ts` (AC29, WD.T20)
- `tests/admin/posthog-events.test.ts` (AC31, WD.T21)
- `tests/admin/sentry-tags.test.ts` (AC32, WD.T22)
- `tests/admin/a11y/*.a11y.test.tsx` (one per admin page) (AC33, WD.T23)
- `tests/admin/session-and-flow-audit-events.test.ts` (AC34, WD.T24)
- `tests/admin/initiate-member-deletion-action.test.ts` (AC34, WD.T24)
- `tests/admin/dashboard-cache-invalidation.test.ts` (AC35, WD.T25)
- `tests/timestamps/dst-seam.test.ts` (AC19, WB.T10)

### Modify

- `lib/auth/requireRole.ts` — amended in this slice to encapsulate
  the AAL assertion (B1 reconciliation; see AC4). When the
  required minimum is `manager` or `owner`, the helper reads
  `session.aal` and, if `aal < 'aal2'`, calls
  `redirect('/login/mfa-challenge?next=...')` (or
  `/login/mfa-pending` when `MFA_CHALLENGE_READY === false`).
  The helper ALSO emits the `admin.session.entered` audit row on
  successful entry and `admin.session.role_check_denied` on
  throw (AC4 + AC34). No behavior change for `member`/`cashier`
  callers — those do not require `aal2` and do not emit admin
  audit rows.
- The cycle-1 `feature_flags` comment is amended **forward** via
  AC2's `0006_feature_flags_rls.sql` — the original
  `0001_feature_flags.sql` file is NOT touched per ADR-0018
  migration policy.

### No-change (cycle-1/2/3 substrate reused by reference)

- `lib/auth/types.ts`, `lib/auth/errors.ts`,
  `lib/auth/getCurrentProfile.ts` — consumed by every admin RSC
  + action.
- `lib/supabase/server.ts` (`createClient`) — every cookie-scoped
  read.
- `lib/supabase/admin.ts` (`createAdminClient`) — used ONLY by
  `softDeleteProfile`'s call site; never instantiated in admin
  actions directly. Per ADR-0035 §API Contracts.
- `lib/audit/withAudit.ts` — every admin server action wraps its
  mutation in this.
- `lib/privacy/soft-delete.ts` — called by AC25's
  `approveDeletion`.
- `middleware.ts` — `GATED_PREFIXES` already includes `/admin`
  (cycle-1); no change needed.
- `supabase/migrations/0001..0004*.sql` — unchanged.

## Risk flags

This is the project's high-risk auto-flag list per the spec-writer
template (linked ADRs in {0003, 0006, 0009, 0020, 0023}). Phase 1
is expected to auto-trigger `premortem(mode=task)` on this spec —
ADR-0035 transitively touches every cycle-1-through-3 ADR.

- **0003 (RLS) — admin surface routinely reads every member's
  data.** `manager+` has SELECT on `profiles`, `audit_log`,
  `feature_flags`, `privacy_requests` (the new table). Any bug in
  a server action that takes a `targetId` from the request URL and
  forgets to validate it against the role gate exposes cross-user
  data. Mitigation: every server action's **first runtime
  statement** is `await requireRole('manager');` (AC4-26); the
  three-layer defense meta-test (AC29) asserts all three layers
  exist; RLS at the DB is the third gate.

- **0006 (audit log) — sixteen new audit-event types must
  honor the no-PII forever-retention contract.** AC28's
  source-grep is the load-bearing regression guard. Premortem
  mandatory. If a worker "refactors for cleanliness" and includes
  the just-changed `email` in an audit row, the audit log (forever-
  retained) has just leaked PII.

- **0009 (ID verification) — signed-URL thumbnails are a leak
  surface.** AC11's signed URL has a 1-hour TTL. The URL is
  generated server-side and embedded into the page HTML. A
  forwarded session cookie cannot extend the TTL, but a forwarded
  HTML can be re-rendered by the receiver inside the 1-hour
  window. Mitigation: the `<img>` element receives
  `referrerPolicy="no-referrer"` (AC11) and the URL is single-use
  per page-load (regenerated on every refresh).

- **0020 (feature flags) — RLS migration changes posture.** AC2's
  migration enables RLS on `feature_flags` for the first time. The
  cycle-1 migration `0001_feature_flags.sql` comment said writes
  would use the service-role key; ADR-0035 amends that to
  cookie-scoped `manager+` writes. If any cycle-1/2 code path was
  writing to `feature_flags` from an unauthenticated context
  (none currently exist — the table has no writers), it would
  break. Premortem: assert at planner time that no existing call
  site writes to `feature_flags`. AC2's migration includes the
  comment amendment.

- **0023 (privacy) — `approveDeletion` calls `softDeleteProfile`
  which anonymizes a member's row irreversibly.** AC25's typed-
  email-confirmation (`confirmEmail === requester_email`) is the
  load-bearing premortem-mitigation for wrong-user deletion. The
  `requester_email` is captured at submission time **before**
  anonymization so the confirmation email can still address the
  member (the `profiles.email` is `del:<hash>` after anonymization
  — the request row keeps the real one). Premortem mandatory.

- **Two audit rows per role change is intentional but visually
  noisy.** ADR-0035 §Consequences names a UI-level collapse
  filter (hide `profile.role_change` when an `admin.member.role_changed`
  exists for the same `target_id` within 1s). This spec does NOT
  implement the collapse — it ships both rows visible in the
  viewer. The collapse is a Slice 5 ergonomics task; v1 forensic
  clarity wins over visual cleanliness.

- **Role-ladder enforcement in three layers means three places to
  keep in sync.** AC29's meta-test asserts all three exist. A new
  role added to the ladder requires updates in (a) `ROLE_RANK` in
  `lib/auth/types.ts`, (b) the role-gated dialogs in member-detail
  (AC18), (c) the DB enum + the `profiles_protect_role_change`
  trigger. The cycle-1 RLS contract tests already gate (c); the
  meta-test gates (a) + (b).

- **`openRefundFlow` is a stub until ADR-0036 lands.** AC17's
  graceful-degradation via `PAYMENTS_CONSOLE_READY: false` is the
  safety property. If ADR-0036 lands during the conductor cycle,
  flip the constant to `true` and the redirect target updates
  automatically — no other code path changes. If ADR-0036 has not
  landed by ship-time, the breadcrumb audit event still fires; the
  redirect lands on a placeholder + toast.

- **`pgcrypto` already enabled (cycle-1 migration `0004`).** AC25's
  call to `softDeleteProfile` requires `pgcrypto` — which the
  cycle-1 migration `0004_privacy_soft_delete.sql` enabled. No new
  extension is needed in this slice.

- **0017 (CI/CD) — e2e deferred to CI.** This slice does NOT ship
  Playwright. The ADR-0035 §Testing Strategy's four E2E scenarios
  are translated into vitest + RTL + pglite RLS tests:
  - "Verification queue happy path" → AC12 pglite test.
  - "Role-change with audit assertion" → AC15 pglite test
    (both audit rows asserted).
  - "Deletion request processing" → AC25 pglite test.
  - "Feature flag kill-switch toggle" → AC22 pglite test.
  Coverage parity is structural — no behavior is asserted only by
  Playwright.

- **0024 (cookie banner) consent gate for PostHog.** AC31's
  PostHog events fire only when
  `lib/analytics/consent-aware-track.ts` reports
  `granted: true`. Staff users do consent at signup (the existing
  cookie banner runs on the signup page); no marketing-banner
  footgun. Verified by AC31's negative test (no event when
  granted: false).

- **0034 (timestamps) — UTC + Central rendering everywhere.** Every
  admin page renders timestamps via `formatTimestampPair(utc:
  Date): { utc: string; central: string; tzAbbrev: 'CDT' | 'CST' }`
  (the helper that already exists from ADR-0034's slice). The
  audit-log viewer also calls `crossesFallbackSeam` (AC19 / WB.T10
  helper) to render the DST banner. Premortem: a date filter that
  collapses both UTC and Central into a single column would break
  the ADR-0034 contract; the spec pins both columns explicitly.

## Premortem inputs

Per the high-risk auto-flag, the planner pre-loads these failure
modes when dispatching Phase 1 premortem:

1. **Wrong-user deletion via mistyped or auto-filled `confirmEmail`.**
   A manager opens two privacy requests in adjacent browser tabs
   and types the wrong email in the second tab's confirmation
   field. Mitigation: AC25 pins `confirmEmail === requester_email`
   inside the transaction (SELECT FOR UPDATE), so the typed email
   is checked against the request being approved, not the URL or
   any client-side state. Tests assert the mismatch case throws
   without calling `softDeleteProfile`.

2. **PII leaks into an admin audit row.** A future refactor of
   `changeRole` adds `email` to the audit `before` for "context."
   The audit row survives forever. Mitigation: AC28 source-grep
   across every admin server action; AC29 role-ladder meta-test
   ensures the audit emit point is hit by tests.

3. **Cashier-roled session bypasses the role gate via a forgotten
   `requireRole` call.** A worker adds a new admin server action
   and forgets the `await requireRole('manager');` line.
   Mitigation: AC5's source-grep walks the tree and asserts every
   admin page calls `requireRole`; the analogous server-action
   walk is implicit via AC27 (the audit-taxonomy test parses every
   action file, so the file must exist + compile; the lint plugin
   could be extended in a future slice to enforce the call
   pattern syntactically).

4. **Role-ladder violation: `manager → owner` promotion through
   the server action.** AC15 pins the authority check + tests
   assert `InsufficientRoleError` when a `manager`-roled session
   attempts a promotion. The DB trigger
   `profiles_protect_role_change` is the third line of defense.

5. **`approveVerification` race — two managers approving
   simultaneously generates two `member_number` values.** The
   action uses `nextval` (atomic in Postgres), so the sequence
   itself is race-safe. But two managers approving the **same
   profile** simultaneously would write two `id_verified_at`
   timestamps + consume two sequence values. Mitigation: AC12's
   `SELECT id_verified_at FROM profiles WHERE id = $1 FOR UPDATE`
   inside the transaction acquires a row lock; the second
   transaction blocks until the first commits and then sees
   `id_verified_at IS NOT NULL` and returns the idempotent no-op
   path.

6. **DST-seam banner false negative.** The
   `crossesFallbackSeam` helper miscomputes the seam for a year
   where the user's filter range straddles it. Mitigation:
   WB.T10's tests cover 2026-11-01 (the next fall-back from now)
   and 2027-03-08 (spring-forward — no banner) + edge cases at
   the exact transition minute. The helper is pure; tests assert
   the boolean against known UTC moments.

7. **`feature_flags` RLS enablement breaks an unknown cycle-1/2
   writer.** AC2 enables RLS on `feature_flags` for the first
   time. Mitigation: at planner time, grep the repo for any
   write to `feature_flags` that doesn't go through the (not-yet-
   built) admin action; expectation is zero matches because the
   cycle-1 migration's comment forecasted service-role writes
   only. If a match exists, the planner surfaces it as a blocker
   before WA.T1 lands.

8. **Audit-log viewer renders 100k rows without virtualization
   and crashes the browser.** AC19 specifies page size 50 (max
   200). The ADR-0035 §UI Conventions also mandates virtualization
   at >100 rows. In v1 the page-size cap is the primary mitigation
   (the user never sees more than 200 rows at once); virtualization
   is a Slice 4D polish (recommended but not load-bearing).

9. **`openRefundFlow` breadcrumb fires but ADR-0036 never lands.**
   The audit_log accumulates `admin.refund.flow_opened` rows that
   reference a nonexistent surface. This is fine — the breadcrumb
   is forensic; if a manager clicked into the refund flow and
   nothing happened, the audit row records the intent. The toast
   ("Refund flow not yet available") is the UX mitigation; the
   audit row is the operational record.

10. **`approveDeletion` writes `softDeleteProfile` but the second
    UPDATE (`UPDATE privacy_requests SET status = 'completed'`)
    fails — partial commit leaves the profile anonymized but the
    request stuck in `pending`.** Mitigation: AC25 wraps **both**
    SQL operations + the audit row + the `softDeleteProfile` call
    inside one `withAudit` transaction. If any step throws, the
    whole transaction rolls back — the profile stays un-
    anonymized and the request stays `pending`. The post-tx email
    send is the only step outside the tx (and is best-effort by
    design).

## Out of scope

What this slice deliberately does **not** do. Each item is bound to
a future ADR cycle or explicitly declined.

- **Bulk operations** (approve N verifications at once, bulk-edit
  N flags, bulk-reject N privacy requests). Single-row actions
  only in v1. Slice 5 successor ADR (`0040-admin-console-v2.md`)
  owns the bulk surface.

- **Saved searches / pinned filters / `admin_search_recents`
  table.** The four filter modes in each page cover every v1 use
  case. Deferred.

- **CSV export beyond the audit log.** The audit log is the only
  regulator-facing exportable record. Member-list / verification-
  queue CSV export is a Slice 5 task. Even the audit-log CSV
  export itself ships in Slice 5 — v1 is on-screen pagination
  only. (If the planner has spare capacity in Wave D and a strong
  case, the audit-log CSV export can be promoted into this slice
  as a fifth Wave D task. Default: defer.)

- **Tournament admin CRUD UI.** ADR-0012 owns. The admin console
  does not edit tournaments.

- **Observability dashboards UI.** ADR-0014 owns. The admin
  console emits PostHog + Sentry events (AC31-32) but does not
  render them.

- **SMS history viewer.** ADR-0025 owns; ADR-0025 is currently
  blocked.

- **Content-blocks editor.** Privacy policy, member agreement,
  marketing copy edited via direct migration in v1. Deferred to
  whichever ADR owns content authoring.

- **Cashier-readable view of `/admin`.** Declined. Cashiers
  escalate via the manager helpdesk (ADR-0027). A read-only
  "preview the admin console" mode is a leak surface.

- **Admin-activity dashboard** ("show me what each manager did
  in the last 7 days"). Deferred to ADR-0014 Slice 4.

- **Stripe disputes mirror.** ADR-0027 declines; Stripe Dashboard
  remains the v1 disputes UI.

- **Per-action confirmation-threshold escalation** ("This $500
  refund requires owner approval"). Typed-confirmation pattern
  is partly implemented (AC18); authority-based escalation is
  Slice 5.

- **Last-owner protection at the DB layer.** The application
  invariant (AC15 self-edit guard + role-ladder check) is the v1
  enforcement. A DB CHECK constraint that "always >= 1 owner"
  is deferred. If a future incident shows the application
  invariant was bypassed, escalate.

- **`/admin/audit-log` collapse of trigger + server-action rows
  for role changes.** Both rows render. ADR-0035 §Consequences
  names a 1-second UI-collapse heuristic; v1 ships without it for
  forensic clarity.

- **`mfa-challenge` route implementation.** AC4 redirects to
  `/login/mfa-challenge` if `aal < aal2`. The route itself is
  owned by ADR-0002 cycle 4 (MFA enrollment + challenge); this
  spec assumes it exists at integration time. If absent at
  ship-time, the redirect lands on a 404 — surface to the planner
  as a hard dependency; the conductor cycle pauses until ADR-0002
  cycle 4 lands.

- **In-memory `feature_flags` cache invalidation.** AC22's action
  emits a `console.log` breadcrumb noting the cache-refresh hook
  is pending; the actual cache lives in
  `lib/flags/registry.ts` (in-code) until a future slice wires
  the lib to read from the DB. Until that wiring lands, the
  admin-edited flag value is in the DB but the in-process reader
  still uses the in-code default. Documented; not a v1 blocker.

- **PostHog event for admin reads.** No PostHog event fires on
  page-view of admin surfaces other than `admin_session_entered`
  (per AC31). Per-page-view tracking is deferred.

- **Translated admin UI.** English only, matching the rest of the
  product (ADR-0024 declined i18n).

## Open questions

Surfaced for resolution during planning. **Defaults are the spec
author's recommendation; the planner confirms before t-zero.**

1. **`member_number` sequence name and creation owner.** ADR-0009
   specifies a Postgres sequence for the member-number monotone
   counter; AC12's `approveVerification` calls `nextval`. **The
   sequence MAY not exist yet** (ADR-0009 implementation status:
   schema columns exist; sequence creation is a Slice 2/3 task).
   Default: AC12's worker checks for the sequence at implementation
   time; if absent, the worker uses a planner-confirmed portable
   fallback (`SELECT COALESCE(MAX(member_number), 0) + 1 FROM profiles`)
   wrapped in a `FOR UPDATE` lock on the existing row. The
   fallback's race-safety is weaker (concurrent approvals can
   re-issue the same number — but the column has a UNIQUE
   constraint per ADR-0009, so the second commit fails with
   23505 and the action returns a retry-prompt). Resolve at
   planner time: prefer creating the sequence in
   `0005_privacy_requests.sql` if not present (additive); fall
   back if not.

2. **`payments` table existence at AC10.** The member-detail
   page's "Recent payments" section reads from a `payments`
   table that ADR-0010 owns. ADR-0010 is currently blocked on
   API keys. Default: AC10's worker renders the
   "Payment integration pending — see ADR-0010 / 0036." inline
   message and does not query a (possibly nonexistent) table.
   If a `payments`-like table exists at implementation time
   (ADR-0010 Slice 1 may have shipped the schema even if the
   write paths are stubbed), the worker queries it; otherwise
   the placeholder message is the v1 ship.

3. **`memberships` and `time_wallets` tables at AC10.** Same
   posture as Open Q 2. If absent, render
   "Membership status pending — see ADR-0010." inline.

4. **`PAYMENTS_CONSOLE_READY` constant ownership.** AC17's
   `lib/payments/console-availability.ts` exports a boolean.
   Default: this slice creates the constant with value `false`;
   when ADR-0036 lands, ADR-0036's spec flips it to `true`. The
   spec for ADR-0036 SHOULD include AC for this flip; if it
   doesn't, the planner adds a coordination note.

5. **Typed-confirmation phrase for role changes.** AC18 specifies
   `approve`. Alternatives considered: typing the new role name
   ("type 'manager' to confirm promotion"). Default: ship the
   generic `approve` to match the verification flow; if a future
   role-change incident shows confusion, escalate to typing the
   role name.

6. **PostHog consent gate posture for staff.** AC31 says staff
   consent at signup. The current cookie banner (ADR-0024) runs
   on every page including signup; staff click "Accept all" or
   "Customize" during the signup flow. If staff defaulted to
   "Decline all," the four admin PostHog events never fire and
   admin observability is silent. Default: surface this in the
   premortem; if blocking, AC31 ships with a planner-confirmed
   "staff role bypasses the consent gate for the four admin
   events" exception. Recommend: ship the consent gate as-is and
   accept silent telemetry from staff who declined; the audit
   log is the operational record-of-record and PostHog is
   product-analytics.

7. **AAL2 enforcement.** AC4 redirects `aal < aal2` to
   `/login/mfa-challenge`. The redirect route doesn't exist yet
   (ADR-0002 cycle 4). Default: the layout redirects to the
   route regardless; if the route 404s, the surface is hard-down
   and the planner pauses the conductor cycle. Recommend
   confirming ADR-0002 cycle 4 status before WA.T2.

8. **`unstable_cache` revalidation tag on the dashboard.** AC7
   uses `revalidate: 30` (seconds) and tag
   `admin-dashboard-counts`. Open: which mutations call
   `revalidateTag('admin-dashboard-counts')`? Default: every
   verification action (AC12-14), every privacy action
   (AC24-26), and every flag action (AC22) — the four queries
   that drive the dashboard. The 30-second TTL is a backstop;
   the tag invalidation is the immediate-consistency path.

## Iteration history

- **Revision 1 (2026-05-15):** initial spec authored for ADR-0035
  Slice 4. Eight admin surfaces (dashboard, members list,
  member detail, verifications, audit log, flags, privacy,
  refund handoff), sixteen audit-event types, one new table
  (`privacy_requests`), one cycle-1 forward-amendment migration
  (`feature_flags` RLS), three-layer defense (middleware ->
  `requireRole` -> RLS), all four sub-slices 4A/4B/4C/4D included
  in this run (4D recommended-not-optional given the goal calls
  for "fully working and finished, thoroughly tested, update all
  docs"). 34 acceptance criteria (AC1-AC34); 26 task cuts in 5
  waves (A->E); 8 open questions surfaced for planner
  confirmation (defaults pinned for each). Playwright E2E
  deferred to ADR-0017 CI venue per the ADR-0023 precedent;
  vitest + RTL + pglite substrate covers every E2E scenario named
  in ADR-0035 §Testing Strategy. Cross-cutting structural ACs
  (AC27 taxonomy, AC28 no-PII, AC29 role-ladder meta, AC30
  cycle 1-3 regression) gate the integration phase.

- **Revision 2 (2026-05-15):** addressed critic-spec iter-1
  concerns — AC4 layout order (B1: AAL check now encapsulated
  inside `requireRole`, single first-statement is preserved;
  `lib/auth/requireRole.ts` added to Modify list), AC5/AC15
  gate-first patterns (S1: first-await AST/walker contract
  extended to server actions under `_actions/*.ts`; S2:
  `changeRole` outer `requireRole('manager')` pinned as first
  statement, owner-refine moved to AFTER target-role read),
  AC34 `initiateMemberDeletion` action (S3: concrete signature
  + audit contract + `privacy_requests` row creation pinned at
  `app/(admin)/admin/members/[id]/_actions/initiateMemberDeletion.ts`),
  AC35 dashboard cache invalidation (S4: new AC appended;
  `revalidateTag('admin-dashboard-counts')` pinned on ten
  mutation actions; source-grep test
  `tests/admin/dashboard-cache-invalidation.test.ts`), AC4
  cross-ref fix (S5: two `see AC23` → `see AC34` corrections),
  `/login/mfa-pending` fallback (S6: graceful degradation via
  `MFA_CHALLENGE_READY` constant; conductor unblocked from
  ADR-0002 cycle 4), AC11 signed-URL error branch (S7:
  "Thumbnail unavailable — refresh" placeholder; row remains
  actionable; test asserts click handler fires under
  generator-rejection), AC17 ADR-0036 coordination note (S8:
  flag for the conductor session that drives ADR-0036),
  AC30 mechanical regression rule (N4: replaced "no semantic
  changes" with `git diff --unified=0 ... | grep ^[+-]\s+expect\(`
  empty-set contract).
