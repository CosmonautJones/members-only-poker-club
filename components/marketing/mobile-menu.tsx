'use client';

/**
 * Mobile drawer toggle for the public header.
 *
 * Client-component island so `useState` can drive an aria-expanded
 * disclosure. The PublicHeader server component imports this so the
 * Chip/Wordmark SVG primitives still render server-side only (and don't
 * hit the SSR/client float-precision hydration mismatch we saw when the
 * whole header was a 'use client' boundary).
 *
 * Added per site audit 2026-05-15 P0 #3.
 */

import Link from 'next/link';
import { useState } from 'react';

type NavItem = { href: string; label: string };

export function MobileMenu({ items }: { items: ReadonlyArray<NavItem> }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-drawer"
        onClick={() => setOpen((v) => !v)}
        className="md:hidden"
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          width: 40,
          height: 40,
          background: 'transparent',
          border: '1px solid var(--gold-400)',
          borderRadius: 4,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            style={{
              display: 'block',
              width: 18,
              height: 1.5,
              background: 'var(--gold-300)',
            }}
          />
        ))}
      </button>

      <div
        id="mobile-drawer"
        className="md:hidden"
        hidden={!open}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 72,
          background: 'var(--ink-900)',
          borderTop: '1px solid var(--border-faint)',
          padding: '16px 24px 24px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              style={{
                fontSize: 14,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--ivory-300)',
                fontWeight: 500,
                textDecoration: 'none',
                padding: '8px 0',
                borderBottom: '1px solid var(--border-faint)',
              }}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={close}
            className="btn"
            style={{ marginTop: 8, textAlign: 'center' }}
          >
            Member Sign In
          </Link>
          <Link
            href="/signup"
            onClick={close}
            className="btn btn-primary"
            style={{ textAlign: 'center' }}
          >
            Apply
          </Link>
        </div>
      </div>
    </>
  );
}
