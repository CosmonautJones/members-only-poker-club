/**
 * (member) route-group layout (ADR-0002, AC8).
 *
 * Server component. Defense-in-depth alongside the middleware gate
 * (cycle-3 t2), which already redirects unauthenticated requests to
 * `/login?next=<pathname>` for `/dashboard`, `/profile`, and `/admin/*`.
 *
 * Per spec AC8: "If `null`, throws `redirect('/login?next=<currentPath>')`
 * using the same `x-pathname` middleware handshake." The middleware
 * (AC10) sets `x-pathname` on the forwarded request; this layout reads
 * it via `next/headers` and echoes it as the `?next=` param so internal
 * RSC navigations that bypass middleware still preserve the original
 * destination. Falls back to `/dashboard` if the header is absent.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getCurrentProfile } from '@/lib/auth/getCurrentProfile';

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) {
    // Read `x-pathname` (set by middleware AC10). Fall back to `/dashboard`
    // when absent (e.g. during a unit-test render without middleware).
    // eslint-disable-next-line @typescript-eslint/await-thenable -- headers() is sync in Next 14 but tests mock it as async (Next 15 forward-compat); the await keeps both paths working.
    const hdrs = await headers();
    const pathname = hdrs.get('x-pathname') ?? '/dashboard';
    const search = hdrs.get('x-search') ?? '';
    redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
  return <div className="member-shell">{children}</div>;
}
