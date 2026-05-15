/**
 * Public marketing-site header.
 *
 * Ported from `_design/project/screens-public-1.jsx PublicNav`. Active-
 * page highlighting is deferred. Active-page highlighting is deferred
 * (would require `usePathname()` — not worth the bundle cost for the
 * MVP preview).
 *
 * Audit 2026-05-15 P0 #3: the mobile hamburger drawer is a sibling
 * client-component island (`<MobileMenu />`) so the SVG `<Chip />` and
 * `<Wordmark />` primitives render server-side only — avoids the SSR/
 * client float-precision hydration mismatch the chip's `Math.cos` /
 * `Math.sin` path strings hit when the whole header is a client boundary.
 */

import Link from 'next/link';

import { MobileMenu } from './mobile-menu';
import { Chip, Wordmark } from './primitives';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/club', label: 'The Club' },
  { href: '/games', label: 'Games & Tournaments' },
  { href: '/membership', label: 'Membership' },
  { href: '/contact', label: 'Find Us' },
] as const;

export function PublicHeader() {
  return (
    <nav
      className="home-nav"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(11, 11, 11, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-faint)',
      }}
    >
      <div
        style={{
          height: 72,
          padding: '0 40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          href="/"
          className="home-nav-brand"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            textDecoration: 'none',
          }}
        >
          <Chip size={36} />
          <Wordmark size="md" showSubtitle={true} />
        </Link>

        {/* Desktop nav — hidden on mobile, flex from md up. */}
        <div
          className="home-nav-right hidden md:flex"
          style={{
            gap: 32,
            alignItems: 'center',
          }}
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="home-nav-link"
              style={{
                fontSize: 12,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--ivory-300)',
                fontWeight: 500,
                borderBottom: '1px solid transparent',
                paddingBottom: 4,
                transition: 'all 220ms var(--ease)',
                textDecoration: 'none',
              }}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/login" className="btn btn-sm home-nav-signin" style={{ marginLeft: 16 }}>
            Member Sign In
          </Link>
          <Link href="/signup" className="btn btn-primary btn-sm">
            Apply
          </Link>
        </div>

        {/* Mobile hamburger + drawer (client island). */}
        <MobileMenu items={NAV_ITEMS} />
      </div>
    </nav>
  );
}
