/**
 * Public marketing-site header.
 *
 * Ported from `_design/project/screens-public-1.jsx PublicNav`. The
 * prototype's `onNav` prop pattern is replaced with real Next.js `Link`
 * components since we now have routes. Active-page highlighting is
 * deferred (would require a client component with `usePathname()` —
 * not worth the bundle cost for the MVP preview).
 */

import Link from 'next/link';
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
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 72,
        background: 'rgba(11, 11, 11, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-faint)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 40px',
      }}
    >
      <Link
        href="/"
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
      <div
        style={{
          display: 'flex',
          gap: 32,
          alignItems: 'center',
        }}
      >
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
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
        <Link href="/login" className="btn btn-sm" style={{ marginLeft: 16 }}>
          Member Sign In
        </Link>
        <Link href="/signup" className="btn btn-primary btn-sm">
          Apply
        </Link>
      </div>
    </nav>
  );
}
