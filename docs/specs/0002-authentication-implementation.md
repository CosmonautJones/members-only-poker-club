---
adr: 0002
slice: 2
risk: high
acceptance_commands:
  - 'pnpm typecheck'
  - 'pnpm lint'
  - 'pnpm test tests/auth/'
  - 'pnpm test tests/db/rls-profiles.test.ts'
  - 'pnpm test tests/audit/with-audit.test.ts'
  - 'pnpm test scripts/conductor/'
---

# Spec: Authentication & session management — email + password signup, login, gated member layout (ADR-0002 cycle 3)

- **ADR:** [0002](../adr/0002-authentication-and-session-management.md)
- **Status:** Draft (revision 2)
- **Date:** 2026-05-09

## Goal

Land the **first authenticated, member-facing surface** of the app: an
email + password signup flow with a 21+ DOB gate, a login flow, password
reset and email confirmation landing pages, a logout endpoint, a `lib/auth/`
helper module (`getCurrentProfile`, `requireRole`, `signOut`), a service-role
Supabase client at `lib/supabase/admin.ts` (NEW — required so signup can
INSERT into `profiles` despite RLS denying it), an extension to the existing
`middleware.ts` matcher that gates `/dashboard`, `/profile`, and the
future-proof `/admin/*` prefix with a `next=` redirect to `/login`, and
a minimal `app/(member)/` layout + dashboard + profile stub that proves
end-to-end the session-cookie → server-component → profiles-read path
works against real Supabase.

This is **Slice 2 of the project plan** (membership + auth + SMS skeleton)
and **cycle 3 of 6 in the ADR-driven implementation queue.** It builds on
cycle 1 (`profiles` + `role_t` enum + RLS) and cycle 2 (`audit_log` +
`withAudit` helper). The prior two cycles shipped schema + helper substrate
with no UI binding; cycle 3 is the first cycle whose output is something a
human visiting the site can interact with.

**Identity providers shipped this cycle: email + password ONLY.** Magic-link
and Google OAuth are explicitly DEFERRED (see Out of scope). MFA TOTP for
staff lands in cycle 5 (admin dashboard) per the original 6-cycle plan.

**Test substrate continues with `@electric-sql/pglite` for unit + integration
tests where pglite can model the assertion** (server-action input validation,
DOB gate, lib/auth helpers, profiles INSERT round-trip via service-role-equivalent
in pglite). **Playwright E2E for the auth flow is DEFERRED**: cycle 1 + 2
established the host has neither Docker nor a real Supabase project, and
exercising the full HTTP/cookie/middleware/Supabase round-trip without one
is fidelity theater. See Out of scope for the deferral contract — the spec
ships unit + integration coverage for the server-action surface and defers
HTTP-level E2E to a future "real-Supabase test environment" cycle.

## Supabase recovery-flow shape — RESOLVED (formerly Open Q §2)

Per critic concern C2 (revision 1 → 2), this is now PINNED, not deferred.

**Verdict: Supabase's PKCE flow with `@supabase/ssr` uses QUERY PARAMETERS
(`?token_hash=...&type=recovery`), NOT URL fragments.** Verification happens
server-side via `supabase.auth.verifyOtp({ token_hash, type })`. The
reset-password landing page is therefore a **server component** (no
`'use client'` boundary required for token exchange).

**Source / citation (queried 2026-05-09):**

- Supabase official docs — "Resetting a password — PKCE flow" at
  <https://supabase.com/docs/guides/auth/passwords#resetting-a-password>.
  Direct quote from the docs: *"the PKCE flow requires an intermediate
  token exchange step before you can get the access token"* — and the
  canonical Next.js confirmation endpoint reads `token_hash` and `type`
  from `searchParams` server-side, calls `supabase.auth.verifyOtp({ type,
  token_hash })`, and redirects.
- The same flow shape applies to BOTH the email-confirm signup callback
  AND the password-recovery callback. The `type` query param disambiguates
  (`type=signup` vs `type=recovery`).
- `@supabase/ssr` (the SSR client this project uses per ADR-0002) defaults
  to the PKCE flow. There is no project-level config required to opt in.

**Implication for cycle 3 — the architecture is RSC-only for both
auth callback pages:**

- `app/(auth)/confirm/route.ts` — **GET route handler (NOT a page).** Reads
  `?token_hash=` and `?type=` from `request.nextUrl.searchParams`, calls
  `supabase.auth.verifyOtp({ token_hash, type })` server-side, redirects to
  `/dashboard` on success or `/auth/auth-code-error` on failure. Mirrors
  the canonical Supabase Next.js docs pattern verbatim. (Replaces the
  prior revision-1 `app/(auth)/confirm/page.tsx`.)
- `app/(auth)/reset-password/page.tsx` — **server component.** Reads
  `searchParams.token_hash` and `searchParams.type` (from the page-level
  `searchParams` prop). On GET with valid `token_hash` + `type=recovery`,
  immediately calls `supabase.auth.verifyOtp({ token_hash, type })` to
  establish the session cookie. Then renders the
  `{ password, confirmPassword }` form. The form's server action calls
  `supabase.auth.updateUser({ password })` and redirects to `/dashboard`.
  No `'use client'` boundary is needed.

This resolution closes critic concerns **C2 and C5** in one pass. The
state-machine concern from C5 dissolves entirely under the query-param
flow — the verifyOtp call happens server-side before the form renders, so
there is no `idle → exchanging → ready` client state to manage.

**Versioning / drift contract:** if a future Supabase release migrates
the recovery flow to URL fragments (the older "implicit flow"), the
reset-password page will need to become `'use client'` and add an explicit
state machine. Cycle 3 pins the current shape (PKCE + query-param) at
spec time; a future cycle re-pins if the flow drifts. The spec's
Operator Setup section documents the Supabase Studio email-template
configuration that produces the query-param URL.

## Acceptance criteria

Numbered, testable. Each is verified by one of the acceptance commands
above. Numbering follows the cycle 1 / cycle 2 convention (each AC binds to
a runnable command).

1. **`lib/supabase/admin.ts` — service-role client (NEW THIS CYCLE).**
   - File starts with `import 'server-only';` per ADR-0007. Static-source-text
     assertion (matching the cycle 2 AC9.8 pattern via `readFileSync`) in
     `tests/auth/lib-supabase-admin.test.ts`.
   - Exports a single function `createAdminClient()` that returns a
     `@supabase/supabase-js` client constructed with
     `process.env.NEXT_PUBLIC_SUPABASE_URL` and
     `process.env.SUPABASE_SERVICE_ROLE_KEY`.
   - Throws an explicit `Error` (matching the existing
     `lib/supabase/server.ts` guard pattern) if either env var is missing or
     `url.includes('placeholder')` — preserves the marketing-only-deploy
     contract from cycle 1 / Slice 1.
   - The client is constructed with `auth: { persistSession: false,
     autoRefreshToken: false, detectSessionInUrl: false }` — the
     service-role client MUST NOT participate in the cookie-based session
     flow; it is a one-shot privileged client used only for server-side
     RLS-bypass operations (signup INSERT into profiles, future webhook
     handlers).
   - **Anti-leak invariant (load-bearing — DO NOT WEAKEN):** the file MUST
     NOT export the raw `SUPABASE_SERVICE_ROLE_KEY` value, and MUST NOT
     expose any function that returns it as a string. The only exported
     surface is `createAdminClient()`. ADR-0007 explicitly forbids the
     service-role key from leaking into any client bundle; the
     `'server-only'` import is the build-time guard, the test is the
     runtime grep.
   - Verified by `pnpm test tests/auth/lib-supabase-admin.test.ts` and
     `pnpm typecheck`.

2. **Server-action signup at `app/(auth)/signup/page.tsx` + a colocated
   `actions.ts`.** Inputs: `{ email, password, dob (string, ISO date),
   full_name }`. Behavior:
   - **DOB gate (21+ at submission time):** the action computes
     `yearsBetween(dob, today)` (caller-side via `date-fns`'s
     `differenceInYears`); if `< 21`, returns a typed `FormError` shape
     `{ field: 'dob', message: 'Members must be 21 or older.' }` WITHOUT
     calling Supabase. The DOB string is parsed as a `Date`; invalid dates
     return a typed error instead of throwing.
   - **Email normalization:** the email is lowercased before any Supabase
     call AND before the profiles INSERT. Cycle 1's `profiles_email_lower_idx`
     functional index is OUT OF SCOPE (a future migration may add it); but
     the lowercased value is what gets stored, so case-insensitive
     uniqueness is application-enforced for cycle 3.
   - **Password policy (NIST 800-63B per ADR-0002):** minimum 12 characters.
     No compositional rules. Empty / `< 12` chars returns a typed error
     `{ field: 'password', message: 'Password must be at least 12
     characters.' }` BEFORE calling Supabase.
   - **Auth user creation:** calls `supabase.auth.signUp({ email, password })`
     using the SERVER client (`lib/supabase/server.ts`'s `createClient()`).
     Supabase Auth is the source of truth for email-uniqueness at the auth
     layer; on duplicate email it returns an error with code
     `user_already_exists` (or the equivalent Supabase identifier — the
     action MUST map this to a user-visible
     `{ field: 'email', message: 'An account with this email already
     exists.' }` rather than leaking the raw error).
   - **Profiles row INSERT via service-role client:** on successful
     `auth.signUp`, the action grabs the new auth user's `id` and uses
     `lib/supabase/admin.ts`'s `createAdminClient()` to INSERT into
     `profiles` with `id = <auth user id>`, `full_name`, `dob`,
     `email = <lowercased>`, `role = 'member'`. Cycle 1's RLS denies regular
     INSERTs into profiles (no insert policy); the service-role client
     bypasses RLS at the Postgres-role level.
   - **Atomicity gap — fail-loudly contract (UPDATED revision 2 per
     critic concern C1):** the auth user is created BEFORE the profiles
     INSERT runs. If the profiles INSERT fails (db down, transient
     network error, validation drift), the auth user orphan exists but
     no profile row does. **Cycle 3 ships fail-loudly:** the action
     returns a typed `FormError` shape
     `{ field: 'form', message: 'Account created, but we hit a snag
     finishing setup. Please contact support.' }`, logs the failure to
     Sentry / structured logs (with the orphan auth.users.id in the log
     body so support can manually clean up if needed), and does NOT
     redirect. **No retry-detect-complete-INSERT recovery is attempted
     in cycle 3.** Sub-case 7 of `signup-action.test.ts` enforces this
     contract: profiles INSERT fails → action returns a generic form
     error, no redirect, no second auth.signUp call, no detection logic.
     **Recovery is OUT OF SCOPE for cycle 3 and bound to cycle 4** (see
     Out of scope §"Auth.users orphan recovery — cycle 4"). Cycle 4
     (ADR-0009 identity / member identity) introduces a reaper /
     orphan-detector that catches these cases and either completes
     the missing profile row OR cleans up the orphan auth.users row.
     Cycle 3's risk: a user whose first signup hits the orphan window
     cannot retry the same email until cycle 4's reaper ships OR
     support manually cleans the orphan; the trade-off is accepted as
     simpler than half-implementing recovery.
   - **`withAudit` is NOT used in the signup path this cycle** — see
     Open Question §1 for rationale and the cycle-4 follow-up commitment.
     The signup action does NOT write an audit row; cycle 4 introduces
     the production transaction adapter for the service-role client and
     wires `withAudit` into signup at that point.
   - **On success:** the action redirects to
     `/confirm-email-pending?email=<lowercased>` (a static page, see AC4)
     with a Next.js `redirect()` (Server Action redirect — throws the
     special Next.js redirect error). Supabase Auth has been configured
     to send a confirmation email automatically (out-of-band; the project
     env enables `Confirm email` under `Auth → Email Auth` settings —
     this is a Supabase Studio config item, not a code change. Document
     this in the spec's Operator Setup section below.).
   - Verified by `pnpm test tests/auth/signup-action.test.ts` (8 sub-cases
     enumerated under AC9).

3. **Login at `app/(auth)/login/page.tsx` + colocated `actions.ts`.**
   - Inputs: `{ email, password, next? }` where `next` defaults to
     `/dashboard`.
   - Calls `supabase.auth.signInWithPassword({ email: lowercased, password })`
     using the server client.
   - On error (bad credentials, unconfirmed email): returns a typed
     `FormError` shape `{ field: 'form', message: <user-safe message> }`.
     Specifically MUST distinguish:
     - "Invalid email or password" — generic; Supabase returns a code
       like `invalid_credentials`. Do NOT leak whether the email exists
       (account-enumeration defense).
     - "Email not yet confirmed — check your inbox." — Supabase returns
       `email_not_confirmed` (or equivalent). Acceptable to disclose this
       because the signup confirmation page already told the user to
       check their email; not a new information-leak surface.
   - On success: server-side validates `next` is a same-origin path
     (starts with `/`, does NOT start with `//` or `/\\`, does NOT
     contain `://`) — open-redirect defense. If `next` is invalid,
     fall back to `/dashboard`. Then redirects.
   - Verified by `pnpm test tests/auth/login-action.test.ts`.

4. **Auth landing pages (server components — RSC-only after C2 resolution).**

   Per the §"Supabase recovery-flow shape — RESOLVED" section above, ALL
   four auth pages this cycle are server components. The `confirm` callback
   is a route handler. NO `'use client'` boundaries ship in the auth surface.

   - `app/(auth)/confirm-email-pending/page.tsx` — receives `?email=` query
     param, displays "We sent a confirmation link to `<email>`. Click it
     to finish signing up." Static / SSR; no client state.
   - `app/(auth)/confirm/route.ts` — **GET route handler** for the Supabase
     confirm-email callback. Reads `?token_hash=` and `?type=` from
     `request.nextUrl.searchParams`, calls
     `supabase.auth.verifyOtp({ token_hash, type })` server-side. On
     success, returns `NextResponse.redirect(new URL('/dashboard',
     request.url))`. On failure, redirects to `/auth/auth-code-error`
     (a tiny static page rendering "We couldn't verify that link.
     [Resend confirmation email]" — link points at
     `/resend-confirmation`, see Open Q §3). Mirrors the canonical
     Supabase Next.js docs pattern verbatim. The dispatch summary
     should note: any drift from the canonical pattern is fidelity
     theater.
   - `app/(auth)/forgot-password/page.tsx` — form taking `{ email }`.
     Server action calls `supabase.auth.resetPasswordForEmail(email, {
     redirectTo: <APP_URL>/reset-password })`. Always returns a generic
     "If that email is on file, we've sent a reset link." (account-
     enumeration defense — do NOT confirm whether the email exists).
   - `app/(auth)/reset-password/page.tsx` — **server component.** Receives
     the page-level `searchParams` prop containing `token_hash` and
     `type=recovery`. Behavior:
     1. On GET, if `searchParams.token_hash` and `searchParams.type ===
        'recovery'` are present, call
        `supabase.auth.verifyOtp({ token_hash, type })` server-side
        (using `lib/supabase/server.ts`'s `createClient()`). This
        establishes the session cookie via `@supabase/ssr`'s cookie
        handlers.
     2. If the verifyOtp call errors, render an error state ("This
        reset link is invalid or expired. [Request a new one]" — link
        points at `/forgot-password`).
     3. If the verifyOtp call succeeds, render a
        `{ password, confirmPassword }` form. The form's server action
        (in colocated `actions.ts`) validates the password (≥12 chars,
        same NIST policy as signup), calls
        `supabase.auth.updateUser({ password })`, and redirects to
        `/dashboard`.
     4. If `searchParams` are missing entirely (someone hit the page
        directly without a recovery link), render a clear "This page
        is for password recovery — request a reset email at
        [forgot-password]" message.
   - `app/(auth)/auth-code-error/page.tsx` — small static "we couldn't
     verify that link" page reached from the confirm route handler on
     failure.
   - All auth pages render the same `<AuthLayout>` shell (see AC8).
   - Verified by structural `pnpm test tests/auth/page-structure.test.ts`.

5. **Logout at `app/(auth)/logout/route.ts`.**
   - POST endpoint (NEXT_PUBLIC_APP_URL/logout). Calls
     `supabase.auth.signOut()` via the server client (which clears the
     session cookies). Returns a `redirect('/')` Response.
   - GET on `/logout` is a 405 — logout MUST be POST (CSRF defense).
     The dashboard's logout link is a `<form method="post"
     action="/logout">` button, not an `<a>`.
   - Verified by `pnpm test tests/auth/logout-route.test.ts`.

6. **`lib/auth/getCurrentProfile.ts` helper (UPDATED revision 2 per
   critic concern C3 — wrapped in `React.cache()` for per-request
   deduping).**
   - Signature: `export const getCurrentProfile: () =>
     Promise<Profile | null>`. The function is wrapped at export time
     in `React.cache()` from React 18+ (`import { cache } from 'react';
     export const getCurrentProfile = cache(async () => { ... });`).
     This is the **explicit, contractual** dedupe mechanism — multiple
     RSCs in the same request that call `getCurrentProfile()` share
     a single Supabase round-trip. (Revision 1 incorrectly claimed
     "Next.js dedupes within a request" — Next.js does NOT auto-dedupe
     arbitrary async functions. `React.cache` is the actual mechanism;
     it caches by argument identity within a single React render.)
   - Internal implementation: reads the session via the server-client's
     `auth.getUser()` (NOT `getSession` — `getUser` re-validates the
     JWT against Supabase; `getSession` only reads the cookie. Per
     Supabase's SSR guidance, server-side code MUST use `getUser` to
     avoid trusting a forged cookie).
   - If no session, returns `null`.
   - If session exists, runs `SELECT * FROM profiles WHERE id =
     <session.user.id>` via the server client (RLS allows the user to
     read their own row per cycle 1's `profiles_select_self_or_staff`).
   - **Race-window contract (load-bearing):** if the session exists but
     no profiles row matches, the function returns `null` (NOT throws).
     This is the documented signup race window — Supabase auth.signUp
     succeeds before the application runs the profiles INSERT; if the
     user's first authenticated request lands during that window
     (extremely narrow but possible), `getCurrentProfile` returns `null`.
     The member layout (AC8) handles `null` by redirecting to `/login`
     with a flash. Cycle 4's "auth user without profile" reaper closes
     the post-INSERT-failure case; cycle 3 just doesn't trip on it.
   - **Type:** the returned `Profile` interface mirrors the
     `profiles` table columns (`id`, `full_name`, `dob`, `phone`,
     `email`, `role`, `created_at`, `updated_at`) per cycle 1's schema.
     Place the type in `lib/auth/types.ts` so cycle 4 can extend with
     `id_verified_at` and friends without breaking import paths.
   - Verified by `pnpm test tests/auth/get-current-profile.test.ts`.

7. **`lib/auth/requireRole.ts` helper + `lib/auth/errors.ts`
   (UPDATED revision 2 per critic concern C4 — typed error class).**

   This cycle pins **option (b)** from the critic's recommendation:
   throw `redirect()` for the unauth case (no session), throw a typed
   `InsufficientRoleError` for the present-but-wrong-role case. The
   caller of `requireRole` (cycle 5's staff layouts) is responsible
   for letting `InsufficientRoleError` propagate to a Next.js
   `error.tsx` boundary OR catching it explicitly and rendering a 403.
   The TEST for `requireRole` asserts the specific error class; no
   "planner picks" ambiguity remains.

   - **`lib/auth/errors.ts` — NEW FILE this cycle.** Exports:
     ```ts
     import 'server-only';

     export class InsufficientRoleError extends Error {
       readonly required: Role;
       readonly actual: Role;
       constructor(required: Role, actual: Role) {
         super(`Insufficient role: required ${required}, got ${actual}`);
         this.name = 'InsufficientRoleError';
         this.required = required;
         this.actual = actual;
       }
     }
     ```
     The class extends the standard JS `Error`. The `name` property is
     set explicitly so `instanceof` checks work across module boundaries
     (and so `error.name === 'InsufficientRoleError'` is also a stable
     fallback in case a future bundler ever breaks `instanceof`).
   - **`lib/auth/requireRole.ts` signature:**
     `export async function requireRole(role: 'cashier' | 'manager'
     | 'owner'): Promise<Profile>`. Calls `getCurrentProfile()`.
     - If `null` (no session OR no profile row): throws Next.js's
       `redirect('/login?next=<currentPath>')`. The current path is
       captured via Next 14's `headers()` — read `x-pathname` (set by
       middleware) OR fall back to `/`. Server actions CAN'T read
       request URL directly; the middleware extension (AC10) sets
       `x-pathname` for this purpose.
     - If profile exists but the profile's role rank is less than the
       required role's rank (computed from `ROLE_RANK` in
       `lib/auth/types.ts`): **throws `new InsufficientRoleError(role,
       profile.role)`.** The caller (cycle 5's staff layout) handles the
       error — typically by letting it bubble to a colocated
       `error.tsx` that renders a 403 page.
   - **Role ladder source of truth:** the helper computes "at least"
     in TypeScript using the same precedence as cycle 1's
     `auth.role_at_least()` SQL function — `member < cashier < manager
     < owner`. Co-locate the rank table in
     `lib/auth/types.ts` so both the SQL function and the TS helper
     reference a single ordering. Keep the names in lockstep — a future
     role insertion into `role_t` requires a migration AND a TS update
     in the same PR.
   - **Cycle-3 callers: NONE.** The member layout (AC8) calls
     `getCurrentProfile()` directly; staff routes (which is what
     `requireRole` is for) don't ship until cycle 5. We ship the helper
     this cycle because (a) the API contract is small and crystallizes
     here, (b) it gives unit tests something to validate, and (c)
     cycle 5's planner has one less thing to design from scratch. The
     function is exported but not yet used in production code; the
     test exercises it directly with mocked sessions.
   - Verified by `pnpm test tests/auth/require-role.test.ts`.

8. **`app/(member)/layout.tsx` + dashboard + profile stubs (UPDATED
   revision 2 per critic concern C3 — `React.cache`-backed dedupe).**
   - `app/(member)/layout.tsx` — server component. Calls
     `getCurrentProfile()`. If `null`, throws `redirect('/login?next=
     <currentPath>')` using the same `x-pathname` middleware
     handshake. Otherwise renders a minimal shell (a `<div>` with
     a header showing email + a logout `<form>` POST button) and
     `{children}`.
   - `app/(member)/dashboard/page.tsx` — minimal stub. **Re-calls
     `getCurrentProfile()` directly.** Per AC6, the helper is wrapped
     in `React.cache()`, so this second call shares the layout's
     Supabase round-trip — one `auth.getUser()` + one `profiles`
     SELECT per request, regardless of how many RSCs in the tree
     read the profile. No context provider, no manual passing
     through props; `React.cache` is the dedupe contract. Renders:
     `Hello {full_name}, you're a {role}. Member number: pending
     verification.` Verification flow (and the actual member_number)
     lands cycle 4. ID-verification CTA placeholder is OUT OF SCOPE
     here.
   - `app/(member)/profile/page.tsx` — minimal stub. Renders email +
     role only, plus a placeholder "Edit profile (coming soon)" note.
     Self-service edit lands cycle 6 (ADR-0023).
   - **`<AuthLayout>` shell (`app/(auth)/layout.tsx`):** the auth
     pages share a layout with the site's brand wordmark + a "Back to
     site" link to `/`. Render is server-side; no client JS required.
   - Verified by `pnpm test tests/auth/page-structure.test.ts`
     (a structural test — reads the source files, asserts the imports
     and the redirect call shape).

9. **Server-action unit tests at `tests/auth/`.** Covers the five action
   surfaces above. Each action is tested via direct invocation (server
   actions are async functions; tests import them and call them with
   crafted FormData). Supabase calls are mocked via `vi.mock(
   '@/lib/supabase/server', ...)` and `vi.mock('@/lib/supabase/admin',
   ...)`. The `'server-only'` package is mocked with
   `vi.mock('server-only', () => ({}))` per `docs/kb/server-only-and-tests.md`.

   **Sub-cases asserted (each must pass):**

   **`tests/auth/signup-action.test.ts` (8 sub-cases):**
   1. **Happy path:** valid `{ email, password (≥12 chars), dob (>21
      years ago), full_name }`. Mocked `auth.signUp` returns a fake user;
      mocked admin client's `from('profiles').insert(...)` resolves
      with the inserted row. Action throws Next.js `redirect`
      (assertion: catch + inspect the thrown error's `digest`
      property starts with the redirect-error sentinel).
   2. **DOB gate:** dob is 20.99 years ago (less than 21 years).
      Action returns `{ field: 'dob', message: '...' }`. `auth.signUp`
      is NOT called.
   3. **DOB invalid:** dob is `'not-a-date'` or `''`. Action returns
      `{ field: 'dob', message: '...' }`. No Supabase call.
   4. **Password too short:** password `'short'` (< 12). Action
      returns `{ field: 'password', message: '...' }`. No Supabase
      call.
   5. **Email normalization:** input email is `'Alice@Example.com'`.
      `auth.signUp` is called with `'alice@example.com'`. Profiles
      INSERT receives `'alice@example.com'`.
   6. **Email already exists:** mocked `auth.signUp` returns an error
      with code `user_already_exists`. Action returns
      `{ field: 'email', message: '...' }`.
   7. **Profiles INSERT fails — fail-loudly contract (UPDATED
      revision 2 per C1):** mocked `auth.signUp` succeeds, mocked
      admin client's INSERT throws. Action returns a generic
      `{ field: 'form', message: 'Account created, but we hit a
      snag finishing setup. Please contact support.' }` form error.
      No redirect. **Asserts that the action does NOT make a second
      `auth.signUp` call** (no retry-detect logic). **Asserts that
      the action does NOT call any auth.users / profiles SELECT
      detection queries** (the recovery path is OUT OF SCOPE for
      cycle 3 — cycle 4's reaper handles this). Asserts the orphan
      auth.users.id is logged (mocked `console.error` or Sentry
      mock).
   8. **Open redirect defense (signup has no `next` — placeholder
      sub-case to keep the count at 8 documenting the contract).**
      Signup ALWAYS redirects to `/confirm-email-pending?email=<email>`;
      `next` is NOT honored at signup. Verifies the action signature
      does not accept a `next` field.

   **`tests/auth/login-action.test.ts` (6 sub-cases):**
   1. **Happy path:** valid creds, `next` undefined. Mocked
      `signInWithPassword` resolves with a session. Action throws
      `redirect('/dashboard')`.
   2. **Bad credentials:** mocked `signInWithPassword` returns
      `invalid_credentials`. Action returns generic
      `{ field: 'form', message: 'Invalid email or password' }`.
   3. **Email not confirmed:** mocked returns `email_not_confirmed`.
      Action returns `{ field: 'form', message: 'Email not yet
      confirmed...' }`.
   4. **`next` honored:** valid creds, `next='/profile'`. Action
      redirects to `/profile`.
   5. **Open redirect defense — protocol-relative:** valid creds,
      `next='//evil.com'`. Action redirects to `/dashboard`
      (rejected).
   6. **Open redirect defense — absolute URL:** valid creds,
      `next='https://evil.com'`. Action redirects to `/dashboard`
      (rejected).

   **`tests/auth/logout-route.test.ts` (3 sub-cases):**
   1. **POST clears session and redirects:** mocked `signOut`
      resolves; route returns 302 to `/`.
   2. **GET returns 405:** GET to `/logout` returns 405 Method Not
      Allowed.
   3. **Sign-out failure is non-fatal:** mocked `signOut` rejects;
      route still returns 302 to `/` (the cookie is cleared client-
      side regardless; we don't surface an error).

   **`tests/auth/get-current-profile.test.ts` (6 sub-cases —
   UPDATED revision 2: added sub-case 6 for `React.cache` dedupe):**
   1. **No session:** mocked `auth.getUser()` returns `{ data: { user:
      null } }`. Returns `null`. No profiles SELECT call.
   2. **Session + profile:** mocked user + mocked profiles SELECT
      returns one row. Returns the profile.
   3. **Session, no profile (race window):** mocked user; mocked
      profiles SELECT returns zero rows. Returns `null`. Does NOT
      throw.
   4. **Session, profiles SELECT errors:** mocked user; mocked
      SELECT throws. Function re-throws (NOT corruption — the SELECT
      should never error if RLS is correct; let the error surface).
   5. **`getUser` (NOT `getSession`):** asserts the helper calls
      `auth.getUser()`, NOT `auth.getSession()`. Prevents a worker
      from "optimizing" to the cookie-only read and breaking the
      Supabase SSR security contract.
   6. **`React.cache` dedupe (NEW revision 2 per C3):** static-source
      assertion via `readFileSync` on `lib/auth/getCurrentProfile.ts`
      that the file imports `cache` from `'react'` and the exported
      `getCurrentProfile` is the result of `cache(...)`. This is the
      structural guarantee — pglite-side runtime dedupe testing is
      hard because `React.cache` is keyed by React render context
      which a unit test doesn't have; the structural test is the
      cycle-3 floor and a future integration test in a real RSC
      render can sharpen it.

   **`tests/auth/require-role.test.ts` (4 sub-cases — UPDATED
   revision 2 per C4: pinned `InsufficientRoleError` assertion):**
   1. **No session:** `getCurrentProfile` returns null. `requireRole`
      throws redirect to `/login?next=<x-pathname>`. Asserts the
      thrown error's `digest` starts with the Next.js redirect
      sentinel (NOT an `InsufficientRoleError`).
   2. **Sufficient role:** profile.role = 'manager', requireRole
      called with `'cashier'`. Returns the profile (member <
      cashier < manager). Does NOT throw.
   3. **Insufficient role — typed error (PINNED revision 2):**
      profile.role = 'member', requireRole called with `'cashier'`.
      The test asserts:
      ```ts
      await expect(requireRole('cashier'))
        .rejects.toBeInstanceOf(InsufficientRoleError);
      ```
      AND asserts the thrown error has `.required === 'cashier'`
      and `.actual === 'member'`. No more "planner picks"; the
      mechanism is the `InsufficientRoleError` class from
      `lib/auth/errors.ts`.
   4. **Exact role match:** profile.role = 'owner', requireRole
      called with `'owner'`. Returns profile. Does NOT throw.

   **`tests/auth/lib-supabase-admin.test.ts` (3 sub-cases):**
   1. **`server-only` import present:** static-source-text assertion
      that `lib/supabase/admin.ts` starts with `import 'server-only';`.
   2. **Missing service-role key throws:** with
      `SUPABASE_SERVICE_ROLE_KEY` unset, `createAdminClient()` throws
      with a recognizable message.
   3. **Persist-session disabled:** the constructed client's
      auth-config is `{ persistSession: false, autoRefreshToken:
      false, detectSessionInUrl: false }` (assert via the call
      arguments to a mocked `createClient` from
      `@supabase/supabase-js`).

   **`tests/auth/page-structure.test.ts` (6 sub-cases — UPDATED
   revision 2: added explicit RSC-only assertion for
   reset-password and confirm route):**
   1. **`app/(member)/layout.tsx` calls `getCurrentProfile`:**
      readFileSync + regex for the import + the call.
   2. **Member layout redirects on null:** regex for `redirect(`
      with `/login` + `next=` substring.
   3. **`<form method="post" action="/logout">` exists in the
      dashboard / member layout:** logout-as-form invariant.
   4. **No client-component boundaries (`'use client'`) in
      `app/(member)/dashboard/page.tsx` or
      `app/(member)/profile/page.tsx` OR
      `app/(auth)/reset-password/page.tsx` OR
      `app/(auth)/confirm/route.ts`:** ALL of the cycle-3 auth +
      member surface is RSC-only after the C2 resolution. A
      future cycle may add client islands; this cycle's pages
      are static / server-rendered. Reads each file with
      `readFileSync` and asserts the absence of `'use client'`
      as the first non-comment line.
   5. **The auth pages exist and import the auth layout:**
      signup, login, forgot-password, reset-password,
      confirm-email-pending, auth-code-error.
   6. **`app/(auth)/confirm/route.ts` exports a GET handler that
      calls `verifyOtp` (NEW revision 2):** structural assertion
      that the route handler reads `token_hash` and `type` from
      `searchParams` and calls `supabase.auth.verifyOtp(...)`.
      Mirrors the canonical Supabase Next.js docs pattern; drift
      is a fidelity flag.

   Verified by `pnpm test tests/auth/`.

10. **Middleware extension at `middleware.ts`.** The matcher already covers
    the entire app surface (its current pattern excludes only static
    assets). The cycle 3 extension:
    - `updateSession` (existing) MUST run first. After it returns, if the
      request's pathname matches one of `/dashboard`, `/profile`,
      `/admin/*`, OR `/cashier/*` (future-proof — the staff routes ship
      cycle 5; gating them here means cycle 5 has one less moving part):
      - Read the session via a fresh server client. If `auth.getUser()`
        returns a user, allow through. Otherwise redirect to
        `/login?next=<request.nextUrl.pathname + search>`.
      - Set an `x-pathname` request header on the forwarded request so
        server components (specifically `lib/auth/requireRole.ts`) can
        read the path via Next 14's `headers()`.
    - The `/admin/*` and `/cashier/*` paths do NOT exist as routes this
      cycle (they 404 normally). Pre-gating them in middleware means
      when cycle 5 ships those routes, the auth gate is already in
      place — no middleware change required for the staff routes
      themselves.
    - Verified by `pnpm test tests/auth/middleware-gate.test.ts` —
      structural assertion via the existing
      `tests/rate-limit/middleware.test.ts` pattern (mocked NextRequest,
      assert the redirect URL shape for unauth requests, assert pass-
      through for auth'd requests, assert `x-pathname` is set).

11. **`pnpm typecheck` passes.** Including new TypeScript code (`lib/
    supabase/admin.ts`, `lib/auth/{getCurrentProfile,requireRole,
    signOut,errors}.ts`, `lib/auth/types.ts`, the seven test files,
    `app/(auth)/**/*.tsx`, `app/(auth)/confirm/route.ts`,
    `app/(member)/**/*.tsx`). `tsc --noEmit` over the repo must be
    green.

12. **`pnpm lint` passes.** The auth + member surface introduces several
    new files; ESLint must be clean. Specifically: no `'use client'`
    directives in stub pages or auth pages (AC9 sub-case 4), no `any`
    casts in the server actions, no `process.env.SUPABASE_SERVICE_ROLE_KEY`
    references outside `lib/supabase/admin.ts`.

13. **Cycle-1 + Cycle-2 regression — zero edits, zero failures:**
    `pnpm test tests/db/rls-profiles.test.ts`,
    `pnpm test tests/db/audit-log.test.ts`, and
    `pnpm test tests/audit/with-audit.test.ts` MUST continue to pass
    without modification. Cycle 3 ships ZERO migrations and ZERO
    changes to `lib/audit/withAudit.ts` — the prior cycles' contracts
    are stable. Any cycle-1/cycle-2 test that needs editing to
    accommodate cycle 3 is a fidelity fail; flag it and re-scope
    before shipping.

14. **`pnpm test scripts/conductor/` continues to pass — no conductor
    regression.** Standard cross-cycle floor.

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Tests-first preferred —
the auth helper unit tests can be authored before the implementation
lands and used to drive it.

- **t0 — Operator setup probe (planner / orchestrator notes; not worker
  scope).** Cycle 3 assumes a real Supabase project's URL + anon key +
  service-role key are available in `.env.local`. Cycle 1 + 2 ran
  entirely on pglite; cycle 3's typecheck passes without them, but the
  signup / login flows can't actually be run end-to-end without a real
  project. Ship the code; the orchestrator's bootstrap phase verifies
  whether real env vars are present and gates the integration-test
  command list accordingly. Document this in the dispatch summary.

- **t1 — `lib/auth/types.ts` + `lib/auth/errors.ts` + role-rank table.**
  Single source of truth for the role ladder + the `InsufficientRoleError`
  class. Exports `type Role = 'member' | 'cashier' | 'manager' |
  'owner';`, `const ROLE_RANK: Record<Role, number>`, the `Profile`
  interface mirroring cycle 1's `profiles` columns, and (in the
  separate `errors.ts` file with `'server-only'` first line) the
  `InsufficientRoleError` class. Validate with `pnpm typecheck`.

- **t2 — `lib/supabase/admin.ts`.** Per AC1. `import 'server-only';`
  first line; `createAdminClient()` only-export; env-var guard per
  the existing `lib/supabase/server.ts` pattern; persist-session
  disabled. Validate with `pnpm typecheck` and
  `pnpm test tests/auth/lib-supabase-admin.test.ts`.

- **t3 — `lib/auth/{getCurrentProfile,requireRole,signOut}.ts`.** Per
  AC6 + AC7. Use the `server-only` discipline: each file's first line
  is `import 'server-only';`. **`getCurrentProfile` is wrapped in
  `React.cache()` from `'react'`** — the export is
  `export const getCurrentProfile = cache(async () => { ... });`.
  `signOut` is a thin wrapper —
  `await createClient().auth.signOut()`. `requireRole` calls
  `getCurrentProfile` then asserts the rank; throws `redirect(...)`
  for the no-session case and `new InsufficientRoleError(required,
  actual)` for the present-but-wrong-role case. Validate with
  `pnpm test tests/auth/get-current-profile.test.ts +
  require-role.test.ts`.

- **t4 — Server actions (signup, login, forgot-password,
  reset-password).** Per AC2 + AC3 + AC4. Co-locate `actions.ts`
  next to each `page.tsx` per Next 14 convention. Use the typed
  `FormError` shape consistently (`tsconfig`'s `strict` will reject
  `any`). Email normalization happens once at the top of each action.
  Open-redirect validation is a shared helper at `lib/auth/safeNext.ts`
  (worth lifting to its own file — login isn't the only future
  caller). **Signup's profiles-INSERT-fails branch returns a
  generic form error, logs the orphan auth.users.id, and does NOT
  attempt retry-detect recovery** (per AC2 fail-loudly contract).
  Validate with `pnpm test tests/auth/signup-action.test.ts +
  login-action.test.ts`.

- **t5 — Auth pages (signup, login, forgot-password, reset-password,
  confirm-email-pending, auth-code-error) + `<AuthLayout>` shell +
  `app/(auth)/confirm/route.ts` (route handler, NOT a page).** Per
  AC4 + AC8. **All server components / server route handlers — no
  `'use client'` boundaries this cycle.** Forms use server-action
  `action={signupAction}` / `action={loginAction}` — Next 14 native.
  Validation errors rendered inline below each field; on field-level
  error the action re-renders the page with the error map (Next
  14's progressive-enhancement pattern via `useActionState` is
  available but is a client hook; cycle 3 uses pure server-side
  re-render with a `cookies()`-flash carrying the error map across
  the redirect for now — if a worker hits limits, escalate before
  introducing `'use client'` to the auth surface).

- **t6 — Logout route.** Per AC5. POST `/logout` route handler at
  `app/(auth)/logout/route.ts`. GET returns 405. Validate with
  `pnpm test tests/auth/logout-route.test.ts`.

- **t7 — Member layout + dashboard + profile stubs.** Per AC8.
  Server-component-only (no `'use client'`); minimal shell. The
  dashboard's logout button is a `<form method="post" action="/logout">`.
  The dashboard re-calls `getCurrentProfile()` — `React.cache`
  dedupes with the layout's call. Validate with
  `pnpm test tests/auth/page-structure.test.ts`.

- **t8 — Middleware extension.** Per AC10. Modify the existing
  `middleware.ts` to (a) run `updateSession` first (already), (b) check
  the gated path list and read user via a server-client `auth.getUser()`,
  (c) redirect to `/login?next=...` for unauth on a gated path,
  (d) set `x-pathname` request header. Keep the existing rate-limit
  middleware path untouched (rate limit is a separate concern; cycle
  3 doesn't reorder it). Validate with
  `pnpm test tests/auth/middleware-gate.test.ts`.

- **t9 — Test fixtures + `vi.mock` boilerplate.** A small shared
  `tests/auth/_fixtures/supabase-mock.ts` module exports
  `mockServerClient(overrides)` and `mockAdminClient(overrides)`
  factories so every server-action test has the same baseline mock
  surface. The `vi.mock('server-only', () => ({}))` line goes at
  the TOP of every test file in `tests/auth/` per the cycle-2 KB
  lesson.

- **t10 — Final gauntlet pass.** Run all 6 acceptance commands in
  order. Confirm cycle-1 + cycle-2 regression is clean (AC13). Capture
  any fidelity findings (e.g. Supabase JS error-code drift from what
  the spec assumes, or Supabase recovery-flow drift away from the
  PKCE / query-param shape pinned in this spec) and surface them in
  the dispatch summary so the curator can update the auth KB topic.

## Touched-files inventory

Best estimate; workers may exceed if needed.

- **Create:** `lib/supabase/admin.ts`
- **Create:** `lib/auth/types.ts`
- **Create:** `lib/auth/errors.ts` (NEW revision 2 — `InsufficientRoleError`)
- **Create:** `lib/auth/getCurrentProfile.ts`
- **Create:** `lib/auth/requireRole.ts`
- **Create:** `lib/auth/signOut.ts`
- **Create:** `lib/auth/safeNext.ts` (open-redirect validator;
  small enough to stay separate from getCurrentProfile)
- **Create:** `app/(auth)/layout.tsx`
- **Create:** `app/(auth)/signup/page.tsx`
- **Create:** `app/(auth)/signup/actions.ts`
- **Create:** `app/(auth)/login/page.tsx`
- **Create:** `app/(auth)/login/actions.ts`
- **Create:** `app/(auth)/forgot-password/page.tsx`
- **Create:** `app/(auth)/forgot-password/actions.ts`
- **Create:** `app/(auth)/reset-password/page.tsx` (server component;
  no `'use client'` per resolved §"Supabase recovery-flow shape")
- **Create:** `app/(auth)/reset-password/actions.ts` (server action
  for the form's password update — `updateUser` + redirect)
- **Create:** `app/(auth)/confirm/route.ts` (route handler — NOT a
  page; mirrors the canonical Supabase Next.js docs verifyOtp pattern)
- **Create:** `app/(auth)/confirm-email-pending/page.tsx`
- **Create:** `app/(auth)/auth-code-error/page.tsx` (small static
  error page for the confirm-route failure path)
- **Create:** `app/(auth)/logout/route.ts`
- **Create:** `app/(member)/layout.tsx`
- **Create:** `app/(member)/dashboard/page.tsx`
- **Create:** `app/(member)/profile/page.tsx`
- **Create:** `tests/auth/_fixtures/supabase-mock.ts`
- **Create:** `tests/auth/lib-supabase-admin.test.ts`
- **Create:** `tests/auth/get-current-profile.test.ts`
- **Create:** `tests/auth/require-role.test.ts`
- **Create:** `tests/auth/signup-action.test.ts`
- **Create:** `tests/auth/login-action.test.ts`
- **Create:** `tests/auth/logout-route.test.ts`
- **Create:** `tests/auth/page-structure.test.ts`
- **Create:** `tests/auth/middleware-gate.test.ts`
- **Modify:** `middleware.ts` (add gated-path check + `x-pathname`
  header; keep `updateSession` and the existing matcher).
- **Modify:** `docs/kb/auth.md` (curator-owned post-cycle; not in
  worker scope unless lessons surface during t1–t10). If the file
  doesn't exist, the curator creates it.
- **Modify:** none for `package.json` — every dependency this cycle
  needs (`@supabase/ssr`, `@supabase/supabase-js`, `date-fns`, `zod`)
  is already installed. If the planner finds a gap, add it.
- **Modify:** none for `supabase/migrations/*` — cycle 3 ships ZERO
  migrations.

If the planner lands a small flash-cookie helper (server-side, used
to surface "we sent a reset link" on forgot-password without revealing
account existence via a query-param), that's in scope at
`lib/auth/flash.ts`.

If Open Q §3 resolves to "ship `/resend-confirmation`," add:
`app/(auth)/resend-confirmation/route.ts` (POST handler that takes
`{ email }` and calls `supabase.auth.resend({ type: 'signup', email
})`) plus its test.

## Risk flags

This is the project's high-risk auto-flag list per the spec-writer template
(linked ADRs in {0003, 0004, 0005, 0006, 0009, 0023}). Cycle 3 explicitly
crosses 0003 (RLS dependency) and 0006 (`withAudit` decision) — premortem
mandatory.

- **0002 (this ADR — auth and sessions):** sessions are the gateway to
  every authenticated surface. A bug class to actively defend against:
  account enumeration via login response timing or message text (login
  AC3 sub-cases 2 + 3); open-redirect via `next` (login AC3 sub-cases 5
  + 6); CSRF on logout (logout-as-POST AC5); and the signup atomicity
  gap (auth-user-without-profile, AC2 fail-loudly contract). The
  acceptance criteria deliberately include the negative-direction
  sub-cases. The spec does NOT defend against credential-stuffing this
  cycle — ADR-0016 rate limiting is already shipped at the edge; the
  login endpoint inherits its bucket. Premortem MUST cover: account
  enumeration, open redirect, signup orphan-permanent (no recovery
  this cycle), profile-INSERT failure, service-role-key leak via test
  mocks, MFA-not-enforced (cycle 5 follow-up).
- **0003 (RLS — coupling):** signup INSERT into profiles relies on
  cycle 1's "no insert policy → service-role bypass" contract. If a
  worker "fixes" this perceived gap by adding a permissive insert
  policy, signup works without service-role and the cycle-1 anti-
  forgery posture breaks. AC1 enumerates this explicitly; the
  service-role admin client is the documented entry point. Cycle-1
  regression (AC13) re-asserts no INSERT policy was added.
- **0006 (`withAudit` deferred for signup — Open Q §1):** the spec
  ships signup WITHOUT `withAudit`. This is a deliberate deferral —
  cycle 4 (ADR-0009 identity) introduces the production transaction
  adapter for the service-role client at the same time it adds
  identity-verification audit events, and signup gets folded into
  the `withAudit` pattern at that point. The risk: the cycle-3
  signup path lands an unaudited state mutation; if cycle 4 slips,
  the audit gap persists. Mitigation: cycle 3's worker MUST leave a
  `// TODO(cycle-4): wrap in withAudit per ADR-0006 + ADR-0009`
  comment at the profiles-INSERT call site so the cycle-4 worker
  finds it on grep. Cycle 4's spec MUST list "wire signup into
  withAudit" as an acceptance criterion. Premortem MUST cover the
  "cycle 4 slips, audit gap persists for >1 cycle" scenario.
- **0007 (secrets) — `lib/supabase/admin.ts` + service-role key
  exposure:** the service-role key is the highest-impact secret in
  the project — it bypasses ALL of Supabase's RLS enforcement. AC1's
  anti-leak invariant (no raw-key export, `'server-only'` first
  line, persist-session disabled) is the structural defense. Risk:
  a worker imports `createAdminClient()` into a `'use client'`
  component, the build catches it via the `server-only` runtime
  guard, but if `'use client'` is missing OR the file is wrapped in
  a non-component utility imported by a client file, the guard might
  be bypassed. ADR-0007's CI grep (`process.env.SUPABASE_SERVICE_ROLE_KEY`
  outside allowed paths) is a Slice-4 hardening item; cycle 3 does
  NOT ship the grep. Mitigation in cycle 3: the test asserts the
  `server-only` import is present (AC9 sub-case 1); code review on
  cycle 3's PR explicitly checks every importer of `lib/supabase/
  admin.ts` is server-side. Premortem MUST cover service-role-key
  leak via a client-bundled module.
- **0009 (identity verification — cycle 4 follow-up):** cycle 3's
  dashboard stub says `Member number: pending verification.` Cycle 4
  ships the actual verification flow + the `id_verified_at` and
  `member_number` columns AND the auth.users orphan reaper (closes
  the cycle-3 fail-loudly contract from AC2). Cycle 3 MUST NOT
  pre-add those columns to the `Profile` type — the type ships
  with the cycle-1 schema exactly; cycle 4's planner extends. A
  worker who adds the columns "for forward compatibility" creates
  a typecheck mismatch with the actual SELECT *.
- **0023 (privacy / GDPR — soft delete):** the `profiles_select_self_
  or_staff` policy gates on `id = auth.uid()` — a member who has
  been soft-deleted (cycle 6) but whose auth.users row still exists
  could still read their own profile. Cycle 6 owns the soft-delete
  semantics; cycle 3 just doesn't trip on them. Risk: cycle 6's
  policy change (e.g. adding `AND deleted_at IS NULL`) could break
  cycle 3's `getCurrentProfile` for a soft-deleted user — the
  function returns null and the layout redirects to /login, which
  is probably correct, but the contract isn't pinned. Open Question
  §4 captures this for cycle 6's planner.
- **`auth.getUser` vs `auth.getSession` — security contract:**
  Supabase's SSR guidance is unambiguous —
  `auth.getUser()` re-validates the JWT, `auth.getSession()` only
  reads the cookie (which a malicious user could forge if they ever
  controlled the cookie's domain). AC6 sub-case 5 asserts
  `getCurrentProfile` calls `getUser`; a worker who "optimizes" to
  `getSession` for performance breaks the security contract.
  Premortem MUST cover this drift.
- **`React.cache` is render-context-scoped (NEW revision 2 — C3
  follow-up):** `React.cache(fn)` deduplicates only within a single
  React render. If `getCurrentProfile` is called from a non-RSC
  context (a route handler, a server action, a middleware path),
  the cache key is fresh per call and dedupe is a no-op — which is
  correct, because each of those is a separate request boundary.
  The risk is a worker who assumes "React.cache always dedupes" and
  refactors `getCurrentProfile` into a non-RSC helper that fans out
  N times to Supabase per request. Mitigation: the helper is
  documented as RSC-first in `lib/auth/getCurrentProfile.ts`'s
  doc-comment; the structural test (AC9 sub-case 6) asserts the
  `cache(...)` wrap; route-handler / server-action callers should
  use a manual dedupe pattern (e.g. capturing the result in a
  local variable) if they need it, OR call once per request entry
  point.
- **Email confirmation requirement — Supabase Studio config dependency:**
  ADR-0002 says "Email verification required before a member can
  complete signup or pay." The actual gate ("can pay") is enforced
  by ADR-0010 (membership / Stripe — future cycle). Cycle 3 MUST
  enable Supabase's `Confirm email` setting in the project (Studio
  config — NOT code). Without this, `auth.signUp` returns a session
  immediately and the user lands on `/dashboard` without email
  confirmation, breaking the flow. The spec's Operator Setup section
  documents this as an environment-config item; the planner gates
  the integration-test pass on the Studio config being set OR on
  the unit-test mocks accurately reflecting "session is null until
  confirmed".
- **Open-redirect via `next`:** standard auth-flow vuln. AC3 sub-cases
  4-6 + the `lib/auth/safeNext.ts` validator are the structural
  defense. Premortem MUST cover whether the validator is robust
  against URL-encoded paths, mixed-case `HTTPS://`, and embedded
  newlines (HTTP response splitting — Next.js's redirect is supposed
  to encode but verify).
- **Signup race window — `getCurrentProfile` returning null for an
  auth-OK user:** the documented contract (AC6) is "return null,
  layout redirects to /login." This is *correct* if the race only
  happens for a few hundred ms post-signup, but it would loop
  infinitely for a user whose profile INSERT permanently failed
  (auth user orphan, no profile row). Cycle 3's fail-loudly contract
  (AC2 — "contact support" message + Sentry log + no auto-recovery)
  is the cycle-3-bounded mitigation; cycle 4's reaper is the
  load-bearing fix. Premortem MUST cover the orphan-permanent case
  AND the "support inbox burden between cycle 3 ship and cycle 4
  ship" scenario.
- **MFA NOT enforced for staff this cycle:** ADR-0002 specifies MFA
  TOTP for cashier+ roles. Cycle 5 ships the MFA enrollment + AAL2
  enforcement middleware. Cycle 3 ships `requireRole` but does NOT
  add an AAL2 check. A staff member created via direct DB insertion
  (cycle 5's admin role-assignment UI) before cycle 5 ships could
  technically log in with email + password and access `requireRole`-
  gated routes (which don't exist this cycle but the helper compiles).
  Mitigation: AC8's stub routes are member-only; staff routes don't
  ship until cycle 5; the AAL2 gate is added there.
- **Supabase recovery-flow drift (NEW revision 2 — pinned via C2):**
  the spec pins the PKCE / query-param shape per Supabase docs as of
  2026-05-09. If Supabase migrates the recovery flow to URL fragments
  in a future release, the cycle-3 reset-password page breaks
  (the searchParams will be empty; the verifyOtp call will fail).
  Mitigation: the page's "missing searchParams" branch renders a
  clear error message (AC4 step 4), and the orchestrator's bootstrap
  phase verifies a sample recovery email's URL shape against the
  pinned spec contract during operator setup. If drift is detected,
  the conductor queues a follow-up cycle to migrate the page to
  client-side fragment-handling.
- **pglite vs production-Supabase fidelity gap (continued from cycle
  1 + 2):** cycle 3 doesn't ship migrations or RLS changes, so the
  pglite test substrate is unchanged. The cycle-3-specific gap is
  Supabase Auth's runtime behavior — unit tests mock the JS client,
  so we never exercise real auth.signUp / auth.signInWithPassword
  calls. The "real-Supabase test environment" cycle (deferred) is
  the closing of this gap.

## Out of scope

What this cycle deliberately does **not** do. Each item is bound to a
future ADR cycle.

- **Auth.users orphan recovery — cycle 4 (NEW revision 2 per critic
  concern C1).** When the profiles INSERT fails after `auth.signUp`
  succeeds, cycle 3 ships fail-loudly: a generic "contact support"
  form error + a Sentry log + no auto-recovery. A user whose first
  signup hits this window CANNOT retry the same email until cycle 4
  ships. Cycle 4 (ADR-0009 — identity / member identity) introduces:
  (a) an idempotent reaper that detects "auth.users row without a
  matching profiles row" and either completes the missing INSERT OR
  cleans up the orphan auth.users row, (b) an updated signup action
  that, on retry, detects the orphan and completes the INSERT
  (reusing the cycle-4 reaper logic). The trade-off accepted in
  cycle 3: support takes the burden of orphan cleanup for the
  duration of one cycle in exchange for not half-implementing
  recovery here. Cycle 4's spec MUST list "auth.users orphan reaper"
  as a load-bearing AC.
- **Magic-link login.** ADR-0002 lists it as "backup" identity provider.
  Cycle 3 ships email + password ONLY. The magic-link flow uses a
  different Supabase API (`signInWithOtp`); deferred to a future
  cycle (likely Slice 4 ops-hardening or as part of a "convenience
  features" sprint).
- **Google OAuth.** ADR-0002 lists it as "convenience" provider. Same
  deferral as magic-link. The OAuth callback route at
  `/auth/callback` (per route-map.md) is NOT shipped this cycle —
  cycle 3 has no `/auth/callback` page.
- **MFA TOTP enrollment / enforcement.** ADR-0002 specifies MFA for
  cashier+ roles. Cycle 5 (admin dashboard) ships the enrollment UI
  + the AAL2 middleware enforcement at `app/(staff)/layout.tsx`.
  Cycle 3 ships `requireRole` (a TS helper) but NOT the AAL2 check.
  Members can opt-in to MFA — that flow ships cycle 6 (account
  self-service, ADR-0023).
- **Session lifetime tuning (7 days members, 12 hours staff).**
  Supabase project-level setting. Configured in Studio post-cycle-5
  when staff sessions become a concern. Cycle 3 uses the Supabase
  defaults.
- **Password change for an authenticated user.** Forgot-password +
  reset-password flow ships this cycle. Authenticated change-password
  (member is logged in, wants to update their password) is a separate
  surface — ships cycle 6 (account self-service).
- **Profile self-service edit (`app/(member)/profile/page.tsx`
  edit form).** Stub-only this cycle. Edit lands cycle 6 (ADR-0023).
- **ID verification flow + the dashboard's "Verify your ID" CTA.**
  Cycle 4 (ADR-0009) ships ID upload, OCR / manual review, and the
  `id_verified_at` column. The cycle-3 dashboard says "Member
  number: pending verification" as a static stub; cycle 4 makes it
  dynamic.
- **Member number generation.** Cycle 4 (ADR-0009).
- **Stripe checkout / membership signup → Stripe → "active member"
  transition.** ADR-0010 / cycle TBD. The cycle-3 dashboard does
  NOT distinguish "trialing" from "active" — every authenticated
  user with a profile row sees the same dashboard.
- **`withAudit` integration in the signup path.** Open Question §1;
  default deferred to cycle 4 when the production transaction
  adapter for the admin (service-role) client lands. Cycle 3's
  signup is the ONLY new state-changing path the cycle ships, and
  it lands UN-audited as a pragmatic trade-off documented under
  Risk flags.
- **Playwright E2E for the auth flow at `tests/e2e/auth.spec.ts`.**
  DEFERRED. The host has neither Docker nor a real Supabase project
  available for cycle 3's gauntlet; running Playwright against a
  mocked Supabase is fidelity theater. Cycle 3 ships unit tests +
  pglite-where-applicable for the cycle-1/2 regression. The
  Playwright suite lands in a future "real-Supabase test
  environment" cycle (post-Slice-4 ops hardening); it is NOT a
  blocker for cycle 3 ratification or for shipping the auth flow
  to a preview environment with the real Supabase project keys.
- **Real Supabase integration tests.** Same posture as cycles 1 + 2:
  pglite for unit + integration where pglite suffices, real
  Supabase for the smoke test of the deployed flow (manual /
  human-driven for cycle 3; CI-driven post-deferred-cycle).
- **Account-enumeration timing defense beyond message-text
  uniformity.** Constant-time response on login is a deeper defense
  than message-text uniformity (AC3 sub-cases 2 + 3). Supabase's
  Auth API does NOT expose timing-side-channel hardening at the
  wrapper level; cycle 3 trusts Supabase's implementation. If a
  future cycle finds Supabase has a measurable timing leak,
  ADR-0016 rate limiting on the login endpoint absorbs the bulk
  of the attack surface.
- **The signup multi-step flow per `_design/screens-auth.jsx`.**
  The design doc shows a 5-step wizard (email → DOB → phone → ID
  upload → e-sign agreement → Stripe checkout). Cycle 3 ships ONLY
  steps 1-2 (email + DOB combined into a single page). Phone +
  ID + e-sign + Stripe are each owned by a separate ADR / cycle
  (0009 / 0010 / 0011 / 0023). The cycle-3 dashboard's "pending
  verification" copy hints to the user that more steps are
  coming.
- **A11y review beyond default ARIA.** The forms ship with semantic
  HTML (`<label>`, `<input type="email" required>`, etc.) and
  basic ARIA where the form-error association needs it
  (`aria-invalid`, `aria-describedby`). A full WCAG 2.1 AA audit
  is ADR-0026's deliverable in Slice 4. Cycle 3 does not ship the
  audit, but does NOT ship anti-patterns (e.g. div-as-button or
  unlabeled inputs).
- **A `/auth/callback` OAuth callback route.** No OAuth provider
  this cycle (see above); no callback route ships.
- **URL-fragment recovery flow handling (NEW revision 2 per C2
  resolution).** Per the §"Supabase recovery-flow shape — RESOLVED"
  section, the cycle-3 reset-password page is RSC-only because
  Supabase's PKCE flow uses query parameters. If Supabase migrates
  the recovery flow to URL fragments in a future release, that
  migration is OUT OF SCOPE for cycle 3 — a follow-up cycle
  introduces the `'use client'` boundary + the `idle → exchanging
  → ready` state machine at that point.

## Open questions

Surfaced for resolution during planning. **Defaults are the spec
author's recommendation; the planner confirms before t-zero.**

Note: revision 2 RESOLVED what was previously Open Q §2 (Supabase
recovery-flow shape) — see the dedicated §"Supabase recovery-flow
shape — RESOLVED" section above. The remaining open questions are
renumbered to skip §2 to preserve the original numbering for traceability.

1. **`withAudit` in signup — defer to cycle 4? (DEFAULT: YES, defer.)**
   Cycle 2's `withAudit` is designed around the caller-owns-tx
   contract: caller passes a `TransactionClient` whose `query(sql,
   params)` shape pglite + `pg` already match. Cycle 3 introduces
   `lib/supabase/admin.ts` (the service-role client built on
   `@supabase/supabase-js`); supabase-js does NOT expose a
   `tx.query()` shape natively (txns happen via RPC or direct
   `.from().insert()` chains). Wiring `withAudit` into signup
   requires a thin adapter that gives the supabase-js admin client
   a `query`-compatible facade.
   - **Defer (default):** cycle 3 ships signup WITHOUT withAudit.
     The profiles INSERT runs as a single supabase-js call. Cycle
     4 (ADR-0009 identity, which adds many state-changing paths)
     introduces the production transaction adapter and refactors
     signup to use it at that point. Cost: cycle 3's signup path
     lands UN-audited (a profile.created event is missed). Mitigation:
     a `TODO(cycle-4)` comment at the INSERT site; cycle 4 spec
     MUST list "wire signup into withAudit" as an AC.
   - **Ship now:** cycle 3 also ships the production tx adapter at
     `lib/supabase/transactional.ts` (or similar). The adapter
     wraps a supabase-js client to expose `query(sql, params)`.
     Cost: more design surface in cycle 3; the adapter has to
     handle supabase-js's lack of native txns somehow (RPC to a
     plpgsql function? Two separate calls with manual rollback?).
     This is the trickiest design question of cycle 3 — the spec
     author recommends DEFERRING the adapter to cycle 4 where the
     volume of audited paths justifies the design effort.
   The spec author's recommendation: **DEFER.** A single un-audited
   profile.created event for the duration of one cycle is an
   acceptable trade-off vs. pre-committing to an adapter shape that
   may be wrong for cycle 4's needs. The planner confirms before
   t-zero.

2. **(RESOLVED in revision 2 — see §"Supabase recovery-flow shape —
   RESOLVED" above. Numbering preserved.)**

3. **`/forgot-password` doubles as OTP-resend?** The
   confirm-email-pending page shows "didn't get the email? Click
   here to resend." That click could (a) hit a separate
   `/resend-confirmation` action that calls
   `supabase.auth.resend({ type: 'signup', email })`, or (b) re-
   route the user to `/forgot-password` whose action is overloaded
   to handle both reset-password and resend-signup-confirmation.
   - **DEFAULT:** ship a tiny `/resend-confirmation` route handler
     (POST) that takes `{ email }` and calls `auth.resend`. Keeps
     forgot-password focused on its primary flow. Mocked + tested
     under `tests/auth/`. Adds one route, one action, ~30 lines.
     The planner overrides if the additional surface area isn't
     worth the conceptual clarity.

4. **Cycle-6 soft-delete contract for `getCurrentProfile`.** Cycle
   3's `getCurrentProfile` does `SELECT * FROM profiles WHERE id =
   <user.id>`. Cycle 6 (ADR-0023) introduces `profiles.deleted_at`.
   Question: should cycle 6 ALTER `profiles_select_self_or_staff` to
   include `AND deleted_at IS NULL`, OR should the application-side
   `getCurrentProfile` filter? The choice affects whether soft-
   deleted users can still SELECT their own row at the SQL layer.
   Cycle 3 makes NO assumption either way; the spec just flags this
   for cycle 6's planner to pin. Default: cycle 6 decides. (Why this
   matters here: if cycle 6 ALTERs the policy, cycle 3's
   `getCurrentProfile` returns null for a soft-deleted user and the
   member layout redirects to /login — probably correct. If cycle 6
   does it application-side, cycle 3's helper needs an update at
   that point. Pinning the decision in cycle 6 is sufficient — no
   action required in cycle 3.)

## Operator setup notes

These are environment / Studio configuration items that do NOT live in
code but ARE prerequisites for the cycle-3 flow to work end-to-end
against a real Supabase project. The orchestrator surfaces these to the
operator (Travis) during the bootstrap phase if real env vars are
present.

- **Supabase Studio: enable `Confirm email`.** Project Settings → Auth →
  Email Auth. Without this, `auth.signUp` returns a session immediately
  and the email-confirmation flow is bypassed.
- **Supabase Studio: configure Email Templates (load-bearing for the
  C2-resolved query-param flow).** Project Settings → Auth →
  Email Templates → Confirm signup. The "Confirm your signup" link
  template MUST point to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
  (the canonical Supabase Next.js docs URL shape — produces the
  query-param verification flow this spec pins). The reset-password
  template's link MUST point to
  `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`.
  Default Supabase templates point to Supabase-hosted URLs that may
  use the older URL-fragment shape; we override to use query
  parameters and our own routes. Failure to override this Studio
  config would surface as "the reset-password page reads empty
  searchParams and renders the missing-token branch" — which AC4
  step 4 already handles gracefully but defeats the flow.
- **Vercel / `.env.local`: set `NEXT_PUBLIC_APP_URL`.** Used as the
  `redirectTo` for `auth.resetPasswordForEmail`. The
  `.env.local.example` file already has it.
- **Supabase Studio: SMTP / Resend integration for email delivery.**
  Default Supabase SMTP has very low rate limits (a few emails per
  hour); for any real testing, point Supabase at the project's
  Resend account. ADR-0025 (email/SMS) owns the long-term email
  setup; cycle 3 relies on whatever Supabase's project-level email
  config is.

## Iteration history

- **Revision 1 (2026-05-09):** initial spec authored. No prior critic
  concerns. Inputs: ADR-0002 (Accepted), cycle 1 + cycle 2 outputs
  (migrations 0002 + 0003, withAudit helper, RLS fixtures, KB lessons
  in pglite.md / rls.md / audit-log.md / server-only-and-tests.md),
  cross-refs to ADR-0003 / 0006 / 0007 / 0009 / 0016 / 0024,
  `docs/spec.md` Slice 2 acceptance, `docs/route-map.md` auth + member
  routes. 14 acceptance criteria. 11 task cuts. 4 open questions
  (one — withAudit-in-signup — flagged as the trickiest cycle-3
  design question; default deferred to cycle 4). Documents the
  Playwright E2E deferral explicitly under Out of scope as forced by
  the host's lack of Docker / real Supabase. Ships the service-role
  admin client (`lib/supabase/admin.ts`) as the cycle's load-bearing
  new infrastructure.

- **Revision 2 (2026-05-09):** addresses 5 critic concerns from
  `.conductor/0002/dispatches/0002-critic-spec.md`.
  - **C1 — AC2 atomicity-recovery:** dropped the retry-detect-complete-
    INSERT recovery prose. Pinned the **fail-loudly** default: profiles
    INSERT failure returns a generic "contact support" form error,
    logs the orphan auth.users.id to Sentry, no redirect, no retry
    detection. Sub-case 7 of `signup-action.test.ts` updated to assert
    this contract (no second auth.signUp, no detection queries).
    Recovery is bound to **cycle 4 (ADR-0009)** as an explicit
    Out-of-scope item: "Auth.users orphan recovery — cycle 4."
  - **C2 — Supabase recovery-flow shape RESOLVED:** queried Supabase's
    official docs via `mcp__plugin_context7_context7__query-docs` (lib
    `/supabase/supabase`) and `WebFetch` against
    <https://supabase.com/docs/guides/auth/passwords>. **Verdict:
    PKCE flow with `@supabase/ssr` uses query parameters
    (`?token_hash=...&type=recovery`), NOT URL fragments.** Verification
    happens server-side via `supabase.auth.verifyOtp({ token_hash,
    type })`. Promoted from Open Q §2 to a dedicated resolved-section
    in the spec body with citation. Updated AC4 to specify
    `app/(auth)/confirm/route.ts` (route handler, NOT a page) and
    `app/(auth)/reset-password/page.tsx` (server component, NO
    `'use client'`). Updated touched-files inventory.
  - **C3 — `Next.js dedupes within a request`:** REPLACED the
    incorrect claim with the actual mechanism: `getCurrentProfile`
    is wrapped in `React.cache()` from `'react'` at export time.
    Added to AC6 contract. Added test sub-case 6 (structural source
    assertion that the file imports `cache` and wraps the export).
    Added a Risk-flags entry on the render-context-scoping caveat.
  - **C4 — `requireRole` 403 mechanism PINNED:** chose option (b)
    from the critic's recommendation. New file `lib/auth/errors.ts`
    exports `class InsufficientRoleError extends Error` with
    `required` and `actual` fields. `requireRole` throws
    `redirect()` for the no-session case and
    `new InsufficientRoleError(...)` for the present-but-wrong-role
    case. AC7 sub-case 3 updated to assert
    `await expect(...).rejects.toBeInstanceOf(InsufficientRoleError)`
    AND that `.required === 'cashier'` and `.actual === 'member'`.
    Added `lib/auth/errors.ts` to the touched-files inventory and
    `t1` task hint.
  - **C5 — AC4 reset-password state machine:** DISSOLVED by C2
    resolution. Under the query-param flow, the page is RSC-only
    and `verifyOtp` runs server-side before the form renders; no
    client-side state machine needed. AC4 step-by-step behavior
    updated to reflect the RSC pattern. Page-structure test
    sub-case 4 updated to assert no `'use client'` boundary in
    `app/(auth)/reset-password/page.tsx` or
    `app/(auth)/confirm/route.ts`.

  Iter 1 → 2; max 3 iterations before escalation. All 5 critic
  concerns addressed; no critic-accepted decisions changed.
  Frontmatter `risk: high` and `acceptance_commands` array
  unchanged per revision-2 constraints.
