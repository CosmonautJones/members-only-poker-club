/**
 * Login page (ADR-0002, AC3 — restyled per audit 2026-05-15 P0 #2).
 *
 * Server component. Renders an email/password form posting to the
 * colocated `loginAction` server action. The optional `?next=` query
 * param is forwarded into the form as a hidden input so the action can
 * validate + honor it on success. NO `'use client'` — all validation,
 * Supabase calls, and `next` open-redirect defense run server-side
 * (see `actions.ts`).
 *
 * Visual structure mirrors `app/(auth)/signup/page.tsx`: centered card
 * with eyebrow + display heading + branded gold primary submit. The
 * per-page `metadata` override fills the marketing layout's title
 * template (`%s | Members Only Poker Social Club`).
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { loginAction } from './actions';

export const metadata: Metadata = {
  title: 'Member Sign In',
  description:
    'Sign in to your Members Only Poker Social Club account to manage your membership and seat-time wallet.',
};

export default function LoginPage({ searchParams }: { searchParams?: { next?: string } }) {
  const next = searchParams?.next ?? '';

  return (
    <div
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '80px 40px 120px',
      }}
    >
      <header style={{ textAlign: 'center', marginBottom: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Member Sign In
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 56,
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: '-0.015em',
            marginBottom: 16,
          }}
        >
          Welcome back
        </h1>
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 15,
            lineHeight: 1.6,
          }}
        >
          Sign in to your account. Your seat will still be there.
        </p>
      </header>

      <form
        // The action's return type (FormError | undefined) is wider than
        // React's <form action> prop type accepts (void | Promise<void>).
        // The discarded return is harmless here — cycle 3 ships pure
        // server-side re-render without inline error display; the
        // action's typed return shape exists so cycle 3's unit tests AND
        // a future cycle's useFormState wiring can both consume it.
        action={loginAction as unknown as (formData: FormData) => Promise<void>}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Email
          </span>
          <input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            required
            style={{ padding: '12px 14px', fontSize: 15 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Password
          </span>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            style={{ padding: '12px 14px', fontSize: 15 }}
          />
        </label>

        <button type="submit" className="btn btn-primary btn-lg" style={{ marginTop: 16 }}>
          Sign In
        </button>
      </form>

      <p
        style={{
          textAlign: 'center',
          marginTop: 32,
          color: 'var(--ivory-400)',
          fontSize: 14,
        }}
      >
        <Link href="/forgot-password" className="gold-text">
          Forgot your password?
        </Link>
      </p>
      <p
        style={{
          textAlign: 'center',
          marginTop: 12,
          color: 'var(--ivory-400)',
          fontSize: 14,
        }}
      >
        Need an account?{' '}
        <Link href="/signup" className="gold-text">
          Apply for membership
        </Link>
      </p>
    </div>
  );
}
