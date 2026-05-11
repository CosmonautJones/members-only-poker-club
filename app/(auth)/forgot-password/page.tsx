/**
 * Forgot-password page (ADR-0002, AC4).
 *
 * Server component. Renders an email-only form posting to the
 * colocated `forgotPasswordAction` server action. The action returns a
 * STATIC message regardless of whether the email is on file —
 * account-enumeration defense (spec AC4).
 */

import Link from 'next/link';

import { forgotPasswordAction } from './actions';

export default function ForgotPasswordPage() {
  return (
    <main>
      <h1>Reset your password</h1>
      <p>
        Enter the email associated with your account. If it&apos;s on file, we&apos;ll send you a
        link to set a new password.
      </p>

      <form
        // The action's return type ({ message }) is wider than React's
        // <form action> prop type accepts (void | Promise<void>). The
        // discarded return is harmless here — the static-message
        // contract is account-enumeration defense (spec AC4); cycle 3
        // ships pure server-side re-render without inline display, and
        // a future cycle's useFormState wiring can consume the typed
        // return.
        action={forgotPasswordAction as unknown as (formData: FormData) => Promise<void>}
      >
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />

        <button type="submit">Send reset link</button>
      </form>

      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
