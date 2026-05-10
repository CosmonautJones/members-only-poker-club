---
date: 2026-05-10
adrs: [0002]
slice: 2
type: implementation
status: complete
---

# Conductor run — ADR-0002 auth signup/login + gated member layout

## Context

Cycle 3 of the six-cycle visible-surface push (0003 → 0006 → 0002 → 0009 → 0027 → 0023). Cycles 1 and 2 landed the schema substrate — the `profiles` table, the `role_t` enum, `auth.role_at_least(text)`, the canonical RLS policy set, the append-only `audit_log` table, the `withAudit` helper. Cycle 3 is the first user-facing surface — the first time a real human can sign up, confirm an email, log in, and land on a gated route. The first authenticated UX in the codebase.

Slice 2 scope is explicitly the auth surface and the cookie → middleware → RSC → `profiles` read path: signup with DOB-21+ gating, password ≥12 chars, email lowercase normalization, profiles INSERT via service-role admin client, fail-loudly orphan contract on profile-INSERT failure; login with `email_not_confirmed` branching, generic credentials failure, open-redirect-safe `next=` handling; forgot/reset password (PKCE query-param recovery flow per spec C2 — NOT the fragment flow that would force `'use client'` and an idle/exchanging/ready state machine); GET-only `/auth/confirm` route handler; POST-only `/logout` (GET 405); the `<AuthLayout>` shell; the gated `(member)` group with dashboard and profile stubs; middleware extension for path gating + `x-pathname` request-header handshake. Out of scope: `withAudit` wiring on signup actions (deferred to cycle 4 per Open Q §1), MFA middleware (cycle 5), Playwright E2E (deferred until a real-Supabase test env exists), production callers of `requireRole` (cycle 5 staff layouts).

The run end-to-end: spec-writer + critic (2 iterations, rev 2 ships) → planner (`.conductor/0002/plan.json`, 8 tasks t0–t7) → mandatory premortems on the three risk:high tasks (t0, t1, t3) → 4 worker waves → slice validator (PASS) → critic-diff iter 1 (revise: 7 concerns) → revise worker → 2 cascading test-infra revises → slice validator (PASS) → critic-diff iter 2 (ship) → scope-judge (`ship_ready: true`) → this Phase 4 documentation step. Three worker iters total within the 5-iter conductor budget.

## Changes

Concrete things landed in the working tree (uncommitted; Phase 5 shipper composes the commits). Total slice diff lands the auth substrate plus 13 test files / 141 tests under `tests/auth/`.

**Service-role admin client (t0):**

- `lib/supabase/admin.ts` — first line `import 'server-only';`. Exports only `createAdminClient()` — no raw key access, no top-level `createClient`. Constructs `@supabase/supabase-js` client with `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }`; throws explicit `Error` if env vars missing or URL contains `'placeholder'`. Anti-leak invariants pinned by static-source-text test in `tests/auth/lib-supabase-admin.test.ts`.

**Auth helpers and types (t1 + revise-1):**

- `lib/auth/errors.ts` — first line `import 'server-only';` (added during revise iter 1; the load-bearing security guard against `InsufficientRoleError` accidentally crossing the client boundary via a future refactor). Exports `InsufficientRoleError` class.
- `lib/auth/types.ts` — created during revise iter 1 (the spec named it as the cycle-4 forward-compat seam; the worker had inlined `Role` / `ROLE_RANK` into `requireRole.ts` and `Profile` into `getCurrentProfile.ts`). Exports `type Role`, `const ROLE_RANK`, and the full `interface Profile` mirroring all 8 columns of cycle 1's migration (id, full_name, dob, phone, email, role, created_at, updated_at). NO `import 'server-only';` — types erase at compile time.
- `lib/auth/safeNext.ts` — created during revise iter 1; first line `import 'server-only';`. Lifts the open-redirect validator out of the inlined `login/actions.ts` site so future callers (signup `?next=`, magic-link callback, OAuth) can import it. Same rejection list: empty / non-string / non-leading-slash / `//` / `/\\` / `://` → `/dashboard`.
- `lib/auth/getCurrentProfile.ts` — `React.cache`-wrapped, reads cookie session via `lib/supabase/server.ts createClient()`, calls `auth.getUser()` (NOT `auth.getSession()`), SELECTs the full 8-column profile shape (revise iter 1 widened the SELECT from 4 columns to mirror the type), returns `null` if no session OR profile row missing.
- `lib/auth/requireRole.ts` — calls `getCurrentProfile`; reads `x-pathname` + `x-search` from `next/headers`, encodes as `next=`, calls `redirect('/login?next=...')` if no session; throws `InsufficientRoleError` if `profile.role` rank < requested role per the `ROLE_RANK` ladder. Re-exports `type Role` for backward-compat with the test file.
- `lib/auth/signOut.ts` — server action wrapping `supabase.auth.signOut()` then `redirect('/')`.

**Middleware extension (t2 + revise-1):**

- `middleware.ts` — gates `/dashboard`, `/profile`, `/admin/*`, `/cashier/*` by reading the session via `lib/supabase/middleware.ts updateSession()` (cycle-1 substrate). Sets `request.headers.set('x-pathname', pathname)` and `request.headers.set('x-search', search)` BEFORE calling `updateSession` (the ordering is load-bearing — see Decisions). Substring-trap defended via `pathname === p || pathname.startsWith(p + '/')` so `/admin-evil` does NOT match `/admin`. Marketing routes pass through unauthenticated.

**Auth route group `app/(auth)/` (t3 + t4 + t5 + revise-1):**

- `layout.tsx` — server component (no `'use client'`), brand wordmark "Poker Club" + "Back to site" link to `/`, wraps `{children}`. Created during revise iter 1 (the spec named it as a touched-files inventory item; the worker had skipped it because every individual auth page already worked).
- `signup/page.tsx` + `signup/actions.ts` — server component form; action enforces in order: DOB parse + 21+ gate via `differenceInYears` + `parseISO` from date-fns (NOT the locale-ambiguous `new Date(string)`), password ≥12 chars (never trimmed per NIST 800-63B), email lowercase. Then `supabase.auth.signUp`, then `createAdminClient().from('profiles').insert(...)`. **Fail-loudly contract on profiles INSERT failure**: structured log with the orphan `auth_user_id`, returns generic FormError, NO retry, NO redirect (orphan reaper deferred to cycle 4 per Open Q §2). On full success `redirect('/confirm-email-pending?email=<lowercased>')`.
- `login/page.tsx` + `login/actions.ts` — action lowercases email, calls `signInWithPassword`, maps `invalid_credentials` to a generic `'Invalid email or password'` (no enumeration leak), `email_not_confirmed` to its own distinct message, validates `next=` via `safeNext`, redirects on success.
- `forgot-password/page.tsx` + actions — calls `resetPasswordForEmail` with `redirectTo=<APP_URL>/reset-password`; ALWAYS returns the static "If that email is on file..." message (no enumeration).
- `reset-password/page.tsx` — **server component** (per spec C2 PKCE query-param resolution — NOT a client state machine). Reads `searchParams.token_hash` + `searchParams.type === 'recovery'`; on GET calls `supabase.auth.verifyOtp({ token_hash, type })` server-side; renders error state on verify error, the `{password, confirmPassword}` form on success; action validates ≥12 chars, calls `updateUser({ password })`, redirects `/dashboard`.
- `confirm/route.ts` — GET-only route handler (NOT a page). Reads `request.nextUrl.searchParams` for `token_hash` + `type`, calls `verifyOtp` server-side, returns `NextResponse.redirect(new URL('/dashboard', request.url))` on success or `/auth/auth-code-error` on failure. Mirrors the canonical Supabase Next.js docs pattern.
- `auth-code-error/page.tsx` — small static page with link to `/forgot-password`.
- `confirm-email-pending/page.tsx` — reads `?email=` and renders the post-signup landing message.
- `logout/route.ts` — POST-only handler calling `signOut()` then `redirect('/')`; GET returns 405 (CSRF defense — logout MUST be POST).

**Member route group `app/(member)/` (t6 + revise-1):**

- `layout.tsx` — server component, calls `getCurrentProfile()`, redirects to `/login?next=<encodeURIComponent(pathname + search)>` if no session — defense-in-depth alongside the middleware gate. The `?next=` preservation was added during revise iter 1; the worker iter-1 had emitted a bare `redirect('/login')`, justified by an inline comment ("middleware already encoded the original request path"). The spec disagreed.
- `dashboard/page.tsx` — renders `Hello {profile.full_name}, member number pending verification` plus a `<form method="post" action="/logout"><button>Sign out</button></form>` (matches the POST-only `/logout` handler).
- `profile/page.tsx` — read-only render of `profile.email` + `profile.role`.

**ESLint scope adjustment:**

- `.eslintrc.json` — narrow override unblocks `app/(auth)/**/actions.ts` from the `no-restricted-imports` rule that bans `lib/supabase/admin.ts` outside `lib/`. Signup's fail-loud profiles INSERT contract requires the admin client. The override does NOT broaden the rule elsewhere.

**Test substrate (`tests/auth/`, 13 files / 141 tests):**

- Per-action behavior suites: `signup-action.test.ts` (8 sub-cases incl. orphan fail-loud), `login-action.test.ts` (6 sub-cases), `logout-route.test.ts` (3), `confirm-route.test.ts`, `reset-password-action.test.ts`, `getCurrentProfile.test.ts` (6), `requireRole.test.ts` (4), `safeNext.test.ts` (17), `member-layout.test.ts` (3 incl. x-pathname forwarding + fallback), `middleware.test.ts` (gating + x-pathname forwarding, 4 dedicated sub-cases for the header contract), `auth-layout.test.ts`, `lib-supabase-admin.test.ts` (3 static-source anti-leak), `lib-auth-errors.test.ts` (1 static-source line-1 pin).

## Decisions

Non-obvious choices made during the run that are worth pinning:

- **PKCE query-param recovery flow (NOT fragments).** Spec C2 resolved at draft time after surveying Supabase's current docs: `resetPasswordForEmail` with `redirectTo=<APP_URL>/reset-password` ships the recovery `token_hash` as a query param, NOT a URL fragment. This collapses `reset-password/page.tsx` from a forced `'use client'` page with an idle → exchanging → ready state machine to a plain server component that calls `verifyOtp` server-side before rendering the form. If Supabase ever drifts back to fragment-based recovery, the page MUST become `'use client'` and re-introduce the state machine — pinning the current flow in spec C2 is the sentinel.
- **Signup orphan fail-loud contract — no auto-cleanup of `auth.users` this cycle.** The signup action's `supabase.auth.signUp(...)` succeeds first, then attempts the `profiles` INSERT via `createAdminClient()`. If the profile INSERT fails, the action returns a generic FormError and writes a structured log line carrying the orphan `auth_user_id`, but does NOT call `auth.admin.deleteUser(auth_user_id)` and does NOT retry. The orphan-reaper job is deferred to cycle 4 per Open Q §2 (it needs the admin runtime + a queue + a retention policy — none of those exist in cycle 3). The "fail loudly" posture is the load-bearing safety property: an orphan is recoverable by support; a silently-half-completed signup that masquerades as success is not. Sub-case 7 of `signup-action.test.ts` pins the contract — assertion is "log fired with the orphan id" + "FormError returned" + "NOT redirected".
- **`import 'server-only';` on `errors.ts` and `safeNext.ts` as a load-bearing anti-leak invariant.** Worker iter 1 inlined both into call-site files where the directive was already present transitively, so the validator passed. Critic iter 1 caught the gap — `InsufficientRoleError` is the kind of class a future refactor would import from a client component without realizing it crosses the boundary, and `safeNext` is open-redirect defense that has no business in a client bundle. Revise iter 1 added the directive to both files AND added static-source-text tests (`tests/auth/lib-auth-errors.test.ts` + the line-1 pin in `safeNext.test.ts`) that read the file via `readFileSync` and assert line 1 is exactly `import 'server-only';`. The static check is the cheap defense — `vi.mock('server-only', () => ({}))` would otherwise hide a regression where the directive was deleted.
- **`x-pathname` middleware → header → `next/headers` handshake — set BEFORE `updateSession`, NOT after.** This is the only reliable way to preserve `?next=` through Next.js's middleware → RSC boundary. Cycle 1's `lib/supabase/middleware.ts updateSession` builds the forwarded response via `NextResponse.next({ request })`, which freezes the request-header set at call time. If middleware sets `x-pathname` AFTER `updateSession` returns, the header does not propagate to RSCs that read it via `next/headers`. Worker iter 1 set the header in the wrong order; the middleware tests passed (they asserted the header value, not the call ordering). Revise iter 1's middleware test now includes an explicit ordering pin (`mockImplementationOnce` captures `request.headers.get('x-pathname')` at the moment `updateSession` is invoked) — the test fails if `x-pathname` is unset when `updateSession` runs. `requireRole.ts` and `app/(member)/layout.tsx` both read the header via `headers().get('x-pathname')`, with `x-search` concatenated separately to preserve query strings.
- **`lib/auth/types.ts` as the cycle-4 forward-compat seam.** Cycle 4 (ADR-0009 identity verification) will widen `Profile` with `id_verified_at` and friends. The spec named `lib/auth/types.ts` as the single source of truth for `Role` / `ROLE_RANK` / `Profile`; worker iter 1 inlined those into `requireRole.ts` and `getCurrentProfile.ts` because the per-AC behavior worked either way. Cycle 4's planner would have hit `import { Profile } from '@/lib/auth/types'` and failed. Revise iter 1 created the file and refactored both helpers to consume it. Backward-compat re-exports of `type Role` from `requireRole.ts` and `type Profile` from `getCurrentProfile.ts` keep existing test imports stable. Types erase at compile time, so the file does NOT carry `import 'server-only';`.
- **Structural test for `auth-layout.tsx` uses first-non-empty-line regex, NOT substring `not.toContain('use client')`.** Worker iter 1 added a JSDoc header comment to `app/(auth)/layout.tsx` explaining "this is a server component — no `'use client'` boundary." The literal string `'use client'` appears inside that comment, which trips a naive `expect(src).not.toContain("'use client'")` assertion. Revise iter 3 swapped to a strict semantic check: find the first non-empty line, assert it does NOT match `/^['"]use client['"]/`. Eliminates the false positive without weakening the invariant — the directive must be the FIRST line of a file to be effective in Next.js, so checking only line 1 is the correct semantic.

## Tests

**Ran (slice validator iter 3, all 6 frozen acceptance commands + standard gauntlet):**

- `pnpm typecheck` — exit 0, no output.
- `pnpm lint` — "No ESLint warnings or errors."
- `pnpm test` (full suite) — 63 files / **622 tests** (620 passed, 1 skipped, 1 todo) in 10.07s. Up from cycle 2's 50 files / 479 passed.
- `pnpm test tests/auth/` — 13 files / **141 / 141** in 2.89s.
- `pnpm test tests/db/rls-profiles.test.ts` — 43/43 (cycle-1 regression, AC13 zero-edit contract preserved).
- `pnpm test tests/audit/with-audit.test.ts` — 12/12 (cycle-2 regression).
- `pnpm test scripts/conductor/` — 65/65 (canonical-hash + schemas + validate-skill — no conductor regression).
- `pnpm migrate:check` — exit 0 (no new migration this cycle; 3 migration files scanned, all pre-existing).

The 1 skipped is the cycle-2 `audit-log.test.ts` AC7.5 production-only positive INSERT claim (deferred to cycle 3+ when a real-Supabase staging env exists — still deferred); the 1 todo is the cycle-2 `it.todo` for the same. Both pre-existing, unrelated to this slice.

**Did NOT run (out of slice scope):**

- Playwright E2E for the full HTTP/cookie/middleware/Supabase round-trip — explicitly deferred until a real-Supabase test environment exists (per spec). The vitest unit + integration suite is the cycle-3 substitute; cycle 4+ adds the E2E surface.
- Real-Supabase JWT integration tests against env-var `SUPABASE_SERVICE_ROLE_KEY` — same deferral.

## Next

What the next shift should pick up:

- **Cycle 4 — ADR-0009 identity verification + member application form.** Wires the cycle-2 `withAudit` helper into the signup-completion path (caller-owns-tx contract per the audit-log KB). Widens `lib/auth/types.ts`'s `Profile` interface with `id_verified_at` + verification status enum. First production caller of `withAudit` from cycle 3's auth substrate.
- **Cycle 5 — ADR-0002 MFA + ADR-0027 staff role layouts.** First production callers of `lib/auth/requireRole.ts`. Re-validates the `x-pathname` middleware handshake under real RSC navigation.
- **Phase 5 shipper for ADR-0002** — compose the slice commit on `feature/adr-0002-auth-signup-login`.

## Notes for future me

- **The conductor's revise loop fired exactly once on this cycle and earned its keep.** Iter-1 critic-diff flagged 7 concerns AFTER the slice validator returned PASS (587 tests green, lint clean, typecheck clean). The pattern: 5 of the 7 concerns were "the spec lists `Create: <path>` as a touched-files inventory item; the worker satisfied the AC's behavior by inlining instead of creating the named module." The validator can't catch this — every test passes, every AC is satisfied behaviorally, the only thing that's wrong is forward-compat structure. Cycle 4's planner would have failed on `import { Profile } from '@/lib/auth/types'` with no signal pointing back to the cycle-3 worker. The two-pass critic is the mechanism that catches this.
- **Two test-infra failures cascaded from the revise iter — diagnose but don't blame the worker.** Revise iter 1 introduced `import 'server-only';` on `safeNext.ts`; the existing `login-action.test.ts` imports `login/actions.ts` which now transitively imports `safeNext.ts`, and the jsdom env throws at module-load time before any sub-case runs. Revise iter 1 also added a JSDoc to `auth-layout.tsx` explaining the absence of `'use client'`, which contains the literal substring `'use client'` and trips the test's `not.toContain('use client')` assertion. Both are predictable consequences of the structural fix; revise iter 2 (lint) and revise iter 3 (test infra) cleaned them up. The retry loops were the lessons (again) — same pattern as cycle 1 and cycle 2 — surface gap, fix it, surface the next consequent gap, fix that.
- **Three worker iters fit comfortably in the 5-iter conductor budget.** The budget exists for a reason; this cycle didn't need to spend it. If a future cycle's revise loop ever exceeds 3 iters, that's a signal the spec or the plan has an unresolved structural gap, not that the worker is sloppy. The triage rule: 4+ iters → re-spec the gap, don't keep grinding.
- **The spec's touched-files inventory is load-bearing — the worker brief should call this out next cycle.** Cycle 4's t0 dispatch should pre-load the lesson: every `Create: <path>` line in the spec MUST land as a separate module, even when the AC behavior could be satisfied by inlining. Future cycles import-by-path; the validator can't see that future cycles. The structural-fidelity check is the critic-diff's job, but pre-loading the lesson saves a revise-loop round trip.
- **The PKCE query-param flow is fragile to Supabase docs drift.** If a future cycle re-reads Supabase's password-reset docs and finds the recommended pattern has flipped back to fragments (`#access_token=...&refresh_token=...`), the `reset-password/page.tsx` server component will silently fail — `searchParams.token_hash` will be `undefined` because the recovery context lives in the URL fragment, which the server never sees. The fallback path renders "this page is for password recovery" instead of an error. Pin Supabase's current docs version in the next ADR-0002 amendment; if the docs update, re-spec C2 BEFORE the cycle-4 conductor run.
