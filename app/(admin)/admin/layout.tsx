/**
 * (admin) route-group layout — role-gated admin operations shell.
 *
 * Server component. ADR-0035 AC4 contract:
 *   - First body statement MUST be `await requireRole('manager')`.
 *     `requireRole` encapsulates: no-session redirect to /login,
 *     rank-too-low throw of InsufficientRoleError (caught by the
 *     colocated `error.tsx` boundary → 403 page), and the MFA
 *     enrollment gate redirect (to /login/mfa-challenge, or to
 *     /login/mfa-pending when the challenge route is not yet live).
 *     All session-assurance logic lives INSIDE
 *     `lib/auth/requireRole.ts` so this layout has a single
 *     first-statement. The B1 reconciliation (planner) explicitly
 *     requires no session-assurance terminology in this file —
 *     source-grep in `tests/auth/admin-routes.test.ts` enforces it.
 *   - Renders the admin shell: top nav (Dashboard, Members,
 *     Verifications, Audit log, Flags, Privacy), logo + role badge,
 *     and `{children}`.
 *   - `InsufficientRoleError` propagates to the existing 403 page —
 *     handled by `app/(admin)/admin/error.tsx` (client error boundary).
 *
 * Cycle-3 defense-in-depth: middleware (cycle-3 t2) ALREADY redirects
 * unauthenticated `/admin/**` requests to `/login?next=<encoded>`
 * — this layout's `requireRole('manager')` is the second line of
 * defense AND the role check, since middleware only checks session
 * presence (AC6).
 */

import Link from 'next/link';
import { cookies } from 'next/headers';

import { Chip, Wordmark } from '@/components/marketing/primitives';
import { requireRole } from '@/lib/auth/requireRole';
import { trackAdminEvent } from '@/lib/analytics/admin-events';

// Opt out of static prerender — every page under (admin) reads the
// Supabase session via cookies, which Next.js cannot evaluate at build
// time. Without this, `next build` attempts to prerender /admin and
// throws "Supabase env vars are missing or placeholders" in CI where
// only placeholder env vars are set. The directive cascades to all
// nested routes in this segment.
export const dynamic = 'force-dynamic';

/**
 * Dedup cookie for `admin_session_entered` PostHog emission (ADR-0035
 * AC31). Same cookie name + TTL as the audit-event dedup in
 * `lib/auth/requireRole.ts`'s `__auditHooks.onAdminSessionEntered` —
 * reusing the cookie keeps the PostHog dedup posture aligned with
 * the audit-row dedup so an operator comparing the two surfaces sees
 * the same first-entry windows.
 */
const ADMIN_SESSION_SEEN_COOKIE = 'mopc-admin-session-seen';

// Top-nav items rendered in the admin shell header. The six entries
// (Dashboard, Members, Verifications, Audit log, Flags, Privacy)
// mirror the verbatim list in ADR-0035 AC4. Hold the list in a module
// constant so future slices (audit log surface, flags surface, etc.)
// can extend it without touching the JSX.
const ADMIN_NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/verifications', label: 'Verifications' },
  { href: '/admin/audit-log', label: 'Audit log' },
  { href: '/admin/flags', label: 'Flags' },
  { href: '/admin/privacy', label: 'Privacy' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireRole('manager');

  // ADR-0035 AC31: emit `admin_session_entered` on the first per-tab
  // admin layout render. Dedupe via the `mopc-admin-session-seen`
  // cookie (30-min TTL) — the same cookie `requireRole` uses to dedupe
  // the `admin.session.entered` audit-log row (lib/auth/requireRole.ts
  // §__auditHooks). When the cookie is already visible in `cookies()`
  // the layout is NOT the first entry of the session, so we suppress.
  // The cookie itself is SET by requireRole's hook earlier in this
  // request — RSC cookie-writes are silently dropped by Next, so the
  // cookie persists only when a future request goes through the
  // middleware tier (a forgiving, best-effort dedup that matches the
  // audit-row posture).
  //
  // The PII payload contract (premortem R4): ONLY `{ role, outcome }`.
  // NO actor_id, NO profile.id, NO email — the helper defensively
  // strips these too. The role string is operational metadata
  // (AC28's PII list is email / full_name / phone / dob, not role).
  // Fire-and-forget (no await) so a telemetry hiccup never delays
  // the layout render; the helper internally swallows errors.
  // eslint-disable-next-line @typescript-eslint/await-thenable -- cookies() is sync in Next 14 but async in Next 15; await both paths.
  const cookieStore = await cookies();
  const sessionSeen = cookieStore.get(ADMIN_SESSION_SEEN_COOKIE);
  if (!sessionSeen) {
    void trackAdminEvent('admin_session_entered', {
      role: profile.role,
      outcome: 'ok',
    });
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink-900)' }}>
      <header
        style={{
          height: 64,
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-faint)',
          background: 'var(--ink-850)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Link
          href="/admin"
          aria-label="Admin Console home"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
          }}
        >
          <Chip size={28} />
          <Wordmark size="sm" showSubtitle={false} />
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginLeft: 8,
            }}
          >
            Admin
          </span>
        </Link>

        <nav aria-label="Admin sections" style={{ display: 'flex', gap: 4 }}>
          {ADMIN_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                fontSize: 13,
                color: 'var(--ivory-300)',
                padding: '8px 12px',
                borderRadius: 4,
                textDecoration: 'none',
                letterSpacing: '0.02em',
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            role="status"
            aria-label={`Current role: ${profile.role}`}
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid var(--border-faint)',
              color: 'var(--ivory-200)',
              background: 'rgba(201, 162, 74, 0.08)',
            }}
          >
            {profile.role}
          </span>
          <Link
            href="/dashboard"
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ivory-400)',
              textDecoration: 'none',
            }}
          >
            ← Portal
          </Link>
        </div>
      </header>

      <main style={{ padding: '32px' }}>{children}</main>
    </div>
  );
}
