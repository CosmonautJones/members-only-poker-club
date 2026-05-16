/**
 * `/signup` — member signup form.
 *
 * Server component. Renders the {email, password, dob, full_name} form
 * that posts to the colocated `signupAction` server action. All
 * validation lives in the action — this page is a thin presentational
 * shell. Per ADR-0002 cycle 3 (AC2 + AC9 sub-case 4), this file is a
 * pure server component (no client-component directive); forms use
 * Next 14 native server-action `action={signupAction}` wiring.
 *
 * Inline validation feedback is deferred — cycle 3 ships pure server-
 * side re-render on error; the form re-submits to the same URL. Polished
 * inline-error UX lands in a follow-up cycle (or cookies()-flash carry,
 * per spec §"Auth pages" hint).
 *
 * Pre-Supabase graceful fallback (owner bug 2026-05-15): when the
 * NEXT_PUBLIC_SUPABASE_URL env var is missing or placeholder, the
 * server action would throw at submit (createClient() validates env at
 * call-time and surfaces a server-side exception to the user). Until
 * the owner provisions Supabase on Vercel, show an "Applications
 * opening soon" panel instead of the form. The form returns
 * automatically once the env vars are configured — no code change
 * needed at that point.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { signupAction } from './actions';

export const metadata: Metadata = {
  title: 'Apply for Membership',
  description:
    'Apply to join Members Only Poker Social Club — five-minute form, reviewed within twenty-four hours.',
};

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  if (url.includes('placeholder')) return false;
  return true;
}

export default function SignupPage() {
  if (!isSupabaseConfigured()) {
    return <ComingSoonPanel />;
  }

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
          Apply For Membership
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
          Create your account
        </h1>
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 15,
            lineHeight: 1.6,
          }}
        >
          Members must be 21 or older. We&apos;ll email a confirmation link to finish signup.
        </p>
      </header>

      <form
        // The action's return type (FormError | undefined) is wider than
        // React's <form action> prop type accepts (void | Promise<void>).
        // The discarded return is harmless here — cycle 3 ships pure
        // server-side re-render without inline error display; the
        // action's typed return shape exists so cycle 3's unit tests AND
        // a future cycle's useFormState wiring can both consume it.
        action={signupAction as unknown as (formData: FormData) => Promise<void>}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Full Name
          </span>
          <input
            type="text"
            name="full_name"
            autoComplete="name"
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
            Email
          </span>
          <input
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
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={12}
            required
            style={{ padding: '12px 14px', fontSize: 15 }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Minimum 12 characters. No other rules.
          </span>
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
            Date Of Birth
          </span>
          {/* `colorScheme: 'light'` overrides the page-level dark scheme
              so the browser-native date control renders with readable
              contrast (placeholder hint, calendar icon). Explicit dark
              `color` covers the typed value (owner bug 2026-05-15). */}
          <input
            type="date"
            name="dob"
            required
            style={{
              padding: '12px 14px',
              fontSize: 15,
              colorScheme: 'light',
              color: '#0B0B0B',
            }}
          />
        </label>

        <button type="submit" className="btn btn-primary btn-lg" style={{ marginTop: 16 }}>
          Create Account
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
        Already a member?{' '}
        <Link href="/login" className="gold-text">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function ComingSoonPanel() {
  return (
    <div
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: '80px 40px 120px',
        textAlign: 'center',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Apply For Membership
      </div>
      <h1
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 56,
          fontWeight: 500,
          lineHeight: 1.05,
          letterSpacing: '-0.015em',
          marginBottom: 24,
        }}
      >
        Applications opening soon.
      </h1>
      <hr className="gold-rule-short" style={{ margin: '0 auto 32px', maxWidth: 320 }} />
      <p
        style={{
          color: 'var(--ivory-300)',
          fontSize: 16,
          lineHeight: 1.7,
          marginBottom: 24,
        }}
      >
        We&rsquo;re putting the finishing touches on the application portal. The room is ready; the
        membership system is coming online in the next few days.
      </p>
      <p
        style={{
          color: 'var(--ivory-300)',
          fontSize: 16,
          lineHeight: 1.7,
          marginBottom: 40,
        }}
      >
        In the meantime, learn about the club, the room, and the games we&rsquo;ll be running.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 16,
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Link href="/club" className="btn">
          Tour The Club
        </Link>
        <Link href="/membership" className="btn">
          Read About Membership
        </Link>
      </div>
    </div>
  );
}
