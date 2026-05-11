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
 */

import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b p-4">
        <Link href="/" className="text-lg font-bold" aria-label="Home">
          Poker Club
        </Link>
        <Link href="/" className="text-sm underline">
          Back to site
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
