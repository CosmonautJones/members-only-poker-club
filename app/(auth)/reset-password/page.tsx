/**
 * Reset-password page (ADR-0002, AC4 — PKCE query-param flow per
 * spec §"Supabase recovery-flow shape — RESOLVED").
 *
 * Server component. The Supabase recovery email link points users
 * here with `?token_hash=...&type=recovery` query params. On render
 * we call `supabase.auth.verifyOtp({ token_hash, type })` server-side
 * via the cookie-scoped @supabase/ssr client — that establishes the
 * recovery session cookie. THEN we render the new-password form.
 *
 * State machine on render:
 *   - searchParams missing entirely → "this page is for password
 *     recovery" message with a link to /forgot-password.
 *   - verifyOtp returns an error → "this reset link is invalid or
 *     expired" message with a link to /forgot-password.
 *   - verifyOtp succeeds → render the {password, confirmPassword}
 *     form posting to the colocated server action.
 *
 * NO `'use client'` — the verify call MUST happen server-side so the
 * cookie is set via the @supabase/ssr cookie handlers in
 * lib/supabase/server.ts.
 */

import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';

import { resetPasswordAction } from './actions';

type SearchParams = {
  token_hash?: string;
  type?: string;
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const tokenHash = searchParams?.token_hash;
  const type = searchParams?.type;

  // No recovery params → bare page hit. Tell the user how to get here
  // properly.
  if (!tokenHash || type !== 'recovery') {
    return (
      <main>
        <h1>Reset your password</h1>
        <p>This page is for password recovery.</p>
        <p>
          To reset your password, request a fresh email at{' '}
          <Link href="/forgot-password">forgot password</Link>.
        </p>
      </main>
    );
  }

  // Server-side verify the recovery OTP. On success, @supabase/ssr's
  // cookie handlers in lib/supabase/server.ts set the session cookie
  // — the form's updateUser call (in actions.ts) will then run as the
  // newly-authenticated recovering user.
  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'recovery',
  });

  if (error) {
    return (
      <main>
        <h1>Reset link invalid</h1>
        <p>This reset link is invalid or expired.</p>
        <p>
          <Link href="/forgot-password">Request a new one</Link>.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Set a new password</h1>
      <form
        // The action's return type (FormError | undefined) is wider than
        // React's <form action> prop type accepts (void | Promise<void>).
        // The discarded return is harmless here — cycle 3 ships pure
        // server-side re-render without inline error display; a future
        // cycle's useFormState wiring can consume the typed return.
        action={
          resetPasswordAction as unknown as (formData: FormData) => Promise<void>
        }
      >
        <label htmlFor="password">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />

        <label htmlFor="confirmPassword">Confirm new password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />

        <button type="submit">Update password</button>
      </form>
    </main>
  );
}
