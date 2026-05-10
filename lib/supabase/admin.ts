import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. RLS is BYPASSED — every call is a privilege
 * escalation. Use this ONLY for cross-user mutations that legitimately
 * require bypassing Row-Level Security (e.g. the signup-orphan-INSERT into
 * profiles, admin-only writes).
 *
 * MUST be preceded by a `requireRole('manager' | 'owner')` call (see
 * `lib/auth/requireRole.ts`, t1) when invoked from a route handler or
 * server action. Calling this without a role check is a security bug.
 *
 * For RSCs and route handlers that act on behalf of the logged-in user,
 * use `lib/supabase/server.ts` `createClient()` instead — it carries
 * cookie-scoped auth and respects RLS.
 *
 * Factory pattern (per-call instantiation): env vars are read on each call
 * so missing-secret throws fire at call time, not module-load time. Never
 * cache or hoist the result to module scope.
 *
 * See ADR-0002 (Authentication) and ADR-0007 (Secrets handling).
 */
export function createAdminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase admin client env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  if (url.includes('placeholder')) {
    throw new Error('Refusing to construct admin client with placeholder Supabase URL');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
