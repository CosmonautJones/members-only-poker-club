'use server';

// Login server action (ADR-0002, AC3).
//
// All validation here is the SOURCE OF TRUTH. Do not assume the page-
// level form ran any client-side checks — curl POSTs and JS-disabled
// clients submit anything.
//
// Account-enumeration defense: any auth error that ISN'T
// `email_not_confirmed` is collapsed to a single generic message
// ("Invalid email or password."). We do NOT enumerate Supabase error
// codes — see spec AC3 sub-cases 2 + 3.
//
// Open-redirect defense: the `next` param MUST be validated by
// `safeNext()` below before any redirect. The validator rejects
// protocol-relative (`//evil.com`), backslash-escape (`/\\evil.com`),
// and absolute URL (`https://evil.com`) shapes — see spec AC3
// sub-cases 4-6.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { safeNext } from '@/lib/auth/safeNext';
import { createClient } from '@/lib/supabase/server';

export type FormError = {
  field: 'email' | 'password' | 'form';
  message: string;
};

export async function loginAction(formData: FormData): Promise<FormError | undefined> {
  // Email gets lowercase + trim; password is NEVER trimmed (NIST
  // 800-63B accepts trailing spaces; trimming silently weakens
  // policy). `next` is read raw — `safeNext` is the gate.
  const emailEntry = formData.get('email');
  const rawEmail = typeof emailEntry === 'string' ? emailEntry : '';
  const email = rawEmail.toLowerCase().trim();
  const passwordEntry = formData.get('password');
  const password = typeof passwordEntry === 'string' ? passwordEntry : '';
  const nextRaw = formData.get('next');
  const next = typeof nextRaw === 'string' ? nextRaw : null;

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const code = (error as { code?: string }).code ?? '';
    const message = error.message ?? '';
    const looksUnconfirmed = code === 'email_not_confirmed' || /not confirmed/i.test(message);
    if (looksUnconfirmed) {
      return {
        field: 'form',
        message: 'Email not yet confirmed — check your inbox.',
      };
    }
    // Generic catch-all: collapse every other auth error to the same
    // message. No enumeration — `invalid_credentials`,
    // `user_not_found`, `email_address_invalid`, and friends all map
    // to the same string.
    return { field: 'form', message: 'Invalid email or password.' };
  }

  // Per Supabase + Next 14 docs: revalidate the root layout before
  // redirecting so the (member) layout's getCurrentProfile() reads the
  // freshly-set auth cookie instead of a stale null snapshot. Without
  // this the redirected /dashboard request renders with no profile and
  // the layout bounces back to /login?next=/dashboard.
  revalidatePath('/', 'layout');

  // Redirect lives OUTSIDE any try/catch. Next 14's redirect() throws
  // the NEXT_REDIRECT sentinel; wrapping it would swallow the sentinel
  // and turn every successful login into a false-failure.
  redirect(safeNext(next));
}
