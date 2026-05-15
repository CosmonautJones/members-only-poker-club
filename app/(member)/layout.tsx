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
 * The shell — sidebar nav + topbar — wraps `{children}` in a single
 * `<MemberShell>` element so member-layout.test.ts's tree-walk for
 * `children` still finds the original node regardless of the wrapper's
 * internal structure.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Chip, Wordmark } from '@/components/marketing/primitives';
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
  // eslint-disable-next-line @typescript-eslint/await-thenable -- headers() is sync in Next 14 but tests mock it as async (Next 15 forward-compat); the await keeps both paths working.
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '/dashboard';

  if (!profile) {
    const search = hdrs.get('x-search') ?? '';
    redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
  }

  return (
    <MemberShell profile={profile} pathname={pathname}>
      {children}
    </MemberShell>
  );
}

// ============================================================
// MemberShell — sidebar nav + topbar + main content area
// Server-component only. No client interactions; the nav uses
// <Link> (RSC navigation) and Sign Out is a POST form.
// ============================================================

const NAV: ReadonlyArray<{
  href: string;
  label: string;
  glyph: string;
  ready: boolean;
}> = [
  { href: '/dashboard', label: 'Dashboard', glyph: '◆', ready: true },
  { href: '/profile', label: 'Profile', glyph: '○', ready: true },
  { href: '/buytime', label: 'Buy Time', glyph: '◷', ready: false },
  { href: '/billing', label: 'Billing', glyph: '$', ready: false },
  { href: '/activity', label: 'Activity', glyph: '≡', ready: false },
];

function MemberShell({
  profile,
  pathname,
  children,
}: {
  profile: Profile;
  pathname: string;
  children: React.ReactNode;
}) {
  const currentLabel = NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + '/'))
    ?.label;
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

        {NAV.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');
          const baseStyle: React.CSSProperties = {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 6,
            color: isActive ? 'var(--gold-200)' : 'var(--ivory-300)',
            background: isActive ? 'rgba(201, 162, 74, 0.08)' : 'transparent',
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 2,
            borderLeft: isActive
              ? '2px solid var(--gold-400)'
              : '2px solid transparent',
            textDecoration: 'none',
          };
          if (!item.ready) {
            return (
              <div
                key={item.href}
                aria-disabled="true"
                title="Coming soon"
                style={{ ...baseStyle, opacity: 0.4, cursor: 'not-allowed' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    color: 'var(--gold-400)',
                    fontSize: 12,
                    width: 16,
                    display: 'inline-flex',
                    justifyContent: 'center',
                  }}
                >
                  {item.glyph}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.18em',
                    color: 'var(--text-dim)',
                    textTransform: 'uppercase',
                  }}
                >
                  Soon
                </span>
              </div>
            );
          }
          return (
            <Link key={item.href} href={item.href} style={baseStyle}>
              <span
                aria-hidden="true"
                style={{
                  color: 'var(--gold-400)',
                  fontSize: 12,
                  width: 16,
                  display: 'inline-flex',
                  justifyContent: 'center',
                }}
              >
                {item.glyph}
              </span>
              {item.label}
            </Link>
          );
        })}

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
              {profile.full_name
                .split(/\s+/)
                .map((s) => s[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
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
            <span style={{ color: 'var(--gold-300)' }}>
              {currentLabel ?? 'Dashboard'}
            </span>
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
