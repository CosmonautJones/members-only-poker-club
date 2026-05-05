import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for Client Components.
 * Reads the session from browser cookies. RLS applies.
 */
export function createClient() {
  return createBrowserClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
  );
}
