'use client';

/**
 * Error boundary for the (admin) segment.
 *
 * ADR-0035 AC4 contract: when `requireRole('manager')` throws
 * `InsufficientRoleError` (member or cashier session reaching an
 * `/admin/**` URL), the framework error-boundary catches it and
 * renders a 403 page. This boundary is the per-segment error.tsx
 * Next.js convention.
 *
 * The boundary deliberately does NOT echo the role name or required
 * rank in the visible message — `lib/auth/errors.ts` documents that
 * role names must not leak into client-visible payloads, and this
 * file is a client component. The structured fields (`required`,
 * `actual`) survive on the underlying Error object for server logs,
 * but the user-visible copy is generic ("Forbidden").
 *
 * Other errors (Supabase 5xx, render-time crash) flow through the
 * same boundary with a generic "Something went wrong" message. The
 * reset button takes the user back to the public home — admin
 * surfaces are owner-defined and a stale admin state is safer to
 * clear by leaving the segment entirely.
 *
 * Client component (Next.js requires error.tsx to be client). The
 * layout itself remains a server component; this file is the
 * smallest possible client boundary.
 */

import Link from 'next/link';
import { useEffect } from 'react';

type ErrorWithDigest = Error & { digest?: string };

export default function AdminError({
  error,
  reset,
}: {
  error: ErrorWithDigest;
  reset: () => void;
}) {
  useEffect(() => {
    // Log to the console so the cycle-3 error-tracking gate (Sentry
    // / PostHog wiring per ADR-0026) can attach a breadcrumb in the
    // same render where the boundary fires. We intentionally do NOT
    // include the role-name fields here — the parent error-tracking
    // layer redacts privileged fields per ADR-0035 §Observability,
    // and a hand-rolled console.error would defeat that scrubber.
    // eslint-disable-next-line no-console -- breadcrumb seam for ADR-0026 wiring; scrubber covers the payload.
    console.error('[admin] segment error boundary fired', {
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  const isInsufficientRole = error?.name === 'InsufficientRoleError';

  return (
    <div
      role="alert"
      style={{
        maxWidth: 520,
        margin: '80px auto',
        padding: '0 32px',
        textAlign: 'left',
        color: 'var(--ivory-200)',
      }}
    >
      <div
        className="eyebrow"
        style={{
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 12,
        }}
      >
        {isInsufficientRole ? '403 — Forbidden' : 'Error'}
      </div>
      <h1
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 48,
          fontWeight: 500,
          lineHeight: 1.1,
          letterSpacing: '-0.015em',
          marginBottom: 16,
        }}
      >
        {isInsufficientRole ? 'You do not have access to this area.' : 'Something went wrong.'}
      </h1>
      <p
        style={{
          color: 'var(--ivory-300)',
          fontSize: 15,
          lineHeight: 1.65,
          marginBottom: 32,
        }}
      >
        {isInsufficientRole
          ? 'The administrative consoles are restricted to staff members. If you reached this page in error, return to the site and continue from there.'
          : 'An unexpected error occurred while loading this admin surface. Try again, or return to the site if the problem persists.'}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          onClick={reset}
          className="btn btn-sm"
          style={{
            padding: '10px 18px',
            border: '1px solid var(--border-faint)',
            background: 'transparent',
            color: 'var(--ivory-200)',
            fontSize: 12,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            borderRadius: 4,
          }}
        >
          Try again
        </button>
        <Link
          href="/"
          style={{
            padding: '10px 18px',
            border: '1px solid var(--border-faint)',
            background: 'rgba(201, 162, 74, 0.08)',
            color: 'var(--ivory-100)',
            fontSize: 12,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            textDecoration: 'none',
            borderRadius: 4,
          }}
        >
          Back to site
        </Link>
      </div>
    </div>
  );
}
