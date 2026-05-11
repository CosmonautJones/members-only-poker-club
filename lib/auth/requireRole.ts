import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentProfile } from './getCurrentProfile';
import { InsufficientRoleError } from './errors';
import { ROLE_RANK, type Role } from './types';

// Re-export `Role` from the canonical types module so existing call sites
// (and `tests/auth/requireRole.test.ts`, which imports `type Role` from
// '@/lib/auth/requireRole') keep working without coupling them to the
// types-module path. New code SHOULD import `Role` from `@/lib/auth/types`
// directly.
export type { Role };

export async function requireRole(
  required: Role,
): Promise<{ profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>> }> {
  const profile = await getCurrentProfile();
  if (!profile) {
    // No session → redirect to /login with the original path as next param.
    // eslint-disable-next-line @typescript-eslint/await-thenable -- headers() is synchronous in Next 14 but tests mock it as async (Next 15 forward-compat); keeping the await makes both code paths work.
    const hdrs = await headers();
    const pathname = hdrs.get('x-pathname') ?? hdrs.get('x-invoke-path') ?? '/';
    const search = hdrs.get('x-search') ?? '';
    const next = encodeURIComponent(pathname + search);
    redirect(`/login?next=${next}`);
  }
  const have = ROLE_RANK[profile.role] ?? -1;
  const need = ROLE_RANK[required] ?? Number.POSITIVE_INFINITY;
  if (have < need) {
    throw new InsufficientRoleError(required, profile.role);
  }
  return { profile };
}
