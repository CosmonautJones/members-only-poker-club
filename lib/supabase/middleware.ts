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
 *
 * **Timeout (incident 2026-05-29):** the `supabase.auth.getUser()` call is
 * raced against a hard timeout. If Supabase doesn't answer within the budget,
 * we treat the request as unauthenticated and let it through. Without this
 * guard, a paused/degraded Supabase project propagates as a
 * MIDDLEWARE_INVOCATION_TIMEOUT 504 on every page because the middleware
 * matcher catches every non-static route. The trade — a slow Supabase auth
 * response shows the marketing site as anonymous instead of timing out the
 * whole page — matches the spec's degradation posture for non-critical infra.
 */

export const SUPABASE_AUTH_TIMEOUT_MS = 3000;

export type AuthResolution =
  | { kind: 'ok'; user: User | null }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'error'; message: string };

/**
 * Race a Supabase auth call against a hard timeout. Pure helper — extracted
 * for direct unit testing because `updateSession` builds a `NextResponse`
 * which is awkward to instantiate cleanly under vitest's happy-dom.
 *
 * Returns a tagged result so the caller can decide on logging + degraded
 * behavior. NEVER throws — the timeout race is wrapped here.
 */
export async function resolveSupabaseUser(
  getUser: () => Promise<{ data: { user: User | null }; error: unknown }>,
  timeoutMs: number = SUPABASE_AUTH_TIMEOUT_MS,
): Promise<AuthResolution> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      getUser(),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
      }),
    ]);

    if ('kind' in result && result.kind === 'timeout') {
      return { kind: 'timeout', timeoutMs };
    }

    return { kind: 'ok', user: (result as { data: { user: User | null } }).data.user ?? null };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

  // Race against the timeout (incident 2026-05-29). On timeout/error: treat
  // as unauthenticated, log structured, return the unchanged response so the
  // request still completes. Gated routes will redirect to /login; marketing
  // pages render normally with no session.
  const resolution = await resolveSupabaseUser(() => supabase.auth.getUser());

  switch (resolution.kind) {
    case 'ok':
      return { response, user: resolution.user };
    case 'timeout':
      console.warn(
        JSON.stringify({
          event: 'supabase_auth_timeout',
          path: request.nextUrl.pathname,
          timeout_ms: resolution.timeoutMs,
        }),
      );
      return { response, user: null };
    case 'error':
      console.error(
        JSON.stringify({
          event: 'supabase_auth_error',
          path: request.nextUrl.pathname,
          message: resolution.message,
        }),
      );
      return { response, user: null };
  }
}
