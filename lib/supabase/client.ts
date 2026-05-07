import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for Client Components.
 * Reads the session from browser cookies. RLS applies.
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
  return createBrowserClient(url, anon);
}
