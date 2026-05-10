'use server';

// Forgot-password server action (ADR-0002, AC4).
//
// Account-enumeration defense (spec AC4): the user-facing message is
// IDENTICAL on success AND on error. We do NOT branch the response on
// the Supabase result. Errors are logged via console.error for ops
// visibility but never surfaced to the client.
//
// `redirectTo` points to /reset-password where the page-level
// server component handles the recovery PKCE token_hash + type=recovery
// query params via supabase.auth.verifyOtp() server-side.

import { createClient } from '@/lib/supabase/server';

const STATIC_MESSAGE =
  "If that email is on file, we've sent a reset link.";

export async function forgotPasswordAction(
  formData: FormData,
): Promise<{ message: string }> {
  const emailEntry = formData.get('email');
  const rawEmail = typeof emailEntry === 'string' ? emailEntry : '';
  const email = rawEmail.toLowerCase().trim();

  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';
  const redirectTo = `${appUrl}/reset-password`;

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      // Log for ops but DO NOT surface — the user-facing message is
      // STATIC regardless of result.
      console.error({
        tag: 'forgot_password.reset_email_failed',
        supabase_error_code: (error as { code?: string }).code ?? 'unknown',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    // Defensive: if the server client constructor throws (missing env
    // vars), we still return the same static message — no enumeration
    // signal. Log loud for ops.
    console.error({
      tag: 'forgot_password.unexpected_error',
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
  }

  return { message: STATIC_MESSAGE };
}
