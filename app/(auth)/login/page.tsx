/**
 * Login page (ADR-0002, AC3).
 *
 * Server component. Renders an email/password form posting to the
 * colocated `loginAction` server action. The optional `?next=` query
 * param is forwarded into the form as a hidden input so the action can
 * validate + honor it on success. NO `'use client'` — all validation,
 * Supabase calls, and `next` open-redirect defense run server-side
 * (see `actions.ts`).
 */

import Link from 'next/link';

import { loginAction } from './actions';

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const next = searchParams?.next ?? '';

  return (
    <main>
      <h1>Sign in</h1>
      <form
        // The action's return type (FormError | undefined) is wider than
        // React's <form action> prop type accepts (void | Promise<void>).
        // The discarded return is harmless here — cycle 3 ships pure
        // server-side re-render without inline error display; the
        // action's typed return shape exists so cycle 3's unit tests AND
        // a future cycle's useFormState wiring can both consume it.
        action={loginAction as unknown as (formData: FormData) => Promise<void>}
      >
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        <button type="submit">Sign in</button>
      </form>

      <p>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p>
        Need an account? <Link href="/signup">Apply for membership</Link>
      </p>
    </main>
  );
}
