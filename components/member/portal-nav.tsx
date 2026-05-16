'use client';

/**
 * Client islands for the (member) portal shell.
 *
 * Two tiny client components — `SidebarNav` and `BreadcrumbCurrent` —
 * read `usePathname()` so the active nav item and breadcrumb update
 * on intra-layout navigation. The (member) layout itself is a server
 * component (test invariant AC8); these islands are the smallest
 * possible client boundary to fix the active-state bug.
 *
 * NOTE: do NOT render `Chip` or `Wordmark` from inside these islands —
 * the SVG Math.cos/sin coordinate calculations are float-precision
 * sensitive and create SSR/client hydration mismatches across the
 * server↔client boundary. The layout renders those primitives on the
 * server side and the active-state logic lives here, where it belongs.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavItem = {
  href: string;
  label: string;
  glyph: string;
  ready: boolean;
};

export const PORTAL_NAV: ReadonlyArray<NavItem> = [
  { href: '/dashboard', label: 'Dashboard', glyph: '◆', ready: true },
  { href: '/profile', label: 'Profile', glyph: '○', ready: true },
  { href: '/buytime', label: 'Buy Time', glyph: '◷', ready: false },
  { href: '/billing', label: 'Billing', glyph: '$', ready: false },
  { href: '/activity', label: 'Activity', glyph: '≡', ready: false },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav style={{ display: 'flex', flexDirection: 'column' }}>
      {PORTAL_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const baseStyle: React.CSSProperties = {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          borderRadius: 6,
          color: active ? 'var(--gold-200)' : 'var(--ivory-300)',
          background: active ? 'rgba(201, 162, 74, 0.08)' : 'transparent',
          fontSize: 14,
          fontWeight: 500,
          marginBottom: 2,
          borderLeft: active ? '2px solid var(--gold-400)' : '2px solid transparent',
          textDecoration: 'none',
          transition: 'background 180ms var(--ease)',
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
    </nav>
  );
}

export function BreadcrumbCurrent({ fallback = 'Dashboard' }: { fallback?: string }) {
  const pathname = usePathname();
  const match = PORTAL_NAV.find((n) => isActive(pathname, n.href));
  return <span style={{ color: 'var(--gold-300)' }}>{match?.label ?? fallback}</span>;
}
