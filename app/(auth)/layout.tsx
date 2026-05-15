/**
 * `<AuthLayout>` shell for the (auth) route group (ADR-0002, AC8).
 *
 * Server component — no `'use client'` boundary. The auth pages (signup,
 * login, forgot-password, reset-password, confirm-email-pending,
 * auth-code-error) all share this shell so the brand wordmark and the
 * "Back to site" escape hatch are consistent across the surface.
 *
 * Per spec AC8: "the auth pages share a layout with the site's brand
 * wordmark + a 'Back to site' link to `/`. Render is server-side; no
 * client JS required." Tailwind classes inline; no new CSS module.
 *
 * Audit 2026-05-15 P1 #7: swap the plain "Poker Club" text for the
 * branded `<Chip />` + `<Wordmark />` primitives used everywhere else.
 */

import Link from 'next/link';

import { Chip, Wordmark } from '@/components/marketing/primitives';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell flex min-h-screen flex-col">
      <header
        className="flex items-center justify-between"
        style={{
          height: 72,
          padding: '0 40px',
          borderBottom: '1px solid var(--border-faint)',
          background: 'rgba(11, 11, 11, 0.85)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Link
          href="/"
          aria-label="Home"
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
        <Link
          href="/"
          style={{
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ivory-300)',
            textDecoration: 'none',
          }}
        >
          Back to site
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}
