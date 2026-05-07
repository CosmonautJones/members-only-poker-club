/**
 * Public marketing-site footer.
 *
 * Ported from `_design/project/screens-public-1.jsx PublicFooter`.
 * Uses Next.js Link for nav items. The copyright line keeps the
 * full long-form brand name (Members Only Poker Social Club) per the
 * brand-revert in journal entry 04.
 */

import Link from 'next/link';
import { Chip, Suit, Wordmark } from './primitives';

type FooterColumn = {
  title: string;
  links: { label: string; href: string }[];
};

const COLUMNS: FooterColumn[] = [
  {
    title: 'The Club',
    links: [
      { label: 'The Room', href: '/club' },
      { label: 'House Rules', href: '/club' },
      { label: 'Dress Code', href: '/club' },
    ],
  },
  {
    title: 'Play',
    links: [
      { label: 'Cash Games', href: '/games' },
      { label: 'Tournaments', href: '/games' },
      { label: 'Membership', href: '/membership' },
    ],
  },
  {
    title: 'Visit',
    links: [
      { label: 'Find Us', href: '/contact' },
      { label: 'Hours', href: '/contact' },
      { label: 'Member Portal', href: '/login' },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--border-faint)',
        padding: '60px 40px 40px',
        background: 'var(--ink-850)',
      }}
    >
      <div
        className="home-foot-grid"
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr',
          gap: 48,
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <Chip size={48} />
            <Wordmark size="md" />
          </div>
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 13,
              lineHeight: 1.7,
              maxWidth: 320,
            }}
          >
            A private social club for legal, member-funded poker. Membership by application.
          </div>
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 20,
              color: 'var(--gold-400)',
            }}
          >
            <Suit kind="heart" size={14} />
            <Suit kind="diamond" size={14} />
            <Suit kind="club" size={14} />
            <Suit kind="spade" size={14} />
          </div>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="eyebrow" style={{ marginBottom: 16 }}>
              {col.title}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {col.links.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  style={{
                    color: 'var(--ivory-300)',
                    fontSize: 13,
                    textDecoration: 'none',
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <hr className="gold-rule" style={{ margin: '40px auto 24px', maxWidth: 1280 }} />
      <div
        className="home-foot-meta"
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          color: 'var(--text-dim)',
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        <span>© MMXXIV Members Only Poker Social Club</span>
        <span>Members must be 21+ · ID required at the door · Play responsibly</span>
      </div>
    </footer>
  );
}
