import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from './types';

// CONTRACT: This function MUST be per-request.
// React.cache() is bound to the React server render — it deduplicates calls
// within a single request, NOT across requests.
// DO NOT add module-level Maps, WeakMaps, globalThis storage, or LRU caches
// here. If you think you need cross-request caching, you are wrong — call
// this function again and let cache() handle dedup within the render.

// Re-export `Profile` from the canonical types module so existing call sites
// that imported `Profile` from this module keep working. New code SHOULD
// import `Profile` from `@/lib/auth/types` directly.
export type { Profile };

// SELECT column list mirrors the cycle-1 `profiles` schema in
// supabase/migrations/0002_profiles_and_roles.sql. Spec AC6: "the returned
// `Profile` interface mirrors the `profiles` table columns". DO NOT shorten
// this list — cycle 4 will extend `Profile` with `id_verified_at`, and
// keeping the SELECT in lockstep with the type means the helper picks up
// new columns on the next migration without a behavior change here.
const PROFILE_COLUMNS = 'id, full_name, dob, phone, email, role, created_at, updated_at';

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  // eslint-disable-next-line @typescript-eslint/await-thenable -- createClient() is sync in lib/supabase/server.ts but tests mock it as async; keeping the await makes both paths work.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .single();

  if (error || !data) return null;
  return data;
});
