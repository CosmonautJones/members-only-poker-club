import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { type User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Middleware-side Supabase client. Refreshes the session cookie on every request
 * so server components always see a fresh token, AND returns the current user
 * (or null) so the root middleware can drive gated-prefix redirects without
 * reconstructing a second supabase client.
 *
 * Per @supabase/ssr docs, this MUST be called in middleware.ts before any
 * server component reads cookies — otherwise stale tokens cause silent auth failures.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  // Marketing-only deploys (slice 1) can run without a real Supabase project.
  // Skip the session refresh when env vars are absent or placeholder values.
  // Once the member portal lands in slice 2, production env will always have
  // real values and this guard becomes a no-op. See ADR-0002 + journal 05.
  if (!url || !anon || url.includes('placeholder')) {
    return { response, user: null };
  }

  const cookies: CookieMethodsServer = {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      cookiesToSet.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options),
      );
    },
  };

  const supabase = createServerClient(url, anon, { cookies });

  // Touch the session — triggers refresh-token rotation if needed. Capture the
  // user so the caller can decide whether the request is authenticated without
  // building a second supabase client.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
