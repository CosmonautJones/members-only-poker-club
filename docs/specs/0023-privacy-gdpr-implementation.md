---
adr: 0023
slice: 1
risk: high
# Acceptance commands MUST be runnable shell commands that exit 0 only when
# every numbered acceptance criterion is satisfied. The validator runs each
# one in order during the slice/integration pass; scope-judge refuses to
# return ship_ready=true if any was not run-and-passed.
#
# Runtime-deferred per ADR-0017 (CI/CD) ratification — the Windows host
# cannot bind port 3000 (Hyper-V / WinNAT reserves 2983-3082). Slice 1
# accepts vitest + source-grep structural substitutes mirroring the
# ADR-0024 cookie-banner pattern. Playwright e2e is NOT in scope for this
# slice (it rides on ADR-0017's CI venue once ratified).
acceptance_commands:
  - 'pnpm typecheck'
  - 'pnpm lint'
  - 'pnpm test'
  # - 'pnpm test:e2e privacy'    # deferred — CI-only per ADR-0017
---

# Spec: Privacy / GDPR / CCPA — scaffolding (ADR-0023 slice 1)

- **ADR:** [0023](../adr/0023-privacy-gdpr-ccpa-data-deletion.md)
- **Status:** Draft
- **Date:** 2026-05-14

## Goal

Ship the **member-facing privacy surface skeleton** — a versioned `/privacy`
policy page, `softDeleteProfile()` plus `profiles.deleted_at` migration, a
typed `retention.ts` helper that pins the ADR-0023 retention schedule, the
two authenticated API endpoints (`/api/privacy/export`, `/api/privacy/delete`),
and the Profile to Privacy member UI page with the two destructive buttons —
so members can read the privacy policy, download their currently-collectable
data as JSON, and self-anonymize their profile in Slice 1. Real Stripe / KYC
/ Sentry / PostHog data flows into the export, and real cron-driven retention
enforcement, are explicitly Slice 2+, gated on ADR-0010 (payments), ADR-0009
(KYC), ADR-0014 (Sentry), and ADR-0028 (PostHog) — all currently blocked.
This slice ships the **plumbing** so the eventual unblock is additive, not
retrofit.

## Acceptance criteria

Numbered, testable. Each AC names the file (or source-grep target) that
verifies it. Style mirrors `docs/specs/0024-cookie-and-consent-banner-implementation.md`:
exact file paths, function signatures, error branches, a11y contracts.

1. **Migration `supabase/migrations/0004_privacy_soft_delete.sql`** exists,
   follows the `NNNN_<snake_case>.sql` naming convention (after the existing
   `0001_feature_flags.sql`, `0002_profiles_and_roles.sql`, and
   `0003_audit_log.sql`), and applies cleanly when fed (after migrations 0002
   and 0003) to a fresh pglite instance via `pg.exec()`. The migration
   contains exactly these structural changes:
   - `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the top, so the
     `softDeleteProfile` SQL path (AC3) can call `digest(...)`. The
     extension is additive and idempotent; pglite supports it natively.
   - `ALTER TABLE profiles ADD COLUMN deleted_at TIMESTAMPTZ` — nullable,
     no default. Non-NULL signals an anonymized soft-deleted profile.
   - `CREATE INDEX profiles_active_idx ON profiles (id) WHERE deleted_at IS NULL`
     — partial index so active-profile lookups stay fast as deleted rows
     accumulate.
   - **Replace the existing `profiles_select_self_or_staff` policy via
     `DROP POLICY ... ; CREATE POLICY ...`** so deleted rows are invisible
     to non-staff: new USING clause is
     `(id = auth.uid() AND deleted_at IS NULL) OR auth.role_at_least('manager')`.
     Note the staff threshold rises from `cashier` to `manager` for
     deleted-row visibility — cashiers see only active rows. Cashiers
     retain SELECT on active rows via a **second** policy
     `profiles_select_active_for_staff` with USING
     `auth.role_at_least('cashier') AND deleted_at IS NULL`. Both policies
     are `FOR SELECT` and combine with OR (Postgres default).
   - **No change to `profiles_update_self_or_manager` policy in this
     slice.** A soft-deleted user's `auth.uid()` no longer matches an
     active profile SELECT, but the row still exists; the update policy
     as-written would let the deleted user re-update their own row.
     Mitigation: AC4's `softDeleteProfile()` helper sets `deleted_at` and
     the calling endpoint immediately signs the user out. A defense-in-
     depth tightening of the UPDATE policy to also gate on
     `deleted_at IS NULL` is **explicitly deferred to a future slice**
     (out of scope below) so this slice's migration stays surgical and
     the policy rewrite doesn't drift cycle 1 assertions.
   - Migration ends with a `COMMENT ON COLUMN profiles.deleted_at IS '...'`
     and a `COMMENT ON INDEX profiles_active_idx IS '...'` documenting the
     ADR-0023 ownership and the irreversibility contract (no undelete; see
     Out of scope).

   Verified by `pnpm test tests/migrations/privacy-soft-delete-shape.test.ts`
   and the `beforeAll` in `pnpm test tests/db/privacy-rls.test.ts`.

2. **`lib/privacy/retention.ts`** exports a typed function
   `getRetentionWindow(category: RetentionCategory): RetentionWindow` where:

   ```typescript
   export type RetentionCategory =
     | 'id_document'
     | 'audit_log'
     | 'ledger'
     | 'payment'
     | 'sentry'
     | 'posthog'
     | 'session'
     | 'marketing_contact';

   export type RetentionWindow =
     | { kind: 'days'; days: number }
     | { kind: 'forever' }
     | { kind: 'until_event'; event: 'unsubscribe' | 'verification' };

   export function getRetentionWindow(category: RetentionCategory): RetentionWindow;
   ```

   The exact mapping pinned (verbatim from ADR-0023's retention table):
   - `id_document` -> `{ kind: 'until_event', event: 'verification' }`
     with a documented "post-verification + 30 days" follow-on
     (`{ kind: 'days', days: 30 }`) returned via a sibling
     `getPostEventRetention(category)` helper.
   - `audit_log` -> `{ kind: 'forever' }`
   - `ledger` -> `{ kind: 'forever' }`
   - `payment` -> `{ kind: 'days', days: 365 * 7 }` (7 years; tax / IRS)
   - `sentry` -> `{ kind: 'days', days: 90 }`
   - `posthog` -> `{ kind: 'days', days: 365 }`
   - `session` -> `{ kind: 'days', days: 30 }`
   - `marketing_contact` -> `{ kind: 'until_event', event: 'unsubscribe' }`

   The module is vanilla TypeScript (no `'use client'`, no `'server-only'`)
   so it is importable from cron handlers (Slice 2), server actions, RSCs,
   and tests alike. The function is **pure** (no side effects, no I/O); a
   call to `getRetentionWindow('audit_log')` returns the same value every
   time. **Exhaustiveness pinned by type:** an unhandled `RetentionCategory`
   value triggers a `never`-assertion in the default branch so a future
   category addition is a TS compile error, not a runtime fallthrough.

   Verifiable by `tests/privacy/retention.test.ts` covering: every
   `RetentionCategory` value returns the expected `RetentionWindow`;
   purity (two calls with the same arg are deep-equal); type-level
   exhaustiveness (assert via a `@ts-expect-error` test that adding a
   nonexistent category to the call site fails compilation — vitest's
   `expectTypeOf` from `expect-type` is the idiomatic helper, already a
   transitive dep of vitest).

3. **`lib/privacy/soft-delete.ts`** exports
   `softDeleteProfile(userId: string, db: TransactionClient): Promise<SoftDeleteResult>`
   with the contract:

   ```typescript
   import 'server-only';

   export interface SoftDeleteResult {
     userId: string;
     /**
      * True on the FIRST call when the profile transitions from
      * non-deleted to deleted; false on subsequent calls (idempotent
      * no-op) AND when no profile row exists for `userId`.
      */
     mutated: boolean;
   }

   // Structural transaction-client interface — same shape as
   // `lib/audit/withAudit.ts`'s TransactionClient (Open Q 1 resolution
   // promoted to W1.T4 prerequisite).
   export interface TransactionClient {
     query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
   }

   export function softDeleteProfile(
     userId: string,
     db: TransactionClient,
   ): Promise<SoftDeleteResult>;
   ```

   Properties this AC pins:
   - **Anonymization shape (load-bearing — DO NOT WEAKEN):** the UPDATE
     writes
     `full_name = 'del:' || encode(digest(id::text::bytea, 'sha256'), 'hex')`,
     `email     = 'del:' || encode(digest(id::text::bytea, 'sha256'), 'hex') || '@deleted.local'`,
     `phone     = NULL`,
     `deleted_at = now()`,
     WHERE `id = $1 AND deleted_at IS NULL`. The hash is derived from the
     user id (deterministic; SHA-256 is collision-resistant within the
     `auth.users.id` UUID space) so the same user processed twice produces
     identical tokens, and so test assertions can predict the token from
     the seed UUID. The `WHERE deleted_at IS NULL` guard is the
     idempotency gate: a second call updates 0 rows.
   - **Idempotency:** calling `softDeleteProfile(userId)` twice on the
     same `userId` is a no-op on the second call. The first call returns
     `{ userId, mutated: true }`; the second returns
     `{ userId, mutated: false }`. The helper reads the rowCount returned
     by the UPDATE (via `query` results) to derive the boolean.
   - **Missing-profile branch:** if `userId` does not exist in
     `profiles`, the helper returns `{ userId, mutated: false }` — it
     does NOT throw. Forensics distinguish "deleted profile" from "never
     existed" via the `audit_log` actor row written by the caller (the
     delete endpoint).
   - **Email collision safety:** the `email` column has a UNIQUE
     constraint (cycle-1 migration `0002`, line 40). Two distinct users
     produce two distinct hashes (SHA-256 of distinct UUID inputs); no
     collision risk within the v1 user-base scale (2^256 hash space vs
     10^4 expected users). A test asserts two seed users produce
     distinct anonymized emails.
   - **Server-only:** the file MUST start with `import 'server-only';`
     per ADR-0007 — the helper takes a privileged DB client and must not
     be bundled into client code. Verified by a source-grep assertion in
     the unit test.
   - **No `crypto.subtle` / Node `crypto` import in this file:** the
     SHA-256 happens **in Postgres** via the SQL expression above
     (`encode(digest(..., 'sha256'), 'hex')` from `pgcrypto`, enabled in
     AC1's migration). This keeps the helper's pure-TS surface tight and
     means the hash is deterministic across Node versions and Edge
     runtime.

   Verifiable by `tests/privacy/soft-delete.test.ts` (pglite-backed,
   reusing `tests/db/_fixtures/rls-helpers.ts` and `seedProfile`).
   Sub-cases: first call mutates and returns `mutated: true`; second
   call returns `mutated: false`; row's `full_name` and `email` carry
   the `del:<hex>` token shape (regex `/^del:[0-9a-f]{64}$/` for
   `full_name`; `/^del:[0-9a-f]{64}@deleted\.local$/` for `email`);
   `phone` is NULL after delete; `deleted_at` is non-NULL after delete;
   missing-profile returns `{ mutated: false }` without throwing; two
   distinct seeded users produce two distinct anonymized emails; the
   row's `id` and `dob` are unchanged (anonymization is column-scoped
   per Out of scope on full PII purge).

4. **`POST /api/privacy/delete` route at `app/api/privacy/delete/route.ts`**
   implements the destructive delete endpoint with these properties:
   - Default-export shape:
     `export async function POST(request: Request): Promise<Response>`.
   - Reads the session via `lib/supabase/server.ts createClient()` and
     calls `supabase.auth.getUser()`. If the response has no user, the
     route responds **401 `{ error: 'unauthorized' }`** with
     `Content-Type: application/json` — does NOT redirect, does NOT call
     `softDeleteProfile`, does NOT write an audit row.
   - On valid session: instantiates `createAdminClient()` (service-role;
     RLS bypass) and calls `softDeleteProfile(user.id, adminClient)`.
     Then:
     1. Calls `withAudit(tx, params, async (tx) => ...)` (via
        `lib/audit/withAudit.ts`) wrapping the soft-delete and audit
        entry in **one transaction** per AC6 of the audit-log spec. The
        audit params:
        `action = 'privacy.account_deleted'`,
        `target_type = 'profile'`,
        `target_id = user.id`,
        `actorId = user.id` (the user IS the actor for self-initiated
        deletion — NOT NULL, NOT the service-role bypass path; the audit
        row records who pulled the trigger),
        `ip` = best-effort from
        `request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()`
        (single-IP extraction per `withAudit`'s `ip` contract);
        `userAgent = request.headers.get('user-agent') ?? undefined`.
     2. **The audit `before` / `after` snapshots MUST NOT contain PII.**
        `before = { deleted_at: null }`, `after = { deleted_at: '<ISO timestamp>' }`.
        Do NOT include `email`, `full_name`, or `phone` in either
        snapshot — the audit row survives forever (ADR-0006 retention),
        and we just promised to remove PII from `profiles`. This is the
        load-bearing PII-leak guard.
     3. Calls `supabase.auth.signOut()` on the SESSION-scoped client
        (the non-admin one) so the user's cookies are invalidated.
   - On idempotency: if `softDeleteProfile` returns `mutated: false`
     (user already deleted), the endpoint **still signs the user out
     and writes no second audit row**. Response is
     **200 `{ ok: true, alreadyDeleted: true }`**. (Double-delete is
     harmless; double-audit would be noise.)
   - On success: returns **200 `{ ok: true, alreadyDeleted: false }`**.
     The caller (member UI, AC8) handles the redirect-to-`/` on
     response.
   - On unexpected error (DB exception, audit-write failure): the
     `withAudit` transaction rolls back per its one-transaction
     invariant — neither the soft-delete nor the audit row commits —
     and the endpoint returns **500 `{ error: 'internal' }`**. **Does
     NOT leak the underlying error message** (it may contain PII or
     stack traces).

   Verifiable by `tests/privacy/api-delete.test.ts` (vitest + mocked
   Supabase clients per the existing cookie-banner test pattern).
   Sub-cases: 401 on no session; 200 on first delete with audit row
   written via mocked `withAudit`; 200 with `alreadyDeleted: true` on
   repeated calls (no second audit); 500 on simulated DB throw (no
   audit, no soft-delete); audit `before` / `after` JSON does NOT
   include `email` / `full_name` / `phone` keys (positive PII-leak
   guard — `JSON.stringify(audit.before + audit.after)` does not match
   `/email|full_name|phone/`).

5. **`POST /api/privacy/export` route at
   `app/api/privacy/export/route.ts`** implements the synchronous
   data-export endpoint:
   - Default-export shape:
     `export async function POST(request: Request): Promise<Response>`.
   - Reads the session via `lib/supabase/server.ts createClient()`. If
     no user, responds **401 `{ error: 'unauthorized' }`**.
   - On valid session: runs two SELECTs scoped to the caller:
     1. `SELECT id, full_name, dob, phone, email, role, created_at, updated_at, deleted_at
         FROM profiles WHERE id = $1` — the caller's own profile row.
        Runs through the **RLS-scoped session client**; RLS policy
        `profiles_select_self_or_staff` already gates this to the calling
        user.
     2. `SELECT id, action, target_type, target_id, before, after, ip,
         user_agent, created_at
         FROM audit_log WHERE actor_id = $1 ORDER BY created_at ASC` —
        every audit row the caller was the actor of. **RLS gates this
        read:** the existing `audit_log_select_manager` policy denies
        non-manager SELECTs, so a direct member-scoped query returns
        zero rows under RLS. To make the scoped read work, the route
        uses the **admin client + explicit `WHERE actor_id = user.id`
        predicate** — the admin client bypasses RLS, but the SQL-level
        predicate enforces the caller-scope. This is the same pattern
        the future export of Stripe / ledger data will use, so it ships
        now.
   - Response shape:
     **200 JSON `{ generatedAt: <ISO>, schemaVersion: 1, profile: <row>,
     auditLog: [<row>, ...], stripe: null, sentry: null, posthog: null }`**
     where the three null fields are documented as "deferred — populated
     in Slice 2 when ADR-0009 / 0010 / 0014 / 0028 ratify". The `null`
     placeholders ship now so the response shape is forward-compatible.
   - Response headers: `Content-Type: application/json`,
     `Content-Disposition: attachment; filename="mopc-privacy-export-<user.id>.json"`,
     `Cache-Control: private, no-store`. The `Content-Disposition` makes
     the browser save-as-file when the response is fetched via blob
     (AC8's UI path); `Cache-Control: private, no-store` prevents Vercel
     edge caching of personal data.
   - On idempotency: export is a read-only query, no audit row is
     written for the export itself. (A future ADR-0023 slice may add
     an audit entry; out of scope this slice.)
   - On unexpected error: returns **500 `{ error: 'internal' }`** —
     does NOT leak the underlying error.

   Verifiable by `tests/privacy/api-export.test.ts`. Sub-cases: 401 on
   no session; 200 returns `profile.id === user.id`; 200 returns
   `auditLog` filtered to `actor_id === user.id` only; response carries
   the `Content-Disposition: attachment; filename="mopc-privacy-export-..."`
   header; response carries `Cache-Control: private, no-store`;
   response JSON has the exact keys
   `{ generatedAt, schemaVersion, profile, auditLog, stripe, sentry, posthog }`
   (no surprise keys); 500 on simulated DB throw with NO leak of the
   underlying error message.

6. **`app/(marketing)/privacy/page.tsx`** is rewritten from the current
   "under construction" stub to render the **plain-language privacy
   policy** content. The body content lives in
   **`lib/legal/privacy-policy.tsx`** as a default-exported pure React
   component (no Server-Component data fetching, no client hooks) so
   the policy is versioned in the codebase and can be re-rendered
   identically from anywhere (for example, a future signup-flow modal).
   The policy module exports:

   ```typescript
   // lib/legal/privacy-policy.tsx
   // TODO(travis): legal review before public launch — mirrors the
   //   ADR-0024 cookie-banner copy posture. Engineering-authored
   //   placeholder.

   export const PRIVACY_POLICY_VERSION = '2026-05-14' as const;
   export const PRIVACY_POLICY_EFFECTIVE_DATE = '2026-05-14' as const;

   export default function PrivacyPolicy(): JSX.Element;
   ```

   Content sections (each an `<h2>` with member-readable copy mirroring
   ADR-0023's "Categories of data" / "Member-initiated rights" /
   "Retention schedule" sections; no marketing-speak, no legal jargon
   beyond unavoidable terms): `What we collect`, `How we use it`,
   `Who sees it`, `How long we keep it`, `Your rights`,
   `Cookies & tracking`, `Children`, `Changes to this policy`,
   `Contact us`. The `How long we keep it` section MUST explicitly
   state that financial records (ledger / payment) are retained per
   legal exception — this carries forward to the member-UI delete
   dialog (AC8) so members can't claim they weren't told.

   The page itself is small and delegates rendering:
   ```tsx
   // app/(marketing)/privacy/page.tsx
   import PrivacyPolicy, {
     PRIVACY_POLICY_EFFECTIVE_DATE,
     PRIVACY_POLICY_VERSION,
   } from '@/lib/legal/privacy-policy';

   export const metadata = { /* existing metadata stays */ };

   export default function Page() {
     return (
       <main className="container mx-auto py-12 prose">
         <h1>Privacy</h1>
         <p className="text-sm text-text-muted">
           Effective {PRIVACY_POLICY_EFFECTIVE_DATE} (version {PRIVACY_POLICY_VERSION})
         </p>
         <PrivacyPolicy />
       </main>
     );
   }
   ```

   The page MUST retain the existing `metadata` export (title,
   description, OpenGraph) added by ADR-0030 — don't drop it on the
   rewrite.

   Verifiable by `tests/privacy/policy-page.test.tsx`: renders
   `PrivacyPolicy` and asserts the 9 section headings are present
   (`getByRole('heading', { level: 2, name: /^What we collect$/i })`
   and similar for all 9); asserts the `PRIVACY_POLICY_VERSION`
   constant is exported and is a non-empty string in `YYYY-MM-DD`
   format (regex `/^\d{4}-\d{2}-\d{2}$/`); asserts the page-level
   component renders the version string and delegates body to
   `<PrivacyPolicy />`; source-grep that `lib/legal/privacy-policy.tsx`
   contains `// TODO(travis): legal review` per the ADR-0024
   placeholder pattern.

7. **Cookie-banner footer link gains a Privacy-policy entry.**
   `lib/consent/copy.ts` is extended with a new `COPY.policy_link` key
   (default value: `'Privacy policy'`). The banner UI in
   `components/site/cookie-banner.tsx` adds a small text link beneath
   the three action buttons reading the value of `COPY.policy_link`
   and linking to `/privacy` via `next/link`. The link MUST:
   - Use `<Link href="/privacy">` (not a raw `<a>`).
   - Have a visible label equal to `COPY.policy_link`.
   - Be inside the `aria-label="Cookie consent"` `region` so screen
     readers announce it as part of the banner.
   - Carry `className` tokens that do NOT introduce new colors — reuse
     existing `text-ivory-200` + underline utilities.

   This is the only UI surface change to the existing cookie-banner
   component. The customize panel is NOT modified in this slice.

   Verifiable by an addition to `tests/consent/cookie-banner.test.ts`:
   asserts that when the banner renders (`isLoaded && state === null`),
   `getByRole('link', { name: /privacy policy/i })` resolves to an
   anchor with `href="/privacy"`; and an addition to
   `tests/consent/copy.test.ts` asserting `COPY.policy_link` is a
   non-empty string.

8. **Profile / Privacy member-UI page at
   `app/(member)/profile/privacy/page.tsx`** ships a **client
   component** (`'use client'`) — the destructive buttons need
   browser-side `fetch` and AlertDialog state. The page renders:
   - An `<h1>Privacy & data</h1>` heading.
   - A short paragraph linking to the marketing `/privacy` policy.
   - Two `<section>` blocks:
     1. **Download my data** — a `<button>` labelled "Download my
        data". On click:
        `fetch('/api/privacy/export', { method: 'POST' })`, await
        `response.blob()`, create an object URL via
        `URL.createObjectURL(blob)`, programmatically click an anchor
        with `download="mopc-privacy-export.json"` to trigger the save
        dialog, then `URL.revokeObjectURL` after the click. On 401
        (auth lost mid-session): redirect to
        `/login?next=/profile/privacy`. On 500: render an inline error
        message with `role="alert"` reading "Export failed. Please try
        again or contact support."; do NOT throw to the global error
        boundary.
     2. **Delete my account** — a `<button>` labelled "Delete my
        account", styled as destructive (red accent — reuse existing
        Tailwind token; do NOT introduce a new color). On click: opens
        a Radix `<AlertDialog>` built on `@radix-ui/react-alert-dialog`
        (which MUST be added to `dependencies` in this slice — it is
        not currently installed; see Touched-files inventory). The
        dialog mandates the following a11y contract mirroring
        ADR-0024's customize-panel:
        - `<AlertDialog.Title>` reads "Delete your account?"
        - `<AlertDialog.Description>` reads "This anonymizes your name,
          email, and phone, and signs you out. Financial and audit
          records are retained per law. This cannot be undone."
        - Two actions: `<AlertDialog.Cancel>` labelled "Cancel" with
          **initial focus** (so a keyboard user can dismiss without
          committing); `<AlertDialog.Action>` labelled "Delete my
          account" styled destructive.
        - Esc closes (Radix default).
        - `aria-modal="true"` on the dialog content (Radix default).
        Clicking the destructive Action:
        `fetch('/api/privacy/delete', { method: 'POST' })`. On 200:
        `window.location.assign('/')` (the user is already signed out
        server-side; full reload clears all stale React state). On 401
        or 500: render an inline error message with `role="alert"`
        reading "Account deletion failed. Please try again or contact
        support."

   The page MUST live inside the `(member)` route group so the
   existing `(member)/layout.tsx` redirect-to-login gate protects it —
   anonymous users hit `/profile/privacy` and get redirected to
   `/login?next=/profile/privacy` automatically.

   Verifiable by `tests/privacy/profile-privacy-page.test.tsx`
   (vitest + `@testing-library/react`):
   - Renders both buttons with the documented labels.
   - Clicking "Delete my account" opens the AlertDialog
     (`getByRole('alertdialog')` resolves).
   - Initial focus inside the dialog lands on "Cancel"
     (`document.activeElement` equals the Cancel button).
   - Clicking Cancel closes the dialog without firing `fetch`
     (`fetch` spy assertions: `expect(fetchSpy).not.toHaveBeenCalled()`).
   - Clicking the destructive Action fires
     `fetch('/api/privacy/delete', { method: 'POST' })` exactly once.
   - On a mocked-200 export response, the page creates a blob URL and
     programmatically triggers a download (assert
     `URL.createObjectURL` was called with a Blob; assert
     `revokeObjectURL` was called afterwards).
   - On a mocked-500 export response, the page renders the inline
     `role="alert"` error message.

9. **Profile page sidebar / inline link to the Privacy section.** The
   existing `app/(member)/profile/page.tsx` renders read-only profile
   data; this slice adds a
   **`<Link href="/profile/privacy">Privacy & data</Link>`** below the
   `<dl>` so the new page is discoverable from the profile. Single-line
   addition; no other change to the profile page.

   Verifiable by `tests/privacy/profile-link.test.tsx` (or an
   extension of an existing profile-page test if present): asserts the
   rendered profile page includes an anchor with text matching
   `/privacy & data/i` and `href="/profile/privacy"`.

10. **`pnpm migrate:check`** (the existing safety scanner at
    `scripts/check-migration-safety.mjs`) passes on
    `supabase/migrations/0004_privacy_soft_delete.sql` with no
    findings. The migration is purely additive at the column / index /
    extension level (`CREATE EXTENSION`, `ADD COLUMN`, `CREATE INDEX`)
    and surgical at the policy level (`DROP POLICY` + `CREATE POLICY`
    for one named policy). The `DROP POLICY` may require a
    `migration-review: policy-replace-approved` acknowledgement comment
    if the scanner flags it — the worker adds the comment with text
    justifying why the drop is safe (the new policy is created in the
    same transaction, no window of unprotected access).

11. **`pnpm typecheck`** passes — including new TypeScript surfaces
    (`lib/privacy/retention.ts`, `lib/privacy/soft-delete.ts`,
    `lib/legal/privacy-policy.tsx`, `app/api/privacy/export/route.ts`,
    `app/api/privacy/delete/route.ts`,
    `app/(member)/profile/privacy/page.tsx`, the test files, the
    `@radix-ui/react-alert-dialog` types). `tsc --noEmit` over the
    repo must be green.

12. **`pnpm lint`** passes. New files conform to the existing ESLint /
    Prettier config; no new lint rule additions are in scope.

13. **No PII leak into audit rows (cross-cutting structural
    assertion).** A vitest source-grep test at
    `tests/privacy/no-pii-in-audit.test.ts` parses the text of
    `app/api/privacy/delete/route.ts` and asserts that the substrings
    `'email'`, `'full_name'`, `'phone'` do NOT appear inside the
    `before:` / `after:` literal-object passed to `withAudit`. This is
    a coarse but high-signal regression guard against a future
    "refactor for cleanliness" pass that decides to include the
    just-anonymized values in the audit row (which would defeat the
    point — the audit row survives forever).

14. **Cycle 1-3 regression — minimal-edit, zero-failure contract.** The
    existing `tests/db/rls-profiles.test.ts`, `tests/db/audit-log.test.ts`,
    `tests/audit/with-audit.test.ts`,
    `tests/migrations/profiles-shape.test.ts`,
    `tests/migrations/audit-log-shape.test.ts`, and
    `tests/consent/*.test.ts` MUST continue to pass. The new migration
    adds a column to `profiles`; the cycle-1 test fixture's
    column-permissive design (per `seedProfile`'s
    `[extra: string]: unknown` index signature) handles this
    automatically — no edits needed to fixtures. The new policy
    `profiles_select_active_for_staff` is additive; the
    `profiles_select_self_or_staff` rewrite changes the USING clause —
    **expected delta:** `tests/migrations/profiles-shape.test.ts`'s
    AST assertion for that policy's USING clause needs a surgical
    patch (now references `deleted_at` and the threshold rises from
    `cashier` to `manager`). All other cycle-1 RLS behavior tests
    should be unaffected because they seed `deleted_at IS NULL` rows
    and the new USING clause is equivalent in that case. **If any
    cycle-1 behavior test fails because of this slice, it MUST be
    updated in the same slice and re-justified in the spec's iteration
    history** — silent test edits beyond the one documented shape-test
    patch are a fidelity fail.

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Grouped into the four
waves the conductor invocation specified, plus a Wave 5 gauntlet pass.

### Wave 1 — Migration + pure-code lib (parallel-safe; no deps on later waves)

- **W1.T0 — Add `@radix-ui/react-alert-dialog` dep.** Adds the package
  to `dependencies`. Run `pnpm install`. Validate `pnpm typecheck`
  still green (no callers yet). (~30min)

- **W1.T1 — Migration `0004_privacy_soft_delete.sql` (AC1).**
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;`, add `deleted_at` column,
  partial index `profiles_active_idx`, DROP + CREATE the SELECT policy
  with the new USING clause, add the second staff-active policy. End
  with COMMENTs. Validate `pnpm migrate:check`. (~2h)

- **W1.T2 — Migration shape test
  `tests/migrations/privacy-soft-delete-shape.test.ts` (AC1, AC14).**
  Two-tier (regex + pg-query-emscripten AST), mirroring
  `tests/migrations/audit-log-shape.test.ts`. Regex tier: filename
  pattern; `deleted_at` column literal; `profiles_active_idx` name;
  `DROP POLICY profiles_select_self_or_staff` AND `CREATE POLICY
  profiles_select_self_or_staff` both present; `CREATE POLICY
  profiles_select_active_for_staff` present; absence of any UPDATE-policy
  rewrite. AST tier: the new SELECT policy's USING clause references
  `deleted_at IS NULL` AND `auth.role_at_least('manager')` (the
  threshold rose); the second policy references
  `auth.role_at_least('cashier')` AND `deleted_at IS NULL`. (~3h)

- **W1.T3 — `lib/privacy/retention.ts` + `tests/privacy/retention.test.ts`
  (AC2).** Pure-TS module per AC2 contract. Tests: per-category
  equality; purity; type-level exhaustiveness via `expectTypeOf` and
  `@ts-expect-error`. (~2h)

- **W1.T4 — `lib/privacy/soft-delete.ts` + `tests/privacy/soft-delete.test.ts`
  (AC3).** `import 'server-only';` first line. Single SQL UPDATE with
  `WHERE id = $1 AND deleted_at IS NULL` and the `del:<sha256>` token
  derivation done in-SQL via `encode(digest(id::text::bytea, 'sha256'),
  'hex')`. Tests pglite-backed (reuse `tests/db/_fixtures/rls-helpers.ts`'s
  service-role context for setup, then call the helper directly — the
  helper takes the structural `TransactionClient` interface, so pglite
  is wired by name). (~4h)

  **Open Q resolution required at planner time:** the helper's
  signature uses `TransactionClient` (the structural interface that
  also matches the cycle-2 `withAudit` shape). Default: **structural
  interface** with a `query(sql, params)` method; the production
  caller (the delete route) wraps the Supabase admin client in a thin
  adapter. The planner confirms before W1.T4 lands.

### Wave 2 — API routes (depends on W1 helpers)

- **W2.T5 — `app/api/privacy/delete/route.ts` +
  `tests/privacy/api-delete.test.ts` (AC4, AC13).** POST route per AC4
  contract. Reuses `lib/audit/withAudit.ts` for the one-transaction
  soft-delete + audit insert. Test mocks Supabase server client and
  admin client (existing pattern in the consent test suite). Includes
  the PII-leak source-grep guard (AC13). (~4h)

- **W2.T6 — `app/api/privacy/export/route.ts` +
  `tests/privacy/api-export.test.ts` (AC5).** POST route per AC5
  contract. Uses RLS-scoped SELECT for profile + admin-client +
  WHERE-actor_id for audit log. Tests assert key shape, scoping to
  caller's user id, response headers (Content-Disposition,
  Cache-Control), and 401 / 500 branches. (~3h)

### Wave 3 — `/privacy` policy page + footer link (depends on W1; parallel with W2)

- **W3.T7 — `lib/legal/privacy-policy.tsx` (AC6).** Pure React
  component exporting `PRIVACY_POLICY_VERSION`,
  `PRIVACY_POLICY_EFFECTIVE_DATE`, and the default `PrivacyPolicy`
  component with 9 section headings. Engineering-authored copy +
  `// TODO(travis): legal review` per the ADR-0024 pattern. (~3h)

- **W3.T8 — Rewrite `app/(marketing)/privacy/page.tsx` (AC6).**
  Delegate to `<PrivacyPolicy />`; keep existing metadata. (~1h)

- **W3.T9 — Add `COPY.policy_link` + Privacy link in cookie banner
  (AC7).** Modify `lib/consent/copy.ts` to add the new key. Modify
  `components/site/cookie-banner.tsx` to render a `next/link` to
  `/privacy` inside the existing `region`. Extend
  `tests/consent/cookie-banner.test.ts` and
  `tests/consent/copy.test.ts` to cover the new key and the new
  banner-link element. (~2h)

- **W3.T10 — Policy page tests
  `tests/privacy/policy-page.test.tsx` (AC6).** Renders
  `PrivacyPolicy` and asserts the 9 section headings + version export
  shape. (~1h)

### Wave 4 — Member profile UI (depends on W1.T0 for AlertDialog; parallel with W2/W3)

- **W4.T11 — `app/(member)/profile/privacy/page.tsx` (AC8).**
  `'use client'` component with two destructive buttons, AlertDialog
  confirmation for delete, blob-download flow for export, inline-error
  rendering for the 500 branches. (~5h)

- **W4.T12 — Profile link to Privacy page (AC9).** Add
  `<Link href="/profile/privacy">Privacy & data</Link>` to
  `app/(member)/profile/page.tsx`. Surgical one-line addition plus
  the Link import. (~30min)

- **W4.T13 — Member-UI tests
  `tests/privacy/profile-privacy-page.test.tsx` +
  `tests/privacy/profile-link.test.tsx` (AC8, AC9).** RTL renders,
  click flows, fetch-mock assertions, blob URL spy assertions. (~4h)

### Wave 5 — Gauntlet + cross-cutting (after Waves 1-4)

- **W5.T14 — PII-leak source-grep test
  `tests/privacy/no-pii-in-audit.test.ts` (AC13).** Reads the source
  of `app/api/privacy/delete/route.ts`, parses out the
  `before: { ... }` / `after: { ... }` literals via a small regex,
  asserts they don't contain PII keys. (~1h)

- **W5.T15 — Final gauntlet.** Run all acceptance commands; verify
  cycle-1/2/3 regression (AC14) — `tests/db/rls-profiles.test.ts`,
  `tests/db/audit-log.test.ts`, `tests/audit/with-audit.test.ts`,
  `tests/consent/*.test.ts` all green without semantic edits beyond
  the one documented shape-test patch in
  `tests/migrations/profiles-shape.test.ts`. Iteration-history that
  patch when it lands. (~2h)

## Touched-files inventory

Best estimate; workers may exceed if needed.

- **Create**
  - `supabase/migrations/0004_privacy_soft_delete.sql` — `pgcrypto`
    extension + `deleted_at` column + partial index + replacement
    SELECT policies (AC1, W1.T1)
  - `lib/privacy/retention.ts` — typed retention schedule helper
    (AC2, W1.T3)
  - `lib/privacy/soft-delete.ts` — `softDeleteProfile` server-only
    helper (AC3, W1.T4)
  - `lib/legal/privacy-policy.tsx` — pure React policy component
    with `PRIVACY_POLICY_VERSION` + `EFFECTIVE_DATE` exports (AC6,
    W3.T7)
  - `app/api/privacy/delete/route.ts` — POST handler (AC4, W2.T5)
  - `app/api/privacy/export/route.ts` — POST handler (AC5, W2.T6)
  - `app/(member)/profile/privacy/page.tsx` — `'use client'` member
    UI page with destructive AlertDialog (AC8, W4.T11)
  - `tests/migrations/privacy-soft-delete-shape.test.ts` (AC1, W1.T2)
  - `tests/privacy/retention.test.ts` (AC2, W1.T3)
  - `tests/privacy/soft-delete.test.ts` (AC3, W1.T4 — pglite-backed)
  - `tests/privacy/api-delete.test.ts` (AC4, W2.T5)
  - `tests/privacy/api-export.test.ts` (AC5, W2.T6)
  - `tests/privacy/policy-page.test.tsx` (AC6, W3.T10)
  - `tests/privacy/profile-privacy-page.test.tsx` (AC8, W4.T13)
  - `tests/privacy/profile-link.test.tsx` (AC9, W4.T13)
  - `tests/privacy/no-pii-in-audit.test.ts` (AC13, W5.T14)
- **Modify**
  - `app/(marketing)/privacy/page.tsx` — delegate body to
    `<PrivacyPolicy />`; keep metadata (AC6, W3.T8)
  - `lib/consent/copy.ts` — add `COPY.policy_link` key (AC7, W3.T9)
  - `components/site/cookie-banner.tsx` — render Privacy-policy link
    inside the existing `region` (AC7, W3.T9)
  - `tests/consent/cookie-banner.test.ts` — extend with policy-link
    assertion (AC7, W3.T9)
  - `tests/consent/copy.test.ts` — extend with `policy_link`
    non-empty assertion (AC7, W3.T9)
  - `app/(member)/profile/page.tsx` — add Privacy & data link (AC9,
    W4.T12)
  - `tests/migrations/profiles-shape.test.ts` — surgical patch for
    the new USING clause AST assertion (AC14, W5.T15)
  - `package.json` + `pnpm-lock.yaml` — add
    `@radix-ui/react-alert-dialog` to `dependencies` (AC8, W1.T0)

- **No change** (cycle-1/2/3 substrate reused by reference):
  `supabase/migrations/0002_profiles_and_roles.sql`,
  `supabase/migrations/0003_audit_log.sql`,
  `lib/audit/withAudit.ts`, `lib/auth/*`, `lib/supabase/*` (AC14).

## Risk flags

This is the project's high-risk auto-flag list per the spec-writer
template (linked ADRs in {0003, 0004, 0005, 0006, 0009, 0023}).
Phase 1 is expected to auto-trigger `premortem(mode=task)` on this
spec — ADR-0023 is the subject.

- **0023 (this ADR — destructive data deletion):** the delete
  endpoint anonymizes a member's `profiles` row irreversibly. There is
  no undelete path in Slice 1 (out of scope). A bug that mis-targets
  the user id (for example, swaps caller's vs admin's id) would
  anonymize the wrong member. AC4's contract pins
  `softDeleteProfile(user.id, ...)` to the `auth.getUser()` result of
  the SESSION client — not the admin client — precisely because the
  admin client has no session. Premortem mandatory. Mitigation: AC3's
  idempotency contract + AC4's 401-on-no-session contract + AC8's
  AlertDialog with "Cancel" as the initial focus.

- **0006 (audit-log) — destructive flows must audit, audit must not
  leak PII.** The delete endpoint writes
  `action = 'privacy.account_deleted'` via `withAudit`. AC4's pin:
  `before` / `after` carry only `deleted_at` timestamps — NOT `email`,
  `full_name`, or `phone`. The audit row survives forever (ADR-0006
  retention is `forever`); leaking PII into it defeats the point of
  anonymization. AC13 is the source-grep regression guard.

- **0003 (RLS) — export must be RLS-bounded to the caller.** AC5's
  profile-SELECT runs through the RLS-scoped session client. The
  audit-log SELECT runs through the admin client with an explicit
  `WHERE actor_id = user.id` predicate (because the existing
  `audit_log_select_manager` policy denies non-manager SELECTs and the
  export is for members, not managers). The SQL-level scope predicate
  is the load-bearing safety property — a worker who "simplifies" by
  dropping the `actor_id` filter has just turned the export endpoint
  into a manager-only audit-log dump that any authenticated user can
  hit. AC5's positive test asserts `auditLog` is filtered to caller's
  `actor_id` only.

- **Soft-delete policy-rewrite drift.** AC1 replaces the existing
  `profiles_select_self_or_staff` policy. Cycle-1's
  `tests/migrations/profiles-shape.test.ts` has AST assertions on
  that policy's USING clause. AC14's expected delta is documented; a
  worker who rewrites the policy and breaks cycle-1 tests in a way the
  spec does NOT predict has drifted scope. The shape-test patch must
  be surgical and re-justified in iteration history.

- **0010 (payments) / 0009 (KYC) — Slice 1 is structurally incomplete
  by design.** The export's `stripe`, `sentry`, `posthog` keys ship as
  `null` placeholders; the retention helper maps `payment` to 7-year
  retention with no actual payment table to enforce against. This is
  intentional: the surface ships now so the unblock is additive when
  those ADRs ratify. Risk: shipping the surface to staging communicates
  "data deletion works" to a member who tries it and discovers their
  Stripe records are unchanged. **Mitigation: AC6's privacy-policy
  copy MUST explicitly state that financial records are retained per
  legal exception**, and the member-UI deletion dialog (AC8) says the
  same. The placeholder copy is engineering-authored with the
  `// TODO(travis): legal review` flag.

- **0017 (CI/CD) — e2e deferred to CI.** This slice does not ship a
  Playwright spec. The vitest coverage in W1-W5 is comprehensive enough
  that the structural-substitute path is acceptable per the existing
  scope-judge precedent (ADR-0024 set the pattern). A future slice may
  add `tests-e2e/privacy.spec.ts` once ADR-0017 ratifies and the
  Windows-host port-3000 reservation is bypassed via CI.

- **0024 (cookie banner) — touchpoint on the banner UI.** AC7 adds a
  single `next/link` inside the existing `region`. The change is
  surgical; cycle-1's banner tests get one new assertion. No regression
  risk expected, but the banner is the most visible client surface
  added by ADR-0024 and the bundle-weight risk flagged there still
  applies (no new imports beyond `next/link`, which is already in the
  cookie banner page bundle).

- **`pgcrypto` extension fidelity.** AC3 specifies the hash runs **in
  Postgres** via `encode(digest(..., 'sha256'), 'hex')`. Postgres'
  `digest` is available via the `pgcrypto` extension. The cycle-1
  migration does NOT enable `pgcrypto`. The W1.T1 migration MUST run
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the top. Pglite
  supports `pgcrypto` since v0.2 (the devDep version cycle 1 added);
  the test substrate works. If the planner discovers a pglite-version
  fidelity gap, fallback is a future ADR-0023 slice landing
  `lib/crypto/sha256.ts` and computing the hash in Node — but the
  default and recommended path is in-SQL.

- **Idempotency at the API layer.** Repeated POSTs to
  `/api/privacy/delete` return 200 `{ alreadyDeleted: true }` (AC4)
  without writing a second audit row. Repeated POSTs to
  `/api/privacy/export` return the same JSON each call (no audit row
  at all for export). A future webhook / retry attacker cannot DoS
  the audit log by replaying delete POSTs. Out of scope: rate-limiting
  these endpoints — `lib/rate-limit/*` exists; the planner may choose
  to wire the middleware to these routes, but it is not required for
  Slice 1.

## Premortem inputs

Per the ADR-0023 auto-flag, the planner pre-loads these failure modes
when dispatching Phase 1 premortem:

1. **PII leaks into the audit row.** A future "refactor for
   cleanliness" includes the pre-anonymization values (`email`,
   `full_name`, `phone`) in the `withAudit` `before` snapshot. The
   audit row survives forever per ADR-0006 retention; we've just
   defeated the entire anonymization posture. Mitigation: AC13
   source-grep + AC4 contract pin + a comment block in the route file
   marking the snapshot literal as load-bearing.

2. **Wrong-user soft-delete via mis-passed id.** The delete endpoint
   runs with the service-role admin client. If the worker writes
   `softDeleteProfile(adminClient.auth.user.id, ...)` (NULL on the
   admin client — there is no session), the helper updates 0 rows and
   the audit row records a NULL target. Worse, if the worker
   substitutes a request body field for the user id, an authenticated
   attacker can anonymize any user by POSTing their id. Mitigation:
   AC4 pins the source of `user.id` to the SESSION client's
   `getUser()` result. Tests assert 401 when no session. There is **no
   request-body parameter** for the target user id — the route reads
   ONLY from the session.

3. **Audit-log SELECT-leak via export.** The export endpoint reads
   from `audit_log` with `WHERE actor_id = $1`. If a worker drops the
   WHERE clause "to simplify," the endpoint becomes an admin-only
   audit dump accessible to any authenticated member (the admin
   client bypasses RLS). AC5's positive test asserts the response's
   `auditLog` array contains only rows where
   `actor_id === user.id`.

4. **Idempotent double-delete writes double audit rows.** Without
   AC4's `alreadyDeleted` short-circuit, two POSTs to
   `/api/privacy/delete` write two audit rows for the same event.
   Forensics later misreads as a duplicate user action. Mitigation:
   AC4 explicitly skips the audit write when `softDeleteProfile`
   returns `mutated: false`. Tests assert exactly one audit row per
   (user, delete event).

5. **Migration's `DROP POLICY` opens a window of unprotected access.**
   `DROP POLICY` immediately followed by `CREATE POLICY` is atomic
   within the migration transaction (Supabase wraps each migration
   .sql in a single txn). No window exists in practice. Premortem
   mitigation is to assert this explicitly in the migration's
   `migration-review: policy-replace-approved` acknowledgement
   comment (AC10).

## Out of scope

What this slice deliberately does **not** do. Each item is bound to
a future ADR cycle or explicitly declined.

- **Real Stripe / KYC / Sentry / PostHog data in the export.** AC5's
  response carries `stripe: null, sentry: null, posthog: null` as
  forward-compatible placeholders. ADR-0009 (KYC) adds `id_document`
  metadata + signed-URL retrieval; ADR-0010 (payments) adds Stripe
  customer + payment_intent + ledger fetching; ADR-0014 (Sentry)
  adds Sentry-API-side data; ADR-0028 (PostHog) adds
  PostHog-API-side data. All four are currently **blocked** on API
  keys / counsel — Slice 2+.

- **Cron-based retention enforcement.** `lib/privacy/retention.ts`
  is a pure helper. There is no scheduled job that reads the windows
  and deletes data older than the cutoff. The cron + worker landing
  is a Slice 2 task that owns its own ADR slice. The helper exists
  in Slice 1 so the cron's call sites are type-checked when it ships.

- **Email confirmation of deletion / export.** ADR-0025
  (transactional email) is **blocked**. No email goes out when a
  member triggers `/api/privacy/delete` or `/api/privacy/export`.
  The export is a synchronous JSON download in this slice (no
  signed-URL emailed link per ADR-0023's eventual contract). The
  signed-URL flow lands in Slice 2+ once ADR-0025 ratifies.

- **DPA / DPO registration paperwork.** ADR-0023 declined this for
  v1 (single establishment, no large-scale EU monitoring).
  Re-evaluate when member base materially shifts.

- **Account undelete.** Soft-delete is final in Slice 1. There is
  no `unsoftDeleteProfile()` helper. Reactivation requires
  manager-side manual SQL with audit trail — explicitly out of scope
  (and arguably out of scope **forever**: the whole point of
  anonymization is that the original PII is unrecoverable).

- **UPDATE-policy tightening to gate on `deleted_at IS NULL`.** AC1
  notes this gap. A soft-deleted user is signed out immediately
  after the helper runs (AC4), and a re-login is impossible because
  the profile is anonymized — re-login would create a new auth
  session pointing at a row whose `email` no longer matches the
  user's real address. The gap is theoretical in Slice 1. A future
  slice may tighten the UPDATE policy; intentionally not this one
  to keep the migration surgical.

- **Hard-deletion of `auth.users` row.** ADR-0023 mentions "auth
  row deleted" in passing; this slice does NOT delete the auth row.
  The `profiles.deleted_at` marker is the soft-delete signal.
  Deleting the auth row requires the admin client + risks breaking
  the audit_log FK (which has NO ON DELETE CASCADE per ADR-0006 / AC
  by design). A future slice owns the auth-row reaping decision.

- **Cookie scrubbing on delete.** The delete endpoint signs the user
  out (clears the session cookie). It does NOT clear the
  `mopc-consent` cookie, the brand-preference cookies, or any other
  client-side state. Those are next-visit-only artifacts and live on
  the client device (not in our DB) — outside the scope of our
  deletion contract.

- **Rate-limiting `/api/privacy/{export,delete}`.** Considered;
  declined for Slice 1. The endpoints are authenticated, the
  worst-case abuse is a member spamming their own delete
  (idempotent — no harm). `lib/rate-limit/middleware.ts` exists;
  wiring is a 30-min add a future slice can pick up.

- **`/profile/privacy` server-component variant.** AC8 ships a
  client component because the destructive AlertDialog + fetch flows
  need browser-side state. A future slice could split: a
  server-component page that renders read-only retention info, with
  client-component islands for the buttons. Not necessary for
  Slice 1.

- **Translated privacy policy.** ADR-0024 declined i18n for the
  cookie banner; this slice ships English only for the same reason.

- **Audit-row anonymization of historical actor data.** ADR-0006 +
  ADR-0023 specify that audit rows carry the `actor_id` UUID
  forever; anonymization happens at the `profiles` row, not the
  audit row. This slice ships that semantic correctly. No future
  migration converts audit rows.

## Open questions

Surfaced for resolution during planning. **Defaults are the spec
author's recommendation; the planner confirms before t-zero.**

1. **`softDeleteProfile`'s DB-client interface (load-bearing —
   promoted to W1.T4 prerequisite).** Default: structural interface
   with a `query(sql, params)` method, mirroring the `withAudit`
   `TransactionClient` pattern. Cycle 2's resolution of the same
   question is the precedent.

2. **`pgcrypto` extension enablement.** AC3 + Risk Flags note this.
   Default: the migration `0004_privacy_soft_delete.sql` runs
   `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the top, and
   `softDeleteProfile`'s SQL uses
   `encode(digest(id::text::bytea, 'sha256'), 'hex')`. The planner
   confirms pglite (the devDep version cycle 1 added) supports
   `pgcrypto`; if not, fallback is the SHA-256 helper from a future
   ADR-0023 slice that lands a `lib/crypto/sha256.ts` server-only
   helper.

3. **Privacy-policy copy review.** The spec ships engineering-authored
   placeholder copy in `lib/legal/privacy-policy.tsx` with a
   `// TODO(travis): legal review before public launch` flag,
   mirroring ADR-0024 Open question 1. Resolution: ship the
   placeholder; counsel review is owner-track and gates public
   launch, not Slice 1 ship-to-staging. The 9 section headings match
   ADR-0023's outline so the counsel review can red-line copy
   without restructuring the document.

4. **Export endpoint: GET vs POST.** AC5 ships POST. Justification:
   POST matches the imperative "trigger an export" framing; a GET
   would suggest a cacheable resource and tempt CDN edge caches into
   storing personal data. `Cache-Control: private, no-store` is the
   belt-and-suspenders for any CDN that ignores the verb. The
   member-UI `fetch` (AC8) explicitly uses `method: 'POST'`.

5. **Export response format: JSON inline vs signed-URL emailed
   link.** ADR-0023's eventual contract is the signed-URL
   emailed-link pattern (24hr TTL). Slice 1 ships the inline JSON
   because ADR-0025 (email) is blocked. A future slice swaps the
   response shape; the `Content-Disposition: attachment` header in
   Slice 1 means a member gets a downloadable file today, and the
   upgrade to email-and-signed-URL is an additive change to the same
   endpoint.

6. **AlertDialog: shadcn wrapper vs raw Radix.** AC8 specifies
   `@radix-ui/react-alert-dialog`. The project currently does NOT
   have a shadcn `<AlertDialog />` wrapper component under
   `components/ui/`. Default: ship the page with **raw Radix
   primitives** (the AlertDialog API is small enough that a wrapper
   is overkill for one call site). A future slice adds the shadcn
   wrapper if/when a second call site materializes. The planner
   confirms before W4.T11 lands.

## Iteration history

- **Revision 1 (2026-05-14):** initial spec authored for ADR-0023
  Slice 1. Scaffolding-first scope: migration adds `deleted_at` +
  partial index + `pgcrypto`; `lib/privacy/{retention,soft-delete}.ts`;
  two POST API routes; a versioned policy module at
  `lib/legal/privacy-policy.tsx`; the cookie-banner gets a
  privacy-policy link; the member profile area gets a
  `/profile/privacy` page with AlertDialog confirmation. Real
  Stripe / KYC / Sentry / PostHog data is OUT — those ADRs are
  blocked. 14 acceptance criteria (AC14 is the cross-cycle
  regression). 15 task cuts in 5 waves. 6 open questions (Open Q 1
  promoted to W1.T4 prerequisite; Open Q 2 needs planner
  confirmation against pglite's pgcrypto support).
