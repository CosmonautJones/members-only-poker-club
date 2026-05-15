/**
 * (member) route-group layout — portal shell.
 *
 * Server component. Defense-in-depth alongside the middleware gate
 * (cycle-3 t2), which already redirects unauthenticated requests to
 * `/login?next=<pathname>` for `/dashboard`, `/profile`, and `/admin/*`.
 *
 * Per spec AC8: "If `null`, throws `redirect('/login?next=<currentPath>')`
 * using the same `x-pathname` middleware handshake." The middleware
 * (AC10) sets `x-pathname` on the forwarded request; this layout reads
 * it via `next/headers` and echoes it as the `?next=` param so internal
 * RSC navigations that bypass middleware still preserve the original
 * destination. Falls back to `/dashboard` if the header is absent.
 *
 * Sidebar active state + breadcrumb live in tiny client islands
 * (`SidebarNav`, `BreadcrumbCurrent`) because layouts are mounted
 * once and reused across intra-segment navigations — server-side
 * pathname reads would be stuck on whichever route loaded first.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Chip, Wordmark } from '@/components/marketing/primitives';
import { BreadcrumbCurrent, SidebarNav } from '@/components/member/portal-nav';
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile';
import type { Profile } from '@/lib/auth/types';

// Opt out of static prerender — every page under (member) reads the
// Supabase session via cookies, which Next.js cannot evaluate at build
// time. Without this, `next build` attempts to prerender /dashboard and
// /profile and throws "Supabase env vars are missing or placeholders"
// in CI where only placeholder env vars are set. The directive cascades
// to all nested routes in this segment.
export const dynamic = 'force-dynamic';

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  if (!profile) {
    // eslint-disable-next-line @typescript-eslint/await-thenable -- headers() is sync in Next 14 but tests mock it as async (Next 15 forward-compat); the await keeps both paths working.
    const hdrs = await headers();
    const pathname = hdrs.get('x-pathname') ?? '/dashboard';
    const search = hdrs.get('x-search') ?? '';
    redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
  }

  return <MemberShell profile={profile}>{children}</MemberShell>;
}

// ============================================================
// MemberShell — sidebar + topbar + main content area.
// Server-renderable wrapper. The active-state nav and breadcrumb
// label are client islands (see ./components/member/portal-nav.tsx);
// everything else stays on the server side. The Chip + Wordmark
// SVGs MUST render server-side per the known float-precision
// hydration gotcha (see CLAUDE.md memory).
// ============================================================

function MemberShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const initials = profile.full_name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--ink-900)',
      }}
    >
      <aside
        style={{
          width: 248,
          flexShrink: 0,
          background: 'var(--ink-850)',
          borderRight: '1px solid var(--border-faint)',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <Link
          href="/dashboard"
          aria-label="Members Portal home"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 8px 24px',
            borderBottom: '1px solid var(--border-faint)',
            marginBottom: 20,
            textDecoration: 'none',
          }}
        >
          <Chip size={32} />
          <Wordmark size="sm" showSubtitle={true} />
        </Link>

        <div
          className="eyebrow"
          style={{ fontSize: 10, padding: '0 8px', marginBottom: 8 }}
        >
          Portal
        </div>

        <SidebarNav />

        <div style={{ flex: 1 }} />

        <div
          style={{
            borderTop: '1px solid var(--border-faint)',
            paddingTop: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0 8px',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--gold-grad)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Cormorant Garamond, serif',
                color: '#0B0B0B',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {initials}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ivory-200)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {profile.full_name}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                }}
              >
                {profile.role}
              </div>
            </div>
          </div>
          <form method="post" action="/logout" style={{ margin: 0 }}>
            <button
              type="submit"
              className="btn btn-sm btn-ghost"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                color: 'var(--text-muted)',
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            height: 64,
            padding: '0 32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-faint)',
            background: 'var(--ink-850)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              color: 'var(--text-muted)',
              fontSize: 12,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}
          >
            <span>Members Portal</span>
            <span aria-hidden="true">/</span>
            <BreadcrumbCurrent />
          </div>
          <Link
            href="/"
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ivory-400)',
              textDecoration: 'none',
            }}
          >
            ← Back to site
          </Link>
        </div>
        <div style={{ padding: '32px' }}>{children}</div>
      </main>
    </div>
  );
}
