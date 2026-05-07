import 'server-only';

import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Reads the session from request cookies. Scoped to the user's session — RLS applies.
 *
 * For service-role access, see lib/supabase/admin.ts (separate file, separate import).
 * See ADR-0002 (Authentication) and ADR-0003 (Authorization model).
 */
export function createClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !anon || url.includes('placeholder')) {
    throw new Error(
      'Supabase env vars are missing or placeholders. ' +
        'Marketing routes do not need Supabase, but this code path does. ' +
        'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  const cookieStore = cookies();
  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      } catch {
        // Server Components cannot set cookies. Ignore — middleware refreshes.
      }
    },
  };
  return createServerClient(url, anon, { cookies: cookieMethods });
}
