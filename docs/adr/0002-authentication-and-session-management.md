# ADR-0002: Authentication & session management

- **Status:** Accepted
- **Date:** 2026-05-04
- **Slice:** 1 (skeleton in middleware) → 2 (full)

## Context

Every authenticated surface (member portal, cashier console, admin) needs to know who's calling, what role they hold, and whether their session is still valid. We also need MFA for staff, password reset, magic-link login for member convenience, and email verification before a member can pay.

We need a strategy that:

- Works seamlessly across React Server Components, Server Actions, Route Handlers, and Client Components in Next.js 14
- Plays well with Supabase RLS — RLS evaluates `auth.uid()`, which requires Postgres to know the current user from the request's JWT
- Doesn't require us to build session storage, token refresh, or password hashing ourselves

## Decision

**Supabase Auth** with cookie-based sessions, integrated via **`@supabase/ssr`**.

- **Identity providers:** email + password (primary), magic link (backup), Google OAuth (convenience).
- **Session storage:** httpOnly, secure cookies (`sb-<project>-auth-token`), refreshed automatically by `@supabase/ssr` middleware.
- **Email verification required** before a member can complete signup or pay.
- **MFA via TOTP** required for `cashier`, `manager`, `owner` roles. Members can opt in. Enforcement happens at sign-in: a session without MFA cannot reach `/cashier` or `/admin` routes.
- **Session lifetime:** 7 days for members, 12 hours for staff. Refresh tokens rotate on every refresh.
- **Password policy:** minimum 12 chars, no compositional rules (matches NIST 800-63B).
- **Brute-force defense:** Supabase Auth rate-limits at the auth endpoint; we add per-IP throttling at the Edge Middleware (see ADR-016).

Three Supabase clients are wrapped in `lib/supabase/`:

- `lib/supabase/server.ts` — RSC + Server Action client, reads cookies, scoped to the user's session
- `lib/supabase/client.ts` — Client Components, browser-side
- `lib/supabase/middleware.ts` — Next.js middleware, refreshes session cookie on each request

Service-role key is used only in `app/api/webhooks/*` and `lib/admin/` server-only modules, never sent to the client. Verified by importing `'server-only'` at the top of those files.

## Consequences

**Positive:**

- We don't write password hashing, JWT signing, refresh-token rotation, or magic-link tokens. Battle-tested code.
- Supabase Auth + RLS is the canonical pairing — `auth.uid()` and `auth.role()` are first-class in policies.
- Cookies are httpOnly and SameSite=Lax: protects against XSS token theft and most CSRF.

**Negative:**

- Supabase Auth lock-in. Migrating to Clerk or a self-hosted IdP would require rewriting the session middleware and re-issuing every member's credentials. We accept this — see ADR-031.
- Cookie-based sessions complicate cross-domain embeds (no need for v1, flag for the future).
- TOTP MFA UX is clunkier than push notifications; we accept this for staff and consider WebAuthn in a later slice.

## Alternatives considered

- **JWT in localStorage.** Vulnerable to XSS exfiltration. Rejected on security grounds.
- **NextAuth.js (now Auth.js).** Mature but requires us to manage our own database adapter and rotation. Rejected because Supabase Auth gives us this out of the box.
- **Clerk.** Better UX, better RBAC primitives, costs more. Reconsider in Slice 4 if Supabase Auth limitations bite (specifically: organization/team semantics if the club ever opens a second location).
