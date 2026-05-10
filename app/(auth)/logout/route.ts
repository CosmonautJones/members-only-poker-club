/**
 * `/logout` — sign-out endpoint (ADR-0002, AC5).
 *
 * POST handler signs the user out via Supabase (clears the session
 * cookie) then 303-redirects to `/`. The 303 status is intentional —
 * per HTTP semantics it converts the POST to a GET on the redirect
 * target, which is what we want for the marketing home page.
 *
 * GET handler returns 405 Method Not Allowed. This is the CSRF defense:
 * forcing POST means a malicious site cannot log a user out via a
 * cross-origin `<img src="/logout">` or `<a href="/logout">`. Logout
 * must come from a same-origin form submission:
 *
 *   <form method="post" action="/logout">
 *     <button type="submit">Sign out</button>
 *   </form>
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}

export function GET() {
  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  });
}
