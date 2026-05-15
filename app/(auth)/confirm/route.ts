/**
 * `/confirm` — email-link verification handler (ADR-0002, AC4).
 *
 * GET route. Mirrors the canonical Supabase Next.js PKCE/OTP confirm
 * pattern: Supabase emits links of the form
 * `<site>/confirm?token_hash=...&type=signup` (or magiclink/recovery/
 * invite/email_change). We exchange the token_hash via
 * `supabase.auth.verifyOtp`, which sets the session cookie on success.
 * On success we redirect to `/dashboard`; on any failure (missing params,
 * expired token, replay) we redirect to `/auth-code-error`.
 *
 * No POST handler — the confirm flow is initiated by the user clicking
 * a link in their email, which is a GET. CSRF is not in scope here
 * because the token_hash itself is the bearer credential and is
 * single-use server-side.
 *
 * See ADR-0002 §C2 (PKCE query-param flow) for resolution rationale.
 */

import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as
    | 'signup'
    | 'magiclink'
    | 'recovery'
    | 'invite'
    | 'email_change'
    | null;

  if (token_hash && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      // Match the login/reset-password actions: revalidate root layout so
      // the (member) layout's getCurrentProfile() reads the verifyOtp-set
      // session cookie instead of a stale null snapshot.
      revalidatePath('/', 'layout');
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return NextResponse.redirect(new URL('/auth-code-error', request.url));
}
